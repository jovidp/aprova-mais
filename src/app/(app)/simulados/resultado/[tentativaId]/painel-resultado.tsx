"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { BookOpen, Bot, CalendarClock, CheckCircle2, Layers, MinusCircle, NotebookPen, PenLine, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Aviso, Indicador } from "@/components/ui/layout";
import { GraficoBarras, GraficoLinha } from "@/components/graficos/graficos";
import { CartaoQuestao } from "@/components/questoes/cartao-questao";
import type { CorrecaoExibicao, FonteCorrecao } from "@/lib/questoes/exibicao";
import type { Analise, ResultadoProva } from "@/lib/simulados/analise";
import type { Recomendacao } from "@/lib/simulados/integracao";
import { formatarDuracao, formatarPercentual, ROTULO_DIFICULDADE } from "@/lib/utils";
import { adicionarAoCaderno, aplicarAjusteCronograma, atualizarRecomendacao } from "../../acoes";
import { criarFlashcard } from "../../../flashcards/acoes";

export interface QuestaoCorrigida {
  questao_id: string;
  ordem: number;
  tipo: "multipla_escolha" | "certo_errado";
  enunciado: string;
  texto_apoio: string | null;
  dificuldade: string;
  origem: string;
  banca_estilo: string | null;
  disciplina: { id: string; nome: string };
  assunto: { id: string; nome: string } | null;
  alternativas: { id: string; letra: string; texto: string }[];
  gabarito: { alternativa_correta_id: string; explicacao: string; justificativas: Record<string, string> };
  fontes: FonteCorrecao[];
  resposta: { alternativa_id: string | null; marcada_revisao: boolean; tempo_seg: number };
  resultado: "acerto" | "erro" | "branco";
}

type Filtro = "todas" | "erro" | "branco" | "acerto" | "marcadas";

export function PainelResultado({ resultado: r, questoes, analise, recomendacoes, anteriores, noCaderno, observacoes }: {
  resultado: ResultadoProva & { regra: Record<string, number | boolean> };
  questoes: QuestaoCorrigida[];
  analise: Analise;
  recomendacoes: Recomendacao[];
  anteriores: { id: string; data: string; percentual: number; nome: string; atual: boolean }[];
  noCaderno: string[];
  observacoes: string[];
}) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [caderno, setCaderno] = useState(() => new Set(noCaderno));
  const [recs, setRecs] = useState(recomendacoes);
  const [pendente, iniciar] = useTransition();

  const lista = useMemo(() => questoes.filter((q) =>
    filtro === "todas" ? true : filtro === "marcadas" ? q.resposta.marcada_revisao : q.resultado === filtro), [questoes, filtro]);
  const pct = (a: number, t: number) => (t ? Math.round((1000 * a) / t) / 10 : null);

  return (
    <div className="grid gap-6">
      {observacoes.length > 0 && <Aviso tipo="info">{observacoes.join(" ")}</Aviso>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Nota final" valor={`${Number(r.nota).toLocaleString("pt-BR")} / ${Number(r.nota_maxima).toLocaleString("pt-BR")}`}
          detalhe={`Regra: +${r.regra.pontos_acerto} acerto · ${Number(r.regra.pontos_erro) > 0 ? "+" : ""}${r.regra.pontos_erro} erro · ${r.regra.pontos_branco} branco`} />
        <Indicador rotulo="Percentual de acertos" valor={formatarPercentual(Number(r.percentual_acerto_total))} detalhe={`Sobre as respondidas: ${formatarPercentual(r.percentual_acerto === null ? null : Number(r.percentual_acerto))}`} />
        <Indicador rotulo="Acertos · erros · brancos" valor={<span className="flex gap-3"><span className="text-success">{r.acertos}</span><span className="text-destructive">{r.erros}</span><span className="text-muted-foreground">{r.brancos}</span></span>} detalhe={`${r.total} questões`} />
        <Indicador rotulo="Tempo" valor={formatarDuracao(r.tempo_total_seg)} detalhe={`Média de ${formatarDuracao(Number(r.tempo_medio_seg))} por questão`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Análise do desempenho</CardTitle><CardDescription>Calculada a partir das suas respostas nesta prova.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {analise.paragrafos.map((p, i) => <p key={i}>{p}</p>)}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 flex items-center gap-1 font-medium text-success"><ThumbsUp className="size-4" /> Pontos fortes</p>
                {analise.pontosFortes.length ? <ul className="grid gap-0.5 text-xs">{analise.pontosFortes.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nenhum assunto com 80% ou mais (mín. 2 questões).</p>}
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 font-medium text-destructive"><ThumbsDown className="size-4" /> Pontos fracos</p>
                {analise.pontosFracos.length ? <ul className="grid gap-0.5 text-xs">{analise.pontosFracos.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nenhum assunto abaixo de 60% (mín. 2 questões).</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Próximos passos</CardTitle><CardDescription>Revisões já foram agendadas para os assuntos críticos.</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {recs.filter((x) => x.status === "ativa").map((rec) => (
              <div key={rec.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{rec.titulo}</p>
                  <p className="text-xs text-muted-foreground">{rec.descricao}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {rec.tipo === "revisar_material" && rec.material_id && (
                    <Button size="sm" variant="outline" asChild><Link href={`/biblioteca/${rec.material_id}/ler?pagina=${rec.pagina_inicio ?? 1}`}><BookOpen /> Abrir</Link></Button>
                  )}
                  {rec.tipo === "resolver_questoes" && rec.assunto_id && (
                    <Button size="sm" variant="outline" asChild><Link href={`/resolver?assunto=${rec.assunto_id}`}><PenLine /> Resolver</Link></Button>
                  )}
                  {rec.tipo === "fazer_simulado" && <Button size="sm" variant="outline" asChild><Link href="/simulados/gerar?tipo=adaptativo">Novo simulado</Link></Button>}
                  {rec.tipo === "ajuste_cronograma" && (
                    <Button size="sm" variant="outline" disabled={pendente} onClick={() => iniciar(async () => {
                      const res = await aplicarAjusteCronograma(rec.id);
                      if (res.ok) { toast.success(`Cronograma reorganizado: ${res.dados.criadas} atividade(s) futuras.`); setRecs((l) => l.map((x) => (x.id === rec.id ? { ...x, status: "aceita" } : x))); }
                      else toast.error(res.erro);
                    })}><CalendarClock /> Aplicar</Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label="Descartar recomendação" onClick={async () => { await atualizarRecomendacao(rec.id, "descartada"); setRecs((l) => l.map((x) => (x.id === rec.id ? { ...x, status: "descartada" } : x))); }}>×</Button>
                </div>
              </div>
            ))}
            {recs.filter((x) => x.status === "ativa").length === 0 && <p className="text-sm text-muted-foreground">Nenhuma recomendação pendente.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoBarras titulo="Acertos por disciplina" nomeSerie="Acerto" formato="percentual" horizontal dominio={[0, 100]}
          dados={r.por_disciplina.map((d) => ({ rotulo: d.nome, valor: pct(d.acertos, d.total), detalhe: `${d.acertos} de ${d.total}` }))} />
        <GraficoBarras titulo="Erros por assunto" descricao="Erros + questões em branco" nomeSerie="Erros e brancos" horizontal cor="var(--chart-2)" vazio="Nenhum erro nesta prova."
          dados={[...r.por_assunto].sort((a, b) => b.erros + b.brancos - (a.erros + a.brancos)).filter((a) => a.erros + a.brancos > 0).slice(0, 10)
            .map((a) => ({ rotulo: a.nome, valor: a.erros + a.brancos, detalhe: `${a.acertos} acerto(s) de ${a.total}` }))} />
        <GraficoBarras titulo="Desempenho por dificuldade" nomeSerie="Acerto" formato="percentual" dominio={[0, 100]}
          dados={["facil", "medio", "dificil"].flatMap((d) => { const x = r.por_dificuldade.find((p) => p.dificuldade === d); return x ? [{ rotulo: ROTULO_DIFICULDADE[d], valor: pct(x.acertos, x.total), detalhe: `${x.acertos} de ${x.total}` }] : []; })} />
        <GraficoLinha titulo="Comparação com simulados anteriores" descricao="Percentual de acertos sobre o total de questões" nomeSerie="Acerto" formato="percentual" dominio={[0, 100]}
          dados={anteriores.map((a) => ({ rotulo: new Date(a.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + (a.atual ? " (este)" : ""), valor: a.percentual, detalhe: a.nome }))} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Correção comentada</CardTitle>
          <div className="flex flex-wrap gap-1 pt-2" role="tablist">
            {([["todas", `Todas (${questoes.length})`], ["erro", `Erradas (${r.erros})`], ["branco", `Em branco (${r.brancos})`], ["acerto", `Certas (${r.acertos})`], ["marcadas", "Marcadas"]] as [Filtro, string][]).map(([f, rot]) => (
              <button key={f} role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
                className={`rounded-md px-3 py-1 text-sm ${filtro === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{rot}</button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          {lista.map((q) => {
            const correcao: CorrecaoExibicao = { ...q.gabarito, fontes: q.fontes };
            const correta = q.alternativas.find((a) => a.id === q.gabarito.alternativa_correta_id);
            return (
              <div key={q.questao_id} className="grid gap-3 border-b pb-6 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 text-sm">
                  {q.resultado === "acerto" ? <CheckCircle2 className="size-4 text-success" /> : q.resultado === "erro" ? <XCircle className="size-4 text-destructive" /> : <MinusCircle className="size-4 text-muted-foreground" />}
                  <span className="font-medium">{q.resultado === "acerto" ? "Acertou" : q.resultado === "erro" ? "Errou" : "Em branco"}</span>
                  <span className="text-muted-foreground">· {formatarDuracao(q.resposta.tempo_seg)}</span>
                  {q.resposta.marcada_revisao && <Badge variant="warning">marcada</Badge>}
                </div>
                <CartaoQuestao
                  questao={{ id: q.questao_id, tipo: q.tipo, enunciado: q.enunciado, texto_apoio: q.texto_apoio, dificuldade: q.dificuldade, origem: q.origem,
                    disciplina: q.disciplina.nome, assunto: q.assunto?.nome ?? null, banca_estilo: q.banca_estilo, alternativas: q.alternativas }}
                  numero={q.ordem} selecionada={q.resposta.alternativa_id} correcao={correcao}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={caderno.has(q.questao_id)}
                    onClick={async () => {
                      const res = await adicionarAoCaderno(q.questao_id);
                      if (res.ok) { setCaderno((s) => new Set(s).add(q.questao_id)); toast.success("Adicionada ao caderno de erros"); } else toast.error(res.erro);
                    }}>
                    <NotebookPen /> {caderno.has(q.questao_id) ? "No caderno de erros" : "Adicionar ao caderno"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    const res = await criarFlashcard({ frente: q.enunciado.slice(0, 2000), verso: `${correta ? `${correta.letra}) ${correta.texto}\n\n` : ""}${q.gabarito.explicacao}`.slice(0, 4000), questaoId: q.questao_id, origem: q.resultado === "acerto" ? "questao" : "erro" });
                    if (res.ok) toast.success("Flashcard criado"); else toast.error(res.erro);
                  }}><Layers /> Gerar flashcard</Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/tutor?questao=${q.questao_id}&pergunta=${encodeURIComponent(`Explique esta questão e por que a resposta correta é ${correta?.letra}: "${q.enunciado.slice(0, 500)}"`)}`}><Bot /> Perguntar ao Tutor IA</Link>
                  </Button>
                </div>
              </div>
            );
          })}
          {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma questão neste filtro.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
