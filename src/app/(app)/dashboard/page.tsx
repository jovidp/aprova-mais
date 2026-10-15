import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen, CalendarClock, CheckCircle2, ClipboardList, Clock, Layers, PenLine, RotateCcw, Sparkles, Target, TrendingDown, TrendingUp, Upload,
} from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Progress } from "@/components/ui/basicos";
import { Aviso, CabecalhoPagina, Indicador } from "@/components/ui/layout";
import { GraficoBarras, GraficoLinha, MapaCalor } from "@/components/graficos/graficos";
import { dataLocal, somarDias } from "@/lib/estudo/tempo";
import { COR_NIVEL, ROTULO_NIVEL } from "@/lib/estudo/dominio";
import { dominioPorAssunto, fusoDoUsuario, inicioDaSemana, progressoMetas, resumoDesempenho, rotuloMeta } from "@/lib/servidor/painel";
import { formatarDataHora, formatarDuracao, formatarNumero, formatarPercentual, percentual } from "@/lib/utils";
import { FiltroPeriodo } from "./filtro-periodo";

export const metadata: Metadata = { title: "Dashboard" };

const CAUSAS: Record<string, string> = {
  falta_conhecimento: "Falta de conhecimento", confusao_conceitos: "Confusão de conceitos", falta_atencao: "Falta de atenção",
  interpretacao: "Interpretação incorreta", memorizacao: "Dificuldade de memorização", nao_classificado: "Não classificado",
};

function Variacao({ atual, anterior, sufixo = "" }: { atual: number | null; anterior: number | null; sufixo?: string }) {
  if (atual === null || anterior === null || anterior === 0) return <span className="text-muted-foreground">sem base de comparação</span>;
  const delta = atual - anterior;
  const Icone = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={delta >= 0 ? "text-success" : "text-destructive"}>
      <Icone className="mr-0.5 inline size-3" />{delta >= 0 ? "+" : ""}{delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{sufixo} vs semana anterior
    </span>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const fuso = await fusoDoUsuario(supabase, usuario.id);
  const hoje = dataLocal(new Date(), fuso);

  const dias = typeof sp.periodo === "string" && ["7", "30", "90"].includes(sp.periodo) ? Number(sp.periodo) : 30;
  const valida = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const personalizado = valida(sp.inicio) && valida(sp.fim) && (sp.inicio as string) <= (sp.fim as string);
  const inicio = personalizado ? (sp.inicio as string) : somarDias(hoje, -(dias - 1));
  const fim = personalizado ? (sp.fim as string) : hoje;
  const semanaAtual = inicioDaSemana(hoje);

  const [resumo, estaSemana, semanaPassada, calor, metas, dominio, proxima, { count: materiais }, { count: questoesDisponiveis }, { data: cronoSemana }] = await Promise.all([
    resumoDesempenho(supabase, inicio, fim),
    resumoDesempenho(supabase, semanaAtual, hoje),
    resumoDesempenho(supabase, somarDias(semanaAtual, -7), somarDias(semanaAtual, -1)),
    resumoDesempenho(supabase, somarDias(hoje, -90), hoje),
    progressoMetas(supabase, usuario.id),
    dominioPorAssunto(supabase),
    supabase.from("atividades_planejadas").select("id, titulo, tipo, inicio, fim, material_id, pagina_inicio, assunto_id")
      .eq("user_id", usuario.id).eq("status", "planejada").gte("fim", new Date().toISOString()).order("inicio").limit(1).maybeSingle(),
    supabase.from("materiais").select("id", { count: "exact", head: true }).eq("user_id", usuario.id),
    supabase.from("questoes").select("id", { count: "exact", head: true }).eq("status", "aprovada"),
    supabase.from("atividades_planejadas").select("status").eq("user_id", usuario.id)
      .gte("inicio", `${semanaAtual}T00:00:00`).lt("inicio", `${somarDias(semanaAtual, 7)}T00:00:00`).not("status", "in", "(cancelada,reagendada)"),
  ]);

  const t = resumo.totais;
  const pctTentativas = percentual(t.acertos, t.respondidas);
  const pctUnicas = percentual(t.acertos_unicos, t.questoes_unicas);
  const pctSemana = percentual(estaSemana.totais.acertos, estaSemana.totais.respondidas);
  const pctSemanaPassada = percentual(semanaPassada.totais.acertos, semanaPassada.totais.respondidas);
  const rotuloDia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const concluidasSemana = (cronoSemana ?? []).filter((a) => a.status === "concluida" || a.status === "parcial").length;
  const totalSemana = (cronoSemana ?? []).length;
  const dominados = dominio.filter((d) => d.nivel === "dominio_consistente" || d.nivel === "bom_desempenho").sort((a, b) => b.indice - a.indice).slice(0, 5);
  const reforco = dominio.filter((d) => d.nivel === "necessita_reforco").sort((a, b) => a.indice - b.indice).slice(0, 5);
  const novo = (materiais ?? 0) === 0 && t.respondidas === 0;

  const linkProxima = proxima.data
    ? proxima.data.tipo === "leitura" && proxima.data.material_id
      ? `/biblioteca/${proxima.data.material_id}/ler${proxima.data.pagina_inicio ? `?pagina=${proxima.data.pagina_inicio}` : ""}`
      : proxima.data.tipo === "questoes" ? `/resolver${proxima.data.assunto_id ? `?assunto=${proxima.data.assunto_id}&situacao=ineditas` : ""}`
      : proxima.data.tipo === "revisao" ? "/revisoes" : proxima.data.tipo === "flashcards" ? "/flashcards" : "/cronograma"
    : null;

  return (
    <>
      <CabecalhoPagina
        titulo={`Olá${usuario.nome ? `, ${usuario.nome.split(" ")[0]}` : ""}!`}
        descricao="Seu desempenho calculado a partir das suas respostas, leituras e sessões de estudo."
        acoes={<FiltroPeriodo dias={personalizado ? null : dias} inicio={inicio} fim={fim} />}
      />

      {novo && (
        <Aviso tipo="info" titulo="Comece por aqui" className="mb-6">
          1) <Link href="/biblioteca/importar">Importe seus materiais</Link> · 2) <Link href="/questoes/gerar">gere questões a partir deles</Link> ·
          3) <Link href="/resolver">resolva</Link> e acompanhe sua evolução aqui. Os gráficos aparecem assim que houver registros.
        </Aviso>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Questões respondidas" icone={<PenLine />} valor={formatarNumero(t.respondidas)} detalhe={`${formatarNumero(t.questoes_unicas)} questões diferentes`} />
        <Indicador rotulo="Percentual de acertos" icone={<CheckCircle2 />} valor={formatarPercentual(pctTentativas)} detalhe={`Por questões únicas: ${formatarPercentual(pctUnicas)}`} />
        <Indicador rotulo="Horas estudadas" icone={<Clock />} valor={formatarDuracao(t.tempo_estudo_seg)} detalhe={`Nesta semana: ${formatarDuracao(estaSemana.totais.tempo_estudo_seg)}`} />
        <Indicador rotulo="Simulados concluídos" icone={<ClipboardList />} valor={formatarNumero(t.simulados_concluidos)}
          detalhe={resumo.simulados.length ? `Média de acerto: ${formatarPercentual(resumo.simulados.reduce((s, x) => s + Number(x.percentual_acerto_total), 0) / resumo.simulados.length)}` : "Nenhum no período"} />
        <Indicador rotulo="Revisões pendentes" icone={<RotateCcw />} valor={formatarNumero(resumo.revisoes_pendentes)} detalhe={`${formatarNumero(resumo.flashcards_pendentes)} flashcards para hoje`} />
        <Indicador rotulo="Disciplinas trabalhadas" icone={<BookOpen />} valor={formatarNumero(t.disciplinas_trabalhadas)} detalhe={`${formatarNumero(t.paginas_lidas)} páginas lidas`} />
        <Indicador rotulo="Cronograma da semana" icone={<CalendarClock />} valor={totalSemana ? `${concluidasSemana}/${totalSemana}` : "—"}
          detalhe={totalSemana ? `${Math.round((100 * concluidasSemana) / totalSemana)}% das atividades concluídas` : "Sem atividades planejadas"} />
        <Indicador rotulo="Metas alcançadas" icone={<Target />} valor={metas.length ? `${metas.filter((m) => m.percentual >= 100).length}/${metas.length}` : "—"} detalhe="No período corrente de cada meta" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Próxima atividade recomendada</CardTitle></CardHeader>
          <CardContent>
            {proxima.data ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{proxima.data.titulo}</p>
                  <p className="text-sm text-muted-foreground">{formatarDataHora(proxima.data.inicio)} · {Math.round((new Date(proxima.data.fim).getTime() - new Date(proxima.data.inicio).getTime()) / 60000)} min</p>
                </div>
                {linkProxima && <Button asChild><Link href={linkProxima}>Começar</Link></Button>}
              </div>
            ) : resumo.revisoes_pendentes > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">Você tem {resumo.revisoes_pendentes} revisão(ões) vencida(s).</p>
                <Button asChild><Link href="/revisoes">Revisar agora</Link></Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Nenhuma atividade planejada. Gere seu cronograma ou resolva questões inéditas.</p>
                <div className="flex gap-2">
                  <Button variant="outline" asChild><Link href="/cronograma">Cronograma</Link></Button>
                  {(questoesDisponiveis ?? 0) > 0 ? <Button asChild><Link href="/resolver?situacao=ineditas">Resolver</Link></Button>
                    : (materiais ?? 0) > 0 ? <Button asChild><Link href="/questoes/gerar"><Sparkles /> Gerar questões</Link></Button>
                    : <Button asChild><Link href="/biblioteca/importar"><Upload /> Importar</Link></Button>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Esta semana × anterior</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <div className="flex justify-between"><span className="text-muted-foreground">Questões</span><span className="font-medium tabular-nums">{estaSemana.totais.respondidas}</span></div>
              <div className="text-xs"><Variacao atual={estaSemana.totais.respondidas} anterior={semanaPassada.totais.respondidas} /></div>
            </div>
            <div>
              <div className="flex justify-between"><span className="text-muted-foreground">Acertos</span><span className="font-medium tabular-nums">{formatarPercentual(pctSemana)}</span></div>
              <div className="text-xs"><Variacao atual={pctSemana} anterior={pctSemanaPassada} sufixo=" p.p." /></div>
            </div>
            <div>
              <div className="flex justify-between"><span className="text-muted-foreground">Horas</span><span className="font-medium tabular-nums">{formatarDuracao(estaSemana.totais.tempo_estudo_seg)}</span></div>
              <div className="text-xs"><Variacao atual={Math.round(estaSemana.totais.tempo_estudo_seg / 360) / 10} anterior={Math.round(semanaPassada.totais.tempo_estudo_seg / 360) / 10} sufixo=" h" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <GraficoLinha titulo="Evolução do percentual de acertos" descricao="Acertos ÷ respondidas em cada dia (dias sem questões ficam em branco)" nomeSerie="Acerto" formato="percentual" dominio={[0, 100]}
          dados={resumo.por_dia.map((d) => ({ rotulo: rotuloDia(d.data), valor: d.respondidas ? Math.round((1000 * d.acertos) / d.respondidas) / 10 : null, detalhe: `${d.acertos} de ${d.respondidas}` }))} />
        <GraficoBarras titulo="Questões respondidas por dia" nomeSerie="Questões"
          dados={resumo.por_dia.map((d) => ({ rotulo: rotuloDia(d.data), valor: d.respondidas }))} />
        <GraficoBarras titulo="Tempo estudado por dia" descricao="Sessões registradas (leitor, questões, pomodoro e manuais)" nomeSerie="Tempo" formato="minutos"
          dados={resumo.por_dia.map((d) => ({ rotulo: rotuloDia(d.data), valor: Math.round(d.estudo_seg / 60) }))} />
        <GraficoBarras titulo="Desempenho por disciplina" descricao="Percentual de acertos no período" nomeSerie="Acerto" formato="percentual" horizontal dominio={[0, 100]}
          dados={resumo.por_disciplina.map((d) => ({ rotulo: d.nome, valor: d.respondidas ? Math.round((1000 * d.acertos) / d.respondidas) / 10 : null, detalhe: `${d.acertos} de ${d.respondidas}` }))} />
        <GraficoBarras titulo="Desempenho por assunto" descricao="Os 10 assuntos mais praticados" nomeSerie="Acerto" formato="percentual" horizontal dominio={[0, 100]}
          dados={resumo.por_assunto.slice(0, 10).map((a) => ({ rotulo: a.nome, valor: a.respondidas ? Math.round((1000 * a.acertos) / a.respondidas) / 10 : null, detalhe: `${a.acertos} de ${a.respondidas}` }))} />
        <GraficoLinha titulo="Evolução nos simulados" descricao="Acertos sobre o total de questões de cada simulado" nomeSerie="Acerto" formato="percentual" dominio={[0, 100]} vazio="Nenhum simulado concluído no período."
          dados={resumo.simulados.map((s) => ({ rotulo: rotuloDia(s.data.slice(0, 10)), valor: Number(s.percentual_acerto_total), detalhe: `${s.nome} · nota ${s.nota}/${s.nota_maxima}` }))} />
        <GraficoBarras titulo="Distribuição dos erros por causa" descricao="Erros ativos no caderno, conforme sua classificação" nomeSerie="Erros" horizontal cor="var(--chart-2)" vazio="Nenhum erro ativo no caderno."
          dados={resumo.erros_por_causa.map((e) => ({ rotulo: CAUSAS[e.causa] ?? e.causa, valor: e.total }))} />
        <MapaCalor titulo="Mapa de calor de estudos" descricao="Minutos estudados por dia nos últimos 90 dias" dias={calor.por_dia.map((d) => ({ data: d.data, minutos: Math.round(d.estudo_seg / 60) }))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Metas: previsto × realizado</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {metas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma meta ativa. <Link href="/metas" className="text-primary hover:underline">Definir metas</Link></p>}
            {metas.map((m) => (
              <div key={m.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{m.periodo === "diaria" ? "Hoje" : m.periodo === "semanal" ? "Semana" : "Mês"}: {rotuloMeta(m.tipo)}{m.disciplina ? ` · ${m.disciplina}` : ""}</span>
                  <span className="tabular-nums">{m.realizado.toLocaleString("pt-BR")} / {m.alvo.toLocaleString("pt-BR")}</span>
                </div>
                <Progress value={m.percentual} indicadorClassName={m.percentual >= 100 ? "bg-success" : undefined} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Assuntos dominados</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {dominados.length === 0 && <p className="text-muted-foreground">Ainda sem evidência suficiente (mínimo de 10 questões por assunto).</p>}
            {dominados.map((d) => (
              <Link key={d.assuntoId} href={`/mapa?assunto=${d.assuntoId}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:border-primary/50">
                <span className="min-w-0"><span className="block truncate">{d.nome}</span><span className="text-xs text-muted-foreground">{d.disciplina} · {d.respondidas} questões</span></span>
                <Badge variant={COR_NIVEL[d.nivel]}>{ROTULO_NIVEL[d.nivel]}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Precisam de reforço</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {reforco.length === 0 && <p className="text-muted-foreground">Nenhum assunto com desempenho baixo e evidência suficiente.</p>}
            {reforco.map((d) => (
              <div key={d.assuntoId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span className="min-w-0"><span className="block truncate">{d.nome}</span><span className="text-xs text-muted-foreground">{formatarPercentual((d.taxa ?? 0) * 100)} em {d.respondidas} questões</span></span>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon-sm" variant="outline" asChild aria-label={`Resolver questões de ${d.nome}`}><Link href={`/resolver?assunto=${d.assuntoId}`}><PenLine /></Link></Button>
                  <Button size="icon-sm" variant="outline" asChild aria-label={`Flashcards de ${d.nome}`}><Link href={`/flashcards?assunto=${d.assuntoId}`}><Layers /></Link></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {(resumo.externos.respondidas ?? 0) > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Registrados de plataformas externas no período (fora dos gráficos acima): {resumo.externos.respondidas} questões, {resumo.externos.acertos} acertos.
        </p>
      )}
    </>
  );
}
