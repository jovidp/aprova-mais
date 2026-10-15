"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Bot, CheckCircle2, Clock, HelpCircle, Layers, Star, Trophy, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Progress, Textarea } from "@/components/ui/basicos";
import { Indicador } from "@/components/ui/layout";
import { CartaoQuestao } from "./cartao-questao";
import type { CorrecaoExibicao, QuestaoExibicao } from "@/lib/questoes/exibicao";
import { resumirSessao, type TentativaSessao } from "@/lib/estudo/estatisticas";
import { formatarCronometro, formatarDuracao, formatarPercentual } from "@/lib/utils";
import {
  alternarFavoritoQuestao, atualizarSessao, obterCorrecao, registrarTempoQuestoes, responderQuestao, salvarMarcacao,
} from "@/app/(app)/questoes/acoes";
import { criarFlashcard } from "@/app/(app)/flashcards/acoes";

interface EstadoQuestao {
  selecionada: string | null;
  correcao: CorrecaoExibicao | null;
  correta?: boolean;
  tempoSeg: number;
}

interface Props {
  questoes: QuestaoExibicao[];
  sessaoId?: string;
  posicaoInicial?: number;
  favoritas: string[];
  marcadas: string[];
  duvidas: Record<string, string>;
  /** Questões já respondidas antes (sessão retomada): mostra a correção. */
  jaRespondidas?: Record<string, { alternativaId: string | null; correta: boolean; tempoSeg: number }>;
  contexto?: "pratica" | "revisao" | "diagnostico";
}

export function Resolvedor({ questoes, sessaoId, posicaoInicial = 0, favoritas, marcadas, duvidas, jaRespondidas = {}, contexto = "pratica" }: Props) {
  const [indice, setIndice] = useState(Math.min(posicaoInicial, questoes.length - 1));
  const [estado, setEstado] = useState<Record<string, EstadoQuestao>>(() =>
    Object.fromEntries(questoes.map((q) => [q.id, {
      selecionada: jaRespondidas[q.id]?.alternativaId ?? null, correcao: null, correta: jaRespondidas[q.id]?.correta,
      tempoSeg: jaRespondidas[q.id]?.tempoSeg ?? 0,
    }])),
  );
  const [fav, setFav] = useState(() => new Set(favoritas));
  const [marc, setMarc] = useState(() => new Set(marcadas));
  const [duvida, setDuvida] = useState<Record<string, string>>(duvidas);
  const [mostrarDuvida, setMostrarDuvida] = useState(false);
  const [tentativas, setTentativas] = useState<TentativaSessao[]>([]);
  const [finalizada, setFinalizada] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [agora, setAgora] = useState(() => Date.now());
  const inicioQuestao = useRef(Date.now());
  const inicioSessao = useRef(new Date());
  const chaves = useRef<Record<string, string>>({});

  const questao = questoes[indice];
  const atual = estado[questao.id];
  const respondida = Boolean(atual.correcao) || atual.correta !== undefined;

  // Cronômetro da questão atual (para quando corrigida).
  useEffect(() => {
    inicioQuestao.current = Date.now() - (atual.correcao ? 0 : atual.tempoSeg * 1000);
    setMostrarDuvida(Boolean(duvida[questao.id]));
    // Ao voltar a uma questão já respondida em sessão anterior, carrega a correção.
    if (atual.correta !== undefined && !atual.correcao) {
      void obterCorrecao(questao.id).then((r) => r.ok && setEstado((e) => ({ ...e, [questao.id]: { ...e[questao.id], correcao: r.dados } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questao.id]);

  useEffect(() => {
    if (respondida || finalizada) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [respondida, finalizada]);

  const segundos = respondida ? atual.tempoSeg : Math.round((agora - inicioQuestao.current) / 1000);

  const irPara = useCallback((n: number) => {
    const alvo = Math.max(0, Math.min(questoes.length - 1, n));
    setEstado((e) => (e[questao.id].correcao ? e : { ...e, [questao.id]: { ...e[questao.id], tempoSeg: Math.round((Date.now() - inicioQuestao.current) / 1000) } }));
    setIndice(alvo);
    if (sessaoId) void atualizarSessao({ sessaoId, posicao: alvo });
  }, [questao.id, questoes.length, sessaoId]);

  const confirmar = () => {
    if (!atual.selecionada || respondida) return;
    const tempo = Math.round((Date.now() - inicioQuestao.current) / 1000);
    chaves.current[questao.id] ??= crypto.randomUUID();
    iniciar(async () => {
      const r = await responderQuestao({ questaoId: questao.id, alternativaId: atual.selecionada!, tempoSeg: tempo, sessaoId: sessaoId ?? null, chave: chaves.current[questao.id], contexto });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      setEstado((e) => ({ ...e, [questao.id]: { ...e[questao.id], correcao: r.dados, correta: r.dados.correta, tempoSeg: tempo } }));
      setTentativas((l) => [...l, { questaoId: questao.id, correta: r.dados.correta, tempoSeg: tempo, assunto: questao.assunto ?? null, ordem: l.length }]);
    });
  };

  // Atalhos: Enter confirma/avança; ← → navegam.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(alvo.tagName) || finalizada) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!respondida) confirmar();
        else if (indice < questoes.length - 1) irPara(indice + 1);
      } else if (e.key === "ArrowRight") irPara(indice + 1);
      else if (e.key === "ArrowLeft") irPara(indice - 1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  const finalizar = () => {
    setFinalizada(true);
    if (sessaoId) void atualizarSessao({ sessaoId, posicao: indice, status: "concluida" });
    void registrarTempoQuestoes({ inicio: inicioSessao.current.toISOString(), fim: new Date().toISOString() });
  };

  const resumo = useMemo(() => resumirSessao(tentativas), [tentativas]);
  const respondidasNaLista = questoes.filter((q) => estado[q.id].correcao || estado[q.id].correta !== undefined).length;

  if (finalizada) {
    return (
      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="size-5 text-warning" /> Resumo da sessão</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador rotulo="Respondidas" valor={resumo.respondidas} detalhe={`${resumo.questoesUnicas} questões diferentes`} />
              <Indicador rotulo="Acertos / erros" valor={`${resumo.acertos} / ${resumo.erros}`} />
              <Indicador rotulo="Acerto (tentativas)" valor={formatarPercentual(resumo.percentualTentativas)} detalhe={`Por questões únicas: ${formatarPercentual(resumo.percentualUnicas)}`} />
              <Indicador rotulo="Tempo" valor={formatarDuracao(resumo.tempoTotalSeg)} detalhe={`Média ${formatarDuracao(resumo.tempoMedioSeg)} por questão`} />
            </div>
            {resumo.assuntosComMaisErros.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Assuntos com maior dificuldade nesta sessão</p>
                <ul className="grid gap-1 text-sm">
                  {resumo.assuntosComMaisErros.map((a) => (
                    <li key={a.assunto} className="flex justify-between rounded-md border px-3 py-2">
                      <span>{a.assunto}</span><span className="text-destructive">{a.erros} erro(s) em {a.total}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resumo.respondidas === 0 && <p className="text-sm text-muted-foreground">Nenhuma questão foi respondida nesta sessão.</p>}
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/resolver">Nova sessão</Link></Button>
              {resumo.erros > 0 && <Button variant="outline" asChild><Link href="/caderno-erros">Ver caderno de erros</Link></Button>}
              <Button variant="ghost" asChild><Link href="/dashboard">Dashboard</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-4" /> <span className="font-mono tabular-nums">{formatarCronometro(segundos)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-pressed={fav.has(questao.id)} aria-label={fav.has(questao.id) ? "Remover dos favoritos" : "Favoritar"}
              onClick={() => {
                const novo = !fav.has(questao.id);
                setFav((s) => { const n = new Set(s); if (novo) n.add(questao.id); else n.delete(questao.id); return n; });
                void alternarFavoritoQuestao(questao.id, novo);
              }}>
              <Star className={fav.has(questao.id) ? "fill-warning text-warning" : ""} />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-pressed={marc.has(questao.id)} aria-label="Marcar para revisão"
              onClick={() => {
                const novo = !marc.has(questao.id);
                setMarc((s) => { const n = new Set(s); if (novo) n.add(questao.id); else n.delete(questao.id); return n; });
                void salvarMarcacao({ questaoId: questao.id, marcadaRevisao: novo });
              }}>
              {marc.has(questao.id) ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Registrar dúvida" aria-pressed={mostrarDuvida} onClick={() => setMostrarDuvida(!mostrarDuvida)}><HelpCircle /></Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-5 sm:p-6">
            <CartaoQuestao
              questao={questao} numero={indice + 1} total={questoes.length} atalhos
              selecionada={atual.selecionada}
              aoSelecionar={(id) => setEstado((e) => ({ ...e, [questao.id]: { ...e[questao.id], selecionada: id } }))}
              correcao={atual.correcao}
            />
          </CardContent>
        </Card>

        {mostrarDuvida && (
          <Card>
            <CardContent className="grid gap-2 p-4">
              <Textarea aria-label="Sua dúvida sobre esta questão" placeholder="Anote sua dúvida para revisar depois" value={duvida[questao.id] ?? ""}
                onChange={(e) => setDuvida({ ...duvida, [questao.id]: e.target.value })} />
              <Button size="sm" variant="outline" className="justify-self-start"
                onClick={async () => { const r = await salvarMarcacao({ questaoId: questao.id, duvida: duvida[questao.id] ?? "" }); if (r.ok) toast.success("Dúvida registrada"); else toast.error(r.erro); }}>
                Salvar dúvida
              </Button>
            </CardContent>
          </Card>
        )}

        {atual.correcao && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tutor?pergunta=${encodeURIComponent(`Explique por que ${atual.correta ? "acertei" : "errei"} esta questão: "${questao.enunciado.slice(0, 500)}"`)}&questao=${questao.id}`}><Bot /> Perguntar ao Tutor</Link>
            </Button>
            <Button variant="outline" size="sm"
              onClick={async () => {
                const correta = questao.alternativas.find((a) => a.id === atual.correcao!.alternativa_correta_id);
                const r = await criarFlashcard({ frente: questao.enunciado.slice(0, 2000), verso: `${correta ? `${correta.letra}) ${correta.texto}\n\n` : ""}${atual.correcao!.explicacao}`.slice(0, 4000), questaoId: questao.id, origem: atual.correta ? "questao" : "erro" });
                if (r.ok) toast.success("Flashcard criado"); else toast.error(r.erro);
              }}>
              <Layers /> Gerar flashcard
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => irPara(indice - 1)} disabled={indice === 0}><ArrowLeft /> Anterior</Button>
          {!respondida ? (
            <Button onClick={confirmar} disabled={!atual.selecionada} carregando={pendente}>Confirmar resposta</Button>
          ) : indice < questoes.length - 1 ? (
            <Button onClick={() => irPara(indice + 1)}>Próxima <ArrowRight /></Button>
          ) : (
            <Button variant="success" onClick={finalizar}>Finalizar sessão</Button>
          )}
        </div>
      </div>

      <aside className="grid content-start gap-4">
        <Card>
          <CardContent className="grid gap-3 p-4">
            <div className="flex justify-between text-sm"><span>Progresso</span><span className="tabular-nums">{respondidasNaLista}/{questoes.length}</span></div>
            <Progress value={(respondidasNaLista / questoes.length) * 100} />
            <div className="flex gap-2 text-xs">
              <Badge variant="success"><CheckCircle2 /> {tentativas.filter((t) => t.correta).length}</Badge>
              <Badge variant="destructive"><XCircle /> {tentativas.filter((t) => !t.correta).length}</Badge>
            </div>
            <div className="grid grid-cols-6 gap-1.5" role="navigation" aria-label="Questões da sessão">
              {questoes.map((q, i) => {
                const e = estado[q.id];
                const cor = e.correta === true ? "bg-success text-success-foreground" : e.correta === false ? "bg-destructive text-destructive-foreground" : e.selecionada ? "bg-primary/20" : "bg-muted";
                return (
                  <button key={q.id} onClick={() => irPara(i)} aria-label={`Ir para questão ${i + 1}`} aria-current={i === indice}
                    className={`aspect-square rounded text-xs font-medium ${cor} ${i === indice ? "ring-2 ring-ring ring-offset-1" : ""}`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <Button variant="ghost" size="sm" onClick={finalizar}>Encerrar e ver resumo</Button>
          </CardContent>
        </Card>
        <p className="hidden text-xs text-muted-foreground lg:block">Atalhos: letras escolhem a alternativa, Enter confirma/avança, ← → navegam.</p>
      </aside>
    </div>
  );
}
