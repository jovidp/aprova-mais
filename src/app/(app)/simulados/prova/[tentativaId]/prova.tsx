"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, CloudOff, Flag, Loader2, Pause, Play, Save, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Progress } from "@/components/ui/basicos";
import { Confirmar } from "@/components/ui/sobreposicoes";
import { CartaoQuestao } from "@/components/questoes/cartao-questao";
import type { CorrecaoExibicao, QuestaoExibicao } from "@/lib/questoes/exibicao";
import { cn, formatarCronometro } from "@/lib/utils";
import { finalizarTentativa, pausarTentativa, retomarTentativa, salvarRespostaSimulado } from "../../acoes";

interface QuestaoProva {
  questao_id: string;
  ordem: number;
  tipo: "multipla_escolha" | "certo_errado";
  enunciado: string;
  texto_apoio: string | null;
  dificuldade: string;
  origem: string;
  disciplina: { id: string; nome: string };
  assunto: { id: string; nome: string } | null;
  banca_estilo: string | null;
  alternativas: { id: string; letra: string; texto: string }[];
}

export interface DadosProva {
  agora: string;
  tentativa: { id: string; status: string; iniciada_em: string; prazo_em: string | null; questao_atual: number; tempo_pausado_seg: number };
  simulado: { id: string; nome: string; total_questoes: number; tempo_limite_seg: number | null; permite_pausa: boolean; mostrar_gabarito_durante: boolean; finalizar_ao_esgotar: boolean };
  questoes: QuestaoProva[];
  respostas: { questao_id: string; alternativa_id: string | null; marcada_revisao: boolean; tempo_seg: number; gabarito?: Omit<CorrecaoExibicao, "fontes"> }[];
}

interface EstadoResposta {
  alternativa: string | null;
  marcada: boolean;
  tempo: number;
  correcao?: CorrecaoExibicao;
}

type Pendente = { questaoId: string; alternativa: string | null; marcada: boolean; tempo: number; questaoAtual: number };

export function ProvaSimulado({ inicial }: { inicial: DadosProva }) {
  const router = useRouter();
  const t = inicial.tentativa;
  const chaveLocal = `prova:${t.id}`;
  // Diferença entre o relógio do servidor e o do navegador.
  const deslocamento = useRef(new Date(inicial.agora).getTime() - Date.now());
  const agoraServidor = () => Date.now() + deslocamento.current;

  const [indice, setIndice] = useState(Math.min(Math.max(0, t.questao_atual - 1), inicial.questoes.length - 1));
  const [respostas, setRespostas] = useState<Record<string, EstadoResposta>>(() => {
    const base: Record<string, EstadoResposta> = Object.fromEntries(inicial.questoes.map((q) => [q.questao_id, { alternativa: null, marcada: false, tempo: 0 }]));
    for (const r of inicial.respostas) {
      base[r.questao_id] = { alternativa: r.alternativa_id, marcada: r.marcada_revisao, tempo: r.tempo_seg, correcao: r.gabarito ? { ...r.gabarito, fontes: [] } : undefined };
    }
    return base;
  });
  const [pausada, setPausada] = useState(t.status === "pausada");
  const [prazo] = useState(t.prazo_em ? new Date(t.prazo_em).getTime() : null);
  const [restante, setRestante] = useState<number | null>(prazo ? Math.max(0, (prazo - agoraServidor()) / 1000) : null);
  const [salvando, setSalvando] = useState(false);
  const [offline, setOffline] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const fila = useRef<Pendente[]>([]);
  const processando = useRef(false);
  const inicioQuestao = useRef(Date.now());
  const entregue = useRef(false);

  const questao = inicial.questoes[indice];
  const atual = respostas[questao.questao_id];

  // Recupera respostas não enviadas (queda de conexão / aba fechada).
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(chaveLocal);
      if (salvo) {
        const pendentes = JSON.parse(salvo) as Pendente[];
        if (pendentes.length) {
          setRespostas((r) => {
            const n = { ...r };
            for (const p of pendentes) n[p.questaoId] = { ...n[p.questaoId], alternativa: p.alternativa, marcada: p.marcada, tempo: Math.max(n[p.questaoId]?.tempo ?? 0, p.tempo) };
            return n;
          });
          fila.current.push(...pendentes);
          void processarFila();
          toast.info("Respostas guardadas neste dispositivo foram recuperadas.");
        }
      }
    } catch {
      // Sem acesso ao armazenamento local: segue só com o servidor.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistirFila = useCallback(() => {
    try {
      if (fila.current.length) localStorage.setItem(chaveLocal, JSON.stringify(fila.current));
      else localStorage.removeItem(chaveLocal);
    } catch {
      // ignora
    }
  }, [chaveLocal]);

  const irParaResultado = useCallback(() => {
    entregue.current = true;
    try { localStorage.removeItem(chaveLocal); } catch { /* ignora */ }
    router.replace(`/simulados/resultado/${t.id}`);
  }, [chaveLocal, router, t.id]);

  /** Envia as respostas em ordem; em falha de rede, guarda localmente e tenta de novo. */
  const processarFila = useCallback(async () => {
    if (processando.current) return;
    processando.current = true;
    setSalvando(true);
    try {
      while (fila.current.length) {
        // Envia apenas a versão mais recente de cada questão.
        const item = fila.current[0];
        const ultima = [...fila.current].reverse().find((p) => p.questaoId === item.questaoId)!;
        const r = await salvarRespostaSimulado({ tentativaId: t.id, questaoId: ultima.questaoId, alternativaId: ultima.alternativa, marcada: ultima.marcada, tempoSeg: ultima.tempo, questaoAtual: ultima.questaoAtual }).catch(() => null);
        if (!r) {
          setOffline(true);
          persistirFila();
          await new Promise((res) => setTimeout(res, 4000));
          continue;
        }
        setOffline(false);
        if (!r.ok) {
          if (/não está em andamento/.test(r.erro)) { irParaResultado(); return; }
          toast.error(r.erro);
          fila.current = fila.current.filter((p) => p.questaoId !== item.questaoId);
          persistirFila();
          continue;
        }
        if (r.dados.expirado) { toast.info("Tempo esgotado: a prova foi entregue automaticamente."); irParaResultado(); return; }
        if (r.dados.gabarito) {
          const g = r.dados.gabarito;
          setRespostas((rs) => ({ ...rs, [ultima.questaoId]: { ...rs[ultima.questaoId], correcao: { ...g, fontes: [] } } }));
        }
        fila.current = fila.current.filter((p) => p.questaoId !== item.questaoId);
        persistirFila();
      }
    } finally {
      processando.current = false;
      setSalvando(false);
    }
  }, [irParaResultado, persistirFila, t.id]);

  const registrar = useCallback((questaoId: string, mudanca: Partial<EstadoResposta>) => {
    const tempoGasto = Math.round((Date.now() - inicioQuestao.current) / 1000);
    setRespostas((rs) => {
      const novo = { ...rs[questaoId], ...mudanca, tempo: (rs[questaoId]?.tempo ?? 0) + tempoGasto };
      fila.current.push({ questaoId, alternativa: novo.alternativa, marcada: novo.marcada, tempo: novo.tempo, questaoAtual: indice + 1 });
      persistirFila();
      return { ...rs, [questaoId]: novo };
    });
    inicioQuestao.current = Date.now();
    void processarFila();
  }, [indice, persistirFila, processarFila]);

  const entregar = useCallback(async (porTempo = false) => {
    if (entregue.current) return;
    setEntregando(true);
    // Garante que respostas pendentes sejam enviadas antes da entrega.
    for (let i = 0; i < 20 && fila.current.length; i++) {
      await processarFila();
      if (fila.current.length) await new Promise((r) => setTimeout(r, 500));
    }
    const r = await finalizarTentativa(t.id);
    setEntregando(false);
    if (r.ok) {
      if (porTempo) toast.info("Tempo esgotado: prova entregue.");
      irParaResultado();
    } else toast.error(r.erro);
  }, [irParaResultado, processarFila, t.id]);

  // Cronômetro regressivo (prazo validado no servidor).
  useEffect(() => {
    if (!prazo || pausada) return;
    const timer = setInterval(() => {
      const s = Math.max(0, (prazo - agoraServidor()) / 1000);
      setRestante(s);
      if (s <= 0 && inicial.simulado.finalizar_ao_esgotar) {
        clearInterval(timer);
        void entregar(true);
      }
    }, 500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prazo, pausada]);

  // Tempo decorrido (simulados sem limite).
  const [decorrido, setDecorrido] = useState(0);
  useEffect(() => {
    if (prazo || pausada) return;
    const inicio = new Date(t.iniciada_em).getTime();
    const timer = setInterval(() => setDecorrido(Math.max(0, (agoraServidor() - inicio) / 1000 - t.tempo_pausado_seg)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prazo, pausada]);

  // Aviso ao sair com respostas não enviadas.
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => { if (fila.current.length && !entregue.current) e.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, []);

  const irPara = (n: number) => {
    const alvo = Math.max(0, Math.min(inicial.questoes.length - 1, n));
    if (alvo === indice) return;
    // Registra o tempo gasto na questão que está sendo deixada.
    const id = questao.questao_id;
    const gasto = Math.round((Date.now() - inicioQuestao.current) / 1000);
    if (gasto > 2) {
      setRespostas((rs) => {
        const novo = { ...rs[id], tempo: rs[id].tempo + gasto };
        fila.current.push({ questaoId: id, alternativa: novo.alternativa, marcada: novo.marcada, tempo: novo.tempo, questaoAtual: alvo + 1 });
        persistirFila();
        return { ...rs, [id]: novo };
      });
      void processarFila();
    }
    inicioQuestao.current = Date.now();
    setIndice(alvo);
    window.scrollTo({ top: 0 });
  };

  // Atalhos: ← → navegam; M marca para revisão.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(alvo.tagName) || pausada) return;
      if (e.key === "ArrowRight") irPara(indice + 1);
      else if (e.key === "ArrowLeft") irPara(indice - 1);
      else if (e.key.toLowerCase() === "m" && !e.ctrlKey) registrar(questao.questao_id, { marcada: !atual.marcada });
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  const contagem = useMemo(() => {
    const valores = Object.values(respostas);
    return {
      respondidas: valores.filter((r) => r.alternativa).length,
      marcadas: valores.filter((r) => r.marcada).length,
    };
  }, [respostas]);
  const brancos = inicial.questoes.length - contagem.respondidas;

  const exibicao: QuestaoExibicao = {
    id: questao.questao_id, tipo: questao.tipo, enunciado: questao.enunciado, texto_apoio: questao.texto_apoio, dificuldade: questao.dificuldade,
    origem: questao.origem, disciplina: questao.disciplina.nome, assunto: questao.assunto?.nome ?? null, banca_estilo: questao.banca_estilo,
    alternativas: questao.alternativas,
  };
  const travada = Boolean(inicial.simulado.mostrar_gabarito_durante && atual.correcao);
  const urgente = restante !== null && restante < 300;

  return (
    <div className="grid gap-4">
      <div className="sticky top-16 z-20 -mx-4 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{inicial.simulado.nome}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{contagem.respondidas}/{inicial.questoes.length} respondidas</span>
            {salvando ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> salvando</span>
              : offline ? <span className="inline-flex items-center gap-1 text-warning-foreground dark:text-warning"><CloudOff className="size-3" /> sem conexão: respostas guardadas neste dispositivo</span>
              : <span className="inline-flex items-center gap-1"><Save className="size-3" /> salvo</span>}
          </div>
        </div>
        <div className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-sm tabular-nums", urgente && "border-destructive text-destructive")} role="timer" aria-live={urgente ? "assertive" : "off"} aria-label="Tempo">
          <Timer className="size-4" /> {restante !== null ? formatarCronometro(restante) : formatarCronometro(decorrido)}
        </div>
        {inicial.simulado.permite_pausa && (
          <Button variant="outline" size="sm" onClick={async () => {
            const r = await pausarTentativa(t.id);
            if (!r.ok) return toast.error(r.erro);
            if (r.dados.expirado) return irParaResultado();
            setPausada(true);
          }}><Pause /> Pausar</Button>
        )}
        <Confirmar
          titulo="Entregar a prova?"
          descricao={
            <div className="grid gap-1">
              <span>{contagem.respondidas} de {inicial.questoes.length} questões respondidas.</span>
              {brancos > 0 && <span className="text-destructive">{brancos} em branco.</span>}
              {contagem.marcadas > 0 && <span>{contagem.marcadas} marcada(s) para revisão.</span>}
              <span>Depois de entregar não é possível alterar as respostas.</span>
            </div>
          }
          confirmar="Entregar"
          aoConfirmar={() => entregar()}
        >
          <Button size="sm" carregando={entregando}><Flag /> Finalizar</Button>
        </Confirmar>
      </div>

      {restante !== null && <Progress value={inicial.simulado.tempo_limite_seg ? (100 * restante) / inicial.simulado.tempo_limite_seg : 0} indicadorClassName={urgente ? "bg-destructive" : undefined} aria-label="Tempo restante" />}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardContent className="p-5 sm:p-6">
              <CartaoQuestao
                questao={exibicao} numero={indice + 1} total={inicial.questoes.length} atalhos={!travada && !pausada}
                selecionada={atual.alternativa}
                aoSelecionar={travada || pausada ? undefined : (id) => registrar(questao.questao_id, { alternativa: id })}
                correcao={inicial.simulado.mostrar_gabarito_durante ? atual.correcao ?? null : null}
              />
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" onClick={() => irPara(indice - 1)} disabled={indice === 0}><ArrowLeft /> Anterior</Button>
            <div className="flex gap-2">
              {atual.alternativa && !travada && (
                <Button variant="ghost" onClick={() => registrar(questao.questao_id, { alternativa: null })}>Limpar resposta</Button>
              )}
              <Button variant={atual.marcada ? "secondary" : "outline"} onClick={() => registrar(questao.questao_id, { marcada: !atual.marcada })} aria-pressed={atual.marcada}>
                {atual.marcada ? <BookmarkCheck /> : <Bookmark />} {atual.marcada ? "Marcada" : "Marcar para revisão"}
              </Button>
            </div>
            <Button onClick={() => irPara(indice + 1)} disabled={indice === inicial.questoes.length - 1}>Próxima <ArrowRight /></Button>
          </div>
        </div>

        <aside className="grid content-start gap-3">
          <Card>
            <CardContent className="grid gap-3 p-4">
              <p className="text-sm font-medium">Cartão-resposta</p>
              <div className="grid grid-cols-5 gap-1.5" role="navigation" aria-label="Cartão-resposta">
                {inicial.questoes.map((q, i) => {
                  const r = respostas[q.questao_id];
                  const letra = q.alternativas.find((a) => a.id === r.alternativa)?.letra;
                  return (
                    <button key={q.questao_id} onClick={() => irPara(i)} aria-current={i === indice}
                      aria-label={`Questão ${i + 1}: ${letra ? `resposta ${letra}` : "em branco"}${r.marcada ? ", marcada para revisão" : ""}`}
                      className={cn("relative flex aspect-square flex-col items-center justify-center rounded border text-[11px] leading-none font-medium",
                        letra ? "border-primary bg-primary/10" : "bg-muted", i === indice && "ring-2 ring-ring ring-offset-1")}>
                      <span>{i + 1}</span>
                      {letra && <span className="text-[10px] text-primary">{letra}</span>}
                      {r.marcada && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning" aria-hidden />}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="info">{contagem.respondidas} respondidas</Badge>
                <Badge variant="outline">{brancos} em branco</Badge>
                <Badge variant="warning">{contagem.marcadas} marcadas</Badge>
              </div>
            </CardContent>
          </Card>
          {inicial.simulado.mostrar_gabarito_durante && (
            <p className="flex gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="size-3.5 shrink-0" /> Modo estudo: a correção aparece ao responder e a resposta não pode ser trocada.</p>
          )}
          <p className="hidden text-xs text-muted-foreground lg:block">Atalhos: letras escolhem, ← → navegam, M marca para revisão.</p>
        </aside>
      </div>

      {pausada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-label="Prova pausada">
          <div className="text-center">
            <Pause className="mx-auto size-12 text-muted-foreground" />
            <p className="mt-4 text-xl font-semibold">Prova pausada</p>
            <p className="mt-1 text-sm text-muted-foreground">O tempo está parado. As questões ficam ocultas até você retomar.</p>
            <Button className="mt-6" size="lg" onClick={async () => {
              const r = await retomarTentativa(t.id);
              if (!r.ok) return toast.error(r.erro);
              // O servidor estendeu o prazo pelo tempo de pausa: recarrega a prova com o novo prazo.
              window.location.reload();
            }}><Play /> Retomar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
