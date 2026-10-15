import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { estadoIA } from "@/lib/ia";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina, Indicador, Tabela } from "@/components/ui/layout";
import { GraficoBarras, GraficoLinha } from "@/components/graficos/graficos";
import { TextoRico } from "@/components/ui/texto-rico";
import { analisarRelatorio, type DadosRelatorio } from "@/lib/relatorios/analise";
import { ROTULO_CAUSA } from "@/app/(app)/caderno-erros/rotulos";
import { formatarData, formatarDataHora, formatarDuracao, formatarPercentual, percentual } from "@/lib/utils";
import { AcoesRelatorio } from "./acoes-relatorio";

export const metadata: Metadata = { title: "Relatório" };

const ICONE = { positivo: CheckCircle2, atencao: CircleAlert, neutro: Info } as const;
const COR = { positivo: "text-success", atencao: "text-warning", neutro: "text-muted-foreground" } as const;

export default async function PaginaRelatorio({ params }: PageProps<"/relatorios/[id]">) {
  const { id } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: rel } = await supabase.from("relatorios").select("id, periodo, inicio, fim, dados, analise_ia, created_at").eq("id", id).eq("user_id", usuario.id).maybeSingle();
  if (!rel) notFound();
  const d = rel.dados as DadosRelatorio;
  const t = d.totais;
  const observacoes = analisarRelatorio(d);
  const ia = await estadoIA(usuario.id);
  const variacao = (atual: number | null, anterior: number | null, sufixo = "") =>
    atual !== null && anterior !== null ? `${atual >= anterior ? "+" : ""}${(atual - anterior).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${sufixo} vs. período anterior` : undefined;
  const acerto = percentual(t.acertos, t.respondidas);
  const acertoAnt = d.anterior ? percentual(d.anterior.acertos, d.anterior.respondidas) : null;
  const rotuloDia = (data: string) => new Date(`${data}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <article className="relatorio">
      <CabecalhoPagina
        titulo={`Relatório ${rel.periodo === "semanal" ? "semanal" : rel.periodo === "mensal" ? "mensal" : ""} · ${formatarData(rel.inicio)} a ${formatarData(rel.fim)}`}
        descricao={`Gerado em ${formatarDataHora(rel.created_at)}. Dados calculados das suas respostas, sessões de estudo e simulados.`}
        acoes={<AcoesRelatorio id={rel.id} temAnalise={Boolean(rel.analise_ia)} iaDisponivel={ia.configurada && !ia.bloqueadaPorOrcamento} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Indicador rotulo="Questões respondidas" valor={t.respondidas.toLocaleString("pt-BR")} detalhe={d.anterior ? variacao(t.respondidas, d.anterior.respondidas) : undefined} />
        <Indicador rotulo="Taxa de acerto" valor={formatarPercentual(acerto)} detalhe={variacao(acerto, acertoAnt, " p.p.")} />
        <Indicador rotulo="Tempo de estudo" valor={formatarDuracao(t.tempo_estudo_seg)} detalhe={d.planejado_seg ? `Planejado: ${formatarDuracao(d.planejado_seg)}` : undefined} />
        <Indicador rotulo="Simulados" valor={t.simulados_concluidos} />
        <Indicador rotulo="Revisões feitas" valor={t.revisoes_concluidas} detalhe={d.revisoes_pendentes ? `${d.revisoes_pendentes} vencida(s) agora` : undefined} />
        <Indicador rotulo="Flashcards revisados" valor={t.flashcards_revisados} />
        <Indicador rotulo="Páginas lidas" valor={t.paginas_lidas} />
        <Indicador rotulo="Atividades do cronograma" valor={d.atividades.total ? `${d.atividades.concluidas}/${d.atividades.total}` : "—"} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card className="break-inside-avoid">
          <CardHeader><CardTitle>Análise do período</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {observacoes.map((o, i) => {
                const Icone = ICONE[o.tipo];
                return <li key={i} className="flex gap-2"><Icone className={`mt-0.5 size-4 shrink-0 ${COR[o.tipo]}`} aria-hidden /><span>{o.texto}</span></li>;
              })}
            </ul>
          </CardContent>
        </Card>
        {rel.analise_ia && (
          <Card className="break-inside-avoid">
            <CardHeader><CardTitle>Análise por IA</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <TextoRico texto={rel.analise_ia} />
              <p className="mt-3 text-xs text-muted-foreground">Gerada por IA a partir dos números deste relatório. Pode conter imprecisões.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <GraficoBarras titulo="Questões por dia" nomeSerie="Questões" dados={d.por_dia.map((x) => ({ rotulo: rotuloDia(x.data), valor: x.respondidas, detalhe: x.respondidas ? `${x.acertos} acerto(s)` : undefined }))} />
        <GraficoBarras titulo="Tempo de estudo por dia" nomeSerie="Estudo" formato="minutos" dados={d.por_dia.map((x) => ({ rotulo: rotuloDia(x.data), valor: Math.round(x.estudo_seg / 60) }))} />
        {d.simulados.length > 0 && (
          <GraficoLinha titulo="Simulados do período" nomeSerie="Acerto" formato="percentual" dominio={[0, 100]}
            dados={d.simulados.map((s) => ({ rotulo: formatarData(s.data), valor: Math.round(s.percentual_acerto_total * 10) / 10, detalhe: s.nome }))} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="break-inside-avoid">
          <CardHeader><CardTitle>Desempenho por disciplina</CardTitle></CardHeader>
          <CardContent>
            {d.por_disciplina.length === 0 ? <p className="text-sm text-muted-foreground">Sem questões no período.</p> : (
              <Tabela>
                <thead><tr><th>Disciplina</th><th className="text-right">Questões</th><th className="text-right">Acerto</th></tr></thead>
                <tbody>{d.por_disciplina.map((x) => <tr key={x.id ?? x.nome}><td>{x.nome}</td><td className="text-right tabular-nums">{x.respondidas}</td><td className="text-right tabular-nums">{formatarPercentual(percentual(x.acertos, x.respondidas))}</td></tr>)}</tbody>
              </Tabela>
            )}
          </CardContent>
        </Card>
        <Card className="break-inside-avoid">
          <CardHeader><CardTitle>Assuntos trabalhados</CardTitle></CardHeader>
          <CardContent>
            {d.por_assunto.length === 0 ? <p className="text-sm text-muted-foreground">Sem questões no período.</p> : (
              <Tabela>
                <thead><tr><th>Assunto</th><th className="text-right">Questões</th><th className="text-right">Acerto</th></tr></thead>
                <tbody>{d.por_assunto.slice(0, 20).map((x) => <tr key={x.id ?? x.nome}><td>{x.nome}</td><td className="text-right tabular-nums">{x.respondidas}</td><td className="text-right tabular-nums">{x.respondidas >= 10 ? formatarPercentual(percentual(x.acertos, x.respondidas)) : <span className="text-muted-foreground" title="Menos de 10 questões">{formatarPercentual(percentual(x.acertos, x.respondidas))}*</span>}</td></tr>)}</tbody>
              </Tabela>
            )}
            {d.por_assunto.some((x) => x.respondidas < 10) && <p className="mt-2 text-xs text-muted-foreground">* Menos de 10 questões: amostra pequena.</p>}
          </CardContent>
        </Card>
        {d.erros_por_causa.length > 0 && (
          <Card className="break-inside-avoid">
            <CardHeader><CardTitle>Caderno de erros por causa (atual)</CardTitle></CardHeader>
            <CardContent>
              <Tabela>
                <tbody>{[...d.erros_por_causa].sort((a, b) => b.total - a.total).map((c) => <tr key={c.causa}><td>{ROTULO_CAUSA[c.causa] ?? c.causa}</td><td className="text-right tabular-nums">{c.total}</td></tr>)}</tbody>
              </Tabela>
            </CardContent>
          </Card>
        )}
      </div>
    </article>
  );
}
