"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Sparkles, Wand2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/basicos";
import { Campo, Checkbox, Select, Switch } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { cn } from "@/lib/utils";
import type { OpcoesFiltro } from "@/lib/questoes/filtros";
import type { EstadoIA } from "@/lib/ia/index";
import { QUANTIDADES_SUGERIDAS, TIPOS_SIMULADO, type EntradaConfigSimulado, type TipoSimulado } from "@/lib/simulados/config";
import type { PlanoSimulado } from "@/lib/simulados/servico";
import { montarSimulado } from "../acoes";

interface Regra { id: string; nome: string; descricao: string | null; pontos_acerto: number; pontos_erro: number; pontos_branco: number; nota_nao_negativa: boolean }

type Etapa = { rotulo: string; estado: "pendente" | "andamento" | "ok" | "aviso" | "erro"; detalhe?: string };

const ETAPAS_BASE = [
  "Identificar disciplinas e assuntos",
  "Consultar questões e materiais disponíveis",
  "Selecionar questões adequadas",
  "Gerar e validar questões originais (se necessário)",
  "Organizar a prova, tempo, pontuação e gabarito",
  "Salvar o simulado",
];

const PRECISA_DISCIPLINA: TipoSimulado[] = ["disciplina"];
const USA_ASSUNTOS: TipoSimulado[] = ["assunto", "disciplina", "erros"];

export function ConfiguradorSimulado({ opcoes, ia, regras, editais, questoesDisponiveis, tipoInicial, disciplinaInicial }: {
  opcoes: OpcoesFiltro; ia: EstadoIA; regras: Regra[]; editais: { id: string; titulo: string }[];
  questoesDisponiveis: number; tipoInicial?: string; disciplinaInicial?: string;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoSimulado>(tipoInicial && tipoInicial in TIPOS_SIMULADO ? (tipoInicial as TipoSimulado) : "disciplina");
  const [nome, setNome] = useState("");
  const [disciplinas, setDisciplinas] = useState<string[]>(disciplinaInicial ? [disciplinaInicial] : []);
  const [assuntos, setAssuntos] = useState<string[]>([]);
  const [bancaId, setBancaId] = useState("");
  const [editalId, setEditalId] = useState("");
  const [quantidade, setQuantidade] = useState(30);
  const [tempo, setTempo] = useState<string>("60");
  const [dif, setDif] = useState({ facil: 20, medio: 50, dificil: 30 });
  const [tiposQ, setTiposQ] = useState<("multipla_escolha" | "certo_errado")[]>(["multipla_escolha", "certo_errado"]);
  const [incluirRespondidas, setIncluirRespondidas] = useState(true);
  const [somenteIneditas, setSomenteIneditas] = useState(false);
  const [ordem, setOrdem] = useState<"aleatoria" | "organizada">("aleatoria");
  const [permitePausa, setPermitePausa] = useState(false);
  const [mostrarGabarito, setMostrarGabarito] = useState(false);
  const [finalizarAoEsgotar, setFinalizarAoEsgotar] = useState(true);
  const [regraId, setRegraId] = useState(regras.find((r) => r.pontos_erro === 0)?.id ?? "");
  const [personalizada, setPersonalizada] = useState({ acerto: 1, erro: 0, branco: 0, naoNegativa: true });
  const [gerarComIA, setGerarComIA] = useState(ia.configurada && !ia.bloqueadaPorOrcamento);

  const [etapas, setEtapas] = useState<Etapa[] | null>(null);
  const [insuficiente, setInsuficiente] = useState<PlanoSimulado | null>(null);
  const [erro, setErro] = useState<string>();
  const [ocupado, setOcupado] = useState(false);

  const assuntosDisponiveis = useMemo(
    () => opcoes.assuntos.filter((a) => disciplinas.length === 0 || disciplinas.includes(a.disciplina_id)),
    [opcoes.assuntos, disciplinas],
  );
  const regra = regras.find((r) => r.id === regraId);
  const iaDisponivel = ia.configurada && !ia.bloqueadaPorOrcamento;

  const config = (extra: Partial<EntradaConfigSimulado> = {}): EntradaConfigSimulado => ({
    tipo, nome, disciplinaIds: disciplinas, assuntoIds: assuntos, bancaId: bancaId || null, editalId: editalId || null,
    quantidade, dificuldades: dif, tipos: tiposQ, incluirRespondidas, somenteIneditas, ordem,
    tempoLimiteMin: tempo ? Number(tempo) : null, permitePausa, mostrarGabaritoDurante: mostrarGabarito, finalizarAoEsgotar,
    regraPontuacaoId: regraId || null,
    pontosAcerto: regra ? regra.pontos_acerto : personalizada.acerto,
    pontosErro: regra ? regra.pontos_erro : personalizada.erro,
    pontosBranco: regra ? regra.pontos_branco : personalizada.branco,
    notaNaoNegativa: regra ? regra.nota_nao_negativa : personalizada.naoNegativa,
    gerarComIA, ...extra,
  });

  const marcar = (i: number, estado: Etapa["estado"], detalhe?: string) =>
    setEtapas((l) => l && l.map((e, k) => (k === i ? { ...e, estado, detalhe } : k < i && e.estado === "pendente" ? { ...e, estado: "ok" } : e)));

  const validar = () => {
    if (PRECISA_DISCIPLINA.includes(tipo) && disciplinas.length === 0) return "Escolha a disciplina.";
    if (tipo === "assunto" && assuntos.length === 0) return "Escolha ao menos um assunto.";
    if (tipo === "banca" && !bancaId) return "Escolha a banca.";
    if (dif.facil + dif.medio + dif.dificil === 0) return "Defina a distribuição de dificuldade.";
    if (!tiposQ.length) return "Escolha ao menos um tipo de questão.";
    return undefined;
  };

  /** Gera com IA as questões que faltam em cada grupo do déficit. */
  const completarComIA = async (plano: PlanoSimulado) => {
    let geradas = 0;
    const alvo = plano.deficits.reduce((s, d) => s + d.faltam, 0);
    for (const d of plano.deficits) {
      let faltam = d.faltam;
      for (let tentativa = 0; faltam > 0 && tentativa < Math.ceil(d.faltam / 5) + 1; tentativa++) {
        const resp = await fetch("/api/questoes/gerar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            disciplinaId: d.disciplinaId ?? disciplinas[0] ?? null, assuntoId: d.assuntoId, quantidade: Math.min(5, faltam),
            tipos: tiposQ, dificuldades: (["facil", "medio", "dificil"] as const).filter((k) => dif[k] > 0),
            estilos: ["conceitual", "aplicacao", "situacao_hipotetica"], bancaEstiloId: bancaId || null, verificarComIA: true,
          }),
        });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(corpo.erro ?? "Falha ao gerar questões com IA.");
        const aprovadas = (corpo.criadas as { status: string }[]).filter((c) => c.status === "aprovada").length;
        geradas += aprovadas;
        faltam -= aprovadas;
        marcar(3, "andamento", `${geradas} de ${alvo} questões geradas e aprovadas`);
        if ((corpo.criadas as unknown[]).length === 0) break;
      }
    }
    return geradas;
  };

  const gerar = async (extra: Partial<EntradaConfigSimulado> = {}) => {
    const problema = validar();
    setErro(problema);
    if (problema) return;
    setOcupado(true);
    setInsuficiente(null);
    setEtapas(ETAPAS_BASE.map((rotulo) => ({ rotulo, estado: "pendente" })));
    try {
      marcar(0, "andamento");
      marcar(1, "andamento");
      let r = await montarSimulado(config(extra));
      if (!r.ok) throw new Error(r.erro);
      marcar(2, "andamento", `${r.dados.plano.ids.length} de ${r.dados.plano.pedido} questões selecionadas do banco`);

      if (r.dados.situacao === "insuficiente" && (extra.gerarComIA ?? gerarComIA) && iaDisponivel) {
        marcar(3, "andamento", "Gerando questões originais a partir dos seus materiais…");
        const geradas = await completarComIA(r.dados.plano);
        marcar(3, geradas > 0 ? "ok" : "aviso", `${geradas} questão(ões) nova(s) aprovada(s)`);
        r = await montarSimulado(config({ ...extra }));
        if (!r.ok) throw new Error(r.erro);
      } else {
        marcar(3, "ok", r.dados.situacao === "criado" ? "Não foi necessário gerar questões" : "Geração com IA desativada");
      }

      if (r.dados.situacao === "insuficiente") {
        marcar(2, "aviso", `Há ${r.dados.plano.ids.length} questão(ões) adequada(s) para ${r.dados.plano.pedido} pedidas`);
        setInsuficiente(r.dados.plano);
        setEtapas((l) => l && l.map((e, k) => (k >= 4 ? { ...e, estado: "pendente" } : e)));
        return;
      }
      marcar(4, "ok");
      marcar(5, "ok");
      router.push(`/simulados/${r.dados.simuladoId}?novo=1`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o simulado.");
      setEtapas((l) => l && l.map((x) => (x.estado === "andamento" ? { ...x, estado: "erro" } : x)));
    } finally {
      setOcupado(false);
    }
  };

  const alternarLista = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader><CardTitle>Tipo de simulado</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {(Object.entries(TIPOS_SIMULADO) as [TipoSimulado, (typeof TIPOS_SIMULADO)[TipoSimulado]][]).map(([chave, t]) => (
              <button key={chave} type="button" onClick={() => setTipo(chave)} aria-pressed={tipo === chave}
                className={cn("rounded-lg border p-3 text-left transition-colors", tipo === chave ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent")}>
                <span className="block text-sm font-medium">{t.rotulo}</span>
                <span className="block text-xs text-muted-foreground">{t.descricao}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Conteúdo</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Campo rotulo="Nome (opcional)" htmlFor="sim-nome"><Input id="sim-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={`${TIPOS_SIMULADO[tipo].rotulo} · ${new Date().toLocaleDateString("pt-BR")}`} /></Campo>
            <div>
              <p className="mb-2 text-sm font-medium">Disciplinas {tipo === "geral" || tipo === "diagnostico" || tipo === "concurso" ? "(vazio = todas as suas)" : ""}</p>
              <div className="flex flex-wrap gap-2">
                {opcoes.disciplinas.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                    <Checkbox checked={disciplinas.includes(d.id)} onCheckedChange={() => { setDisciplinas(alternarLista(disciplinas, d.id)); setAssuntos([]); }} /> {d.nome}
                  </label>
                ))}
                {opcoes.disciplinas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma disciplina cadastrada.</p>}
              </div>
            </div>
            {USA_ASSUNTOS.includes(tipo) && (
              <div>
                <p className="mb-2 text-sm font-medium">Assuntos {tipo !== "assunto" ? "(opcional)" : ""}</p>
                <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                  {assuntosDisponiveis.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <Checkbox checked={assuntos.includes(a.id)} onCheckedChange={() => setAssuntos(alternarLista(assuntos, a.id))} /> {a.nome}
                    </label>
                  ))}
                  {assuntosDisponiveis.length === 0 && <p className="text-sm text-muted-foreground">Escolha uma disciplina para ver os assuntos.</p>}
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo={tipo === "banca" ? "Banca" : "Estilo de banca (opcional)"} htmlFor="sim-banca">
                <Select id="sim-banca" valor={bancaId} aoMudar={setBancaId} opcoes={[{ valor: "", rotulo: "Qualquer" }, ...opcoes.bancas.map((b) => ({ valor: b.id, rotulo: b.sigla }))]} />
              </Campo>
              {tipo === "concurso" && (
                <Campo rotulo="Edital" htmlFor="sim-edital" ajuda={editais.length ? undefined : "Nenhum edital cadastrado: será usada a configuração manual."}>
                  <Select id="sim-edital" valor={editalId} aoMudar={setEditalId} opcoes={[{ valor: "", rotulo: "Configuração manual" }, ...editais.map((e) => ({ valor: e.id, rotulo: e.titulo }))]} />
                </Campo>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Prova</CardTitle></CardHeader>
          <CardContent className="grid gap-5">
            <div>
              <p className="mb-2 text-sm font-medium">Quantidade de questões</p>
              <div className="flex flex-wrap items-center gap-2">
                {QUANTIDADES_SUGERIDAS.map((q) => (
                  <button key={q} type="button" aria-pressed={quantidade === q} onClick={() => setQuantidade(q)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${quantidade === q ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{q}</button>
                ))}
                <Input aria-label="Quantidade personalizada" type="number" min={1} max={300} className="w-24" value={quantidade} onChange={(e) => setQuantidade(Math.max(1, Math.min(300, Number(e.target.value) || 1)))} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Tempo máximo (min)" htmlFor="sim-tempo" ajuda="Vazio = sem limite">
                <Input id="sim-tempo" inputMode="numeric" value={tempo} onChange={(e) => setTempo(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              </Campo>
              <Campo rotulo="Ordem" htmlFor="sim-ordem">
                <Select id="sim-ordem" valor={ordem} aoMudar={(v) => setOrdem(v as typeof ordem)} opcoes={[{ valor: "aleatoria", rotulo: "Aleatória" }, { valor: "organizada", rotulo: "Por disciplina e assunto" }]} />
              </Campo>
              <div>
                <p className="mb-2 text-sm font-medium">Tipos de questão</p>
                <div className="grid gap-1.5">
                  {([["multipla_escolha", "Múltipla escolha"], ["certo_errado", "Certo ou errado"]] as const).map(([v, r]) => (
                    <label key={v} className="flex items-center gap-2 text-sm"><Checkbox checked={tiposQ.includes(v)} onCheckedChange={() => setTiposQ(tiposQ.includes(v) ? tiposQ.filter((x) => x !== v) : [...tiposQ, v])} /> {r}</label>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Distribuição de dificuldade (%)</p>
              <div className="grid grid-cols-3 gap-3">
                {(["facil", "medio", "dificil"] as const).map((k) => (
                  <label key={k} className="grid gap-1 text-xs text-muted-foreground">
                    {k === "facil" ? "Fácil" : k === "medio" ? "Médio" : "Difícil"}
                    <Input type="number" min={0} max={100} value={dif[k]} onChange={(e) => setDif({ ...dif, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { v: incluirRespondidas, set: setIncluirRespondidas, r: "Incluir questões já respondidas" },
                { v: somenteIneditas, set: setSomenteIneditas, r: "Somente questões inéditas para mim" },
                { v: permitePausa, set: setPermitePausa, r: "Permitir pausar" },
                { v: mostrarGabarito, set: setMostrarGabarito, r: "Mostrar gabarito durante a prova (modo estudo)" },
                { v: finalizarAoEsgotar, set: setFinalizarAoEsgotar, r: "Entregar automaticamente ao fim do tempo" },
              ].map((o) => (
                <label key={o.r} className="flex items-center gap-3 text-sm"><Switch checked={o.v} onCheckedChange={o.set} /> {o.r}</label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pontuação</CardTitle>
            <CardDescription>Cada prova tem regras próprias: confira no edital. Não presumimos regra única para nenhuma banca.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Select aria-label="Regra de pontuação" valor={regraId} aoMudar={setRegraId}
              opcoes={[...regras.map((r) => ({ valor: r.id, rotulo: r.nome })), { valor: "", rotulo: "Personalizada" }]} />
            {regra?.descricao && <p className="text-xs text-muted-foreground">{regra.descricao}</p>}
            {!regra && (
              <div className="grid grid-cols-3 gap-3">
                {(["acerto", "erro", "branco"] as const).map((k) => (
                  <label key={k} className="grid gap-1 text-xs text-muted-foreground">
                    Pontos por {k}
                    <Input type="number" step={0.25} value={personalizada[k]} onChange={(e) => setPersonalizada({ ...personalizada, [k]: Number(e.target.value) })} />
                  </label>
                ))}
                <label className="col-span-3 flex items-center gap-2 text-sm"><Checkbox checked={personalizada.naoNegativa} onCheckedChange={(v) => setPersonalizada({ ...personalizada, naoNegativa: v === true })} /> Nota mínima zero</label>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-6 xl:sticky xl:top-20">
        <Card>
          <CardContent className="grid gap-4 p-5">
            <label className="flex items-start gap-3 text-sm">
              <Switch checked={gerarComIA} onCheckedChange={setGerarComIA} disabled={!iaDisponivel} aria-label="Gerar questões com IA se faltar conteúdo" />
              <span>
                <span className="font-medium">Completar com questões geradas por IA</span>
                <span className="block text-xs text-muted-foreground">
                  {iaDisponivel ? "Se o banco não tiver questões suficientes, gera questões originais a partir dos seus PDFs (com custo)." : ia.configurada ? "Orçamento de IA indisponível." : "IA não configurada."}
                </span>
              </span>
            </label>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <Button size="lg" className="h-12 text-base" onClick={() => void gerar()} carregando={ocupado}>
              <Wand2 /> GERAR SIMULADO COM IA
            </Button>
            <p className="text-xs text-muted-foreground">{questoesDisponiveis} questão(ões) aprovada(s) no seu banco.</p>

            {etapas && (
              <ol className="grid gap-2" aria-live="polite">
                {etapas.map((e) => (
                  <li key={e.rotulo} className="flex gap-2 text-sm">
                    {e.estado === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      : e.estado === "andamento" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                      : e.estado === "aviso" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      : e.estado === "erro" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    <span>{e.rotulo}{e.detalhe && <span className="block text-xs text-muted-foreground">{e.detalhe}</span>}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {insuficiente && (
          <Card className="border-warning/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" /> Conteúdo insuficiente</CardTitle>
              <CardDescription>
                Há {insuficiente.ids.length} questão(ões) adequada(s) para os {insuficiente.pedido} pedidos. Nenhuma questão é inventada para completar a quantidade.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {insuficiente.deficits.length > 0 && (
                <ul className="grid gap-1">
                  {insuficiente.deficits.map((d) => <li key={d.grupoId} className="flex justify-between"><span>{d.nome}</span><Badge variant="warning">faltam {d.faltam}</Badge></li>)}
                </ul>
              )}
              <div className="grid gap-2">
                {insuficiente.ids.length > 0 && (
                  <Button onClick={() => void gerar({ aceitarMenos: true, gerarComIA: false })} disabled={ocupado}>Montar com {insuficiente.ids.length} questões</Button>
                )}
                {!incluirRespondidas || somenteIneditas ? (
                  <Button variant="outline" onClick={() => { setIncluirRespondidas(true); setSomenteIneditas(false); void gerar({ incluirRespondidas: true, somenteIneditas: false }); }} disabled={ocupado}>Incluir questões já respondidas</Button>
                ) : null}
                {iaDisponivel && !gerarComIA && (
                  <Button variant="outline" onClick={() => { setGerarComIA(true); void gerar({ gerarComIA: true }); }} disabled={ocupado}><Sparkles /> Gerar as que faltam com IA</Button>
                )}
                {insuficiente.ids.length > 0 && (
                  <Button variant="ghost" onClick={() => setQuantidade(insuficiente.ids.length)}>Reduzir a quantidade para {insuficiente.ids.length}</Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
