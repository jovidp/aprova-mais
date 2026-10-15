"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, PenLine, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "@/components/ui/basicos";
import { Campo, Checkbox, Select, Switch } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import type { OpcoesFiltro } from "@/lib/questoes/filtros";
import type { EstadoIA } from "@/lib/ia/index";
import type { ResultadoGeracao } from "@/lib/questoes/gerador";

const TIPOS = [{ valor: "multipla_escolha", rotulo: "Múltipla escolha" }, { valor: "certo_errado", rotulo: "Certo ou errado" }] as const;
const DIFICULDADES = [{ valor: "facil", rotulo: "Fácil" }, { valor: "medio", rotulo: "Médio" }, { valor: "dificil", rotulo: "Difícil" }] as const;
const ESTILOS = [
  { valor: "conceitual", rotulo: "Conceitual" }, { valor: "interpretacao", rotulo: "Interpretação" }, { valor: "aplicacao", rotulo: "Aplicação prática" },
  { valor: "situacao_hipotetica", rotulo: "Situação hipotética" }, { valor: "analise_juridica", rotulo: "Análise jurídica" },
] as const;
const QUANTIDADES = [5, 10, 15, 20, 30];
const LOTE = 5;

type Tipo = (typeof TIPOS)[number]["valor"];
type Dificuldade = (typeof DIFICULDADES)[number]["valor"];
type Estilo = (typeof ESTILOS)[number]["valor"];

function alternar<T>(lista: T[], valor: T) {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}

export function FormGeracao({ opcoes, ia, inicial }: { opcoes: OpcoesFiltro; ia: EstadoIA; inicial: { materialId: string; disciplinaId: string; assuntoId: string } }) {
  const [disciplinaId, setDisciplinaId] = useState(inicial.disciplinaId);
  const [assuntoId, setAssuntoId] = useState(inicial.assuntoId);
  const [materialId, setMaterialId] = useState(inicial.materialId);
  const [quantidade, setQuantidade] = useState(10);
  const [tipos, setTipos] = useState<Tipo[]>(["multipla_escolha", "certo_errado"]);
  const [dificuldades, setDificuldades] = useState<Dificuldade[]>(["medio", "dificil"]);
  const [estilos, setEstilos] = useState<Estilo[]>(["conceitual", "aplicacao", "situacao_hipotetica"]);
  const [bancaId, setBancaId] = useState("");
  const [verificar, setVerificar] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [feitas, setFeitas] = useState(0);
  const [resultados, setResultados] = useState<ResultadoGeracao[]>([]);
  const [erro, setErro] = useState<string>();
  const parar = useRef(false);

  const assuntos = opcoes.assuntos.filter((a) => a.disciplina_id === disciplinaId);
  const materiais = opcoes.materiais.filter((m) => !disciplinaId || m.disciplina_id === disciplinaId);
  const bloqueada = !ia.configurada || ia.bloqueadaPorOrcamento;

  const gerar = async () => {
    setErro(undefined);
    if (!disciplinaId && !materialId) return setErro("Escolha a disciplina ou o material.");
    if (!tipos.length || !dificuldades.length || !estilos.length) return setErro("Escolha ao menos um tipo, uma dificuldade e um estilo.");
    parar.current = false;
    setRodando(true);
    setFeitas(0);
    setResultados([]);
    let criadas = 0;
    try {
      for (let tentativas = 0; criadas < quantidade && tentativas < Math.ceil(quantidade / LOTE) + 2 && !parar.current; tentativas++) {
        const resposta = await fetch("/api/questoes/gerar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            disciplinaId: disciplinaId || null, assuntoId: assuntoId || null, materialId: materialId || null,
            quantidade: Math.min(LOTE, quantidade - criadas), tipos, dificuldades, estilos, bancaEstiloId: bancaId || null, verificarComIA: verificar,
          }),
        });
        const corpo = await resposta.json().catch(() => ({ erro: "Resposta inválida do servidor." }));
        if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao gerar questões.");
        const r = corpo as ResultadoGeracao;
        criadas += r.criadas.length;
        setFeitas(criadas);
        setResultados((l) => [...l, r]);
        if (r.criadas.length === 0 && r.descartadas.length === 0) break;
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar questões.");
    } finally {
      setRodando(false);
    }
  };

  const todasCriadas = resultados.flatMap((r) => r.criadas);
  const todasDescartadas = resultados.flatMap((r) => r.descartadas);
  const custo = resultados.reduce((s, r) => s + r.custoUsd, 0);
  const pendentes = todasCriadas.filter((c) => c.status === "pendente_revisao").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>O que gerar</CardTitle>
          <CardDescription>O conteúdo vem das seções de teoria dos seus PDFs, priorizando páginas que ainda não viraram questões.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Disciplina" htmlFor="g-disc">
              <Select id="g-disc" valor={disciplinaId} aoMudar={(v) => { setDisciplinaId(v); setAssuntoId(""); setMaterialId(""); }}
                opcoes={[{ valor: "", rotulo: "Selecione" }, ...opcoes.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
            </Campo>
            <Campo rotulo="Assunto (opcional)" htmlFor="g-ass">
              <Select id="g-ass" valor={assuntoId} aoMudar={setAssuntoId} desabilitado={!disciplinaId}
                opcoes={[{ valor: "", rotulo: "Todos" }, ...assuntos.map((a) => ({ valor: a.id, rotulo: a.nome }))]} />
            </Campo>
            <Campo rotulo="Material (opcional)" htmlFor="g-mat">
              <Select id="g-mat" valor={materialId} aoMudar={setMaterialId}
                opcoes={[{ valor: "", rotulo: "Qualquer" }, ...materiais.map((m) => ({ valor: m.id, rotulo: m.titulo }))]} />
            </Campo>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Quantidade</p>
            <div className="flex flex-wrap gap-2">
              {QUANTIDADES.map((q) => (
                <button key={q} type="button" onClick={() => setQuantidade(q)} aria-pressed={quantidade === q}
                  className={`rounded-md border px-3 py-1.5 text-sm ${quantidade === q ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{q}</button>
              ))}
            </div>
          </div>

          {[
            { titulo: "Tipos", itens: TIPOS, valores: tipos as string[], set: (v: string) => setTipos(alternar(tipos, v as Tipo)) },
            { titulo: "Dificuldade", itens: DIFICULDADES, valores: dificuldades as string[], set: (v: string) => setDificuldades(alternar(dificuldades, v as Dificuldade)) },
            { titulo: "Estilos", itens: ESTILOS, valores: estilos as string[], set: (v: string) => setEstilos(alternar(estilos, v as Estilo)) },
          ].map((g) => (
            <div key={g.titulo}>
              <p className="mb-2 text-sm font-medium">{g.titulo}</p>
              <div className="flex flex-wrap gap-2">
                {g.itens.map((i) => (
                  <label key={i.valor} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                    <Checkbox checked={g.valores.includes(i.valor)} onCheckedChange={() => g.set(i.valor)} /> {i.rotulo}
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Estilo de banca (opcional)" htmlFor="g-banca" ajuda="As questões continuam autorais; só o formato se inspira na banca.">
              <Select id="g-banca" valor={bancaId} aoMudar={setBancaId}
                opcoes={[{ valor: "", rotulo: "Sem estilo específico" }, ...opcoes.bancas.map((b) => ({ valor: b.id, rotulo: b.sigla }))]} />
            </Campo>
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <Switch checked={verificar} onCheckedChange={setVerificar} aria-label="Revisão independente por IA" />
              <span>
                <span className="font-medium">Revisão independente</span>
                <span className="block text-xs text-muted-foreground">Uma segunda análise responde às questões sem ver o gabarito. Divergências vão para revisão manual. Aumenta o custo.</span>
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void gerar()} carregando={rodando} disabled={bloqueada}><Sparkles /> Gerar {quantidade} questões</Button>
            {rodando && <Button variant="outline" onClick={() => { parar.current = true; }}>Parar após o lote atual</Button>}
          </div>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader><CardTitle>Inteligência artificial</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {!ia.configurada ? (
              <Aviso tipo="alerta" titulo="IA não configurada">
                Defina <code>IA_PROVEDOR</code> e <code>IA_API_KEY</code> no servidor. Sem IA você ainda pode cadastrar questões
                manualmente ou importar bases licenciadas.
              </Aviso>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Modelo</span><span className="font-mono text-xs">{ia.modelo}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Gasto do mês (plataforma)</span><span>US$ {ia.gastoMesUsd.toFixed(2)} / {ia.orcamentoMensalUsd.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Seu gasto no mês</span><span>US$ {ia.gastoMesUsuarioUsd.toFixed(2)}{ia.limiteUsuarioUsd !== null ? ` / ${ia.limiteUsuarioUsd.toFixed(2)}` : ""}</span></div>
                {ia.bloqueadaPorOrcamento && <Aviso tipo="alerta">{ia.orcamentoMensalUsd <= 0 ? "O orçamento mensal está zerado (IA_ORCAMENTO_MENSAL_USD)." : "Orçamento do mês atingido."} As funções sem IA continuam disponíveis.</Aviso>}
              </>
            )}
          </CardContent>
        </Card>

        {(rodando || resultados.length > 0) && (
          <Card>
            <CardHeader><CardTitle>Resultado</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div>
                <div className="mb-1 flex justify-between"><span>{rodando ? <><Loader2 className="mr-1 inline size-4 animate-spin" />Gerando…</> : "Concluído"}</span><span>{feitas}/{quantidade}</span></div>
                <Progress value={(feitas / quantidade) * 100} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="success"><CheckCircle2 /> {todasCriadas.length - pendentes} aprovadas</Badge>
                <Badge variant="warning"><AlertTriangle /> {pendentes} em revisão</Badge>
                <Badge variant="destructive"><XCircle /> {todasDescartadas.length} descartadas</Badge>
              </div>
              {custo > 0 && <p className="text-xs text-muted-foreground">Custo estimado: US$ {custo.toFixed(4)}</p>}
              {resultados.map((r, i) => (
                <p key={i} className="text-xs text-muted-foreground">Lote {i + 1}: {r.fonte.titulo}, p. {r.fonte.paginas[0]}–{r.fonte.paginas[r.fonte.paginas.length - 1]}{r.fonte.assunto ? ` · ${r.fonte.assunto}` : ""}{r.observacoes ? ` · ${r.observacoes}` : ""}</p>
              ))}
              {todasDescartadas.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Por que algumas foram descartadas</summary>
                  <ul className="mt-2 grid gap-1 text-xs">
                    {todasDescartadas.map((d, i) => <li key={i}><span className="line-clamp-1">{d.enunciado}</span><span className="text-destructive">{d.motivos.join(" ")}</span></li>)}
                  </ul>
                </details>
              )}
              {!rodando && todasCriadas.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {todasCriadas.length - pendentes > 0 && (
                    <Button size="sm" asChild><Link href={`/resolver?${new URLSearchParams({ ...(disciplinaId ? { disciplina: disciplinaId } : {}), ...(assuntoId ? { assunto: assuntoId } : {}), situacao: "ineditas" })}`}><PenLine /> Resolver agora</Link></Button>
                  )}
                  {pendentes > 0 && <Button size="sm" variant="outline" asChild><Link href="/questoes/revisao"><ClipboardCheck /> Revisar pendentes</Link></Button>}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
