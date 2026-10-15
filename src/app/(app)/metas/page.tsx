import type { Metadata } from "next";
import { Flame, Trophy } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Card, CardContent, CardHeader, CardTitle, Progress } from "@/components/ui/basicos";
import { CabecalhoPagina, Indicador, Tabela } from "@/components/ui/layout";
import { MapaCalor } from "@/components/graficos/graficos";
import { dataLocal, instanteLocal, somarDias } from "@/lib/estudo/tempo";
import { sequenciaDeEstudo } from "@/lib/estudo/sequencia";
import { fusoDoUsuario, inicioDaSemana, progressoMetas, resumoDesempenho, rotuloMeta } from "@/lib/servidor/painel";
import { formatarDuracao } from "@/lib/utils";
import { Pomodoro } from "./pomodoro";
import { FormMetas } from "./form-metas";

export const metadata: Metadata = { title: "Metas" };

export default async function PaginaMetas() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const fuso = await fusoDoUsuario(supabase, usuario.id);
  const hoje = dataLocal(new Date(), fuso);
  const inicioPeriodo = somarDias(inicioDaSemana(hoje), -35);

  const [metas, calor, { data: pref }, { data: disciplinas }, { data: atividades }, { data: sessoes }, { data: diasEstudo }] = await Promise.all([
    progressoMetas(supabase, usuario.id),
    resumoDesempenho(supabase, somarDias(hoje, -119), hoje),
    supabase.from("preferencias_usuario").select("pomodoro_foco_min, pomodoro_pausa_min, pomodoro_pausa_longa_min, gamificacao, dias_descanso").eq("user_id", usuario.id).maybeSingle(),
    supabase.from("disciplinas").select("id, nome").order("nome"),
    supabase.from("atividades_planejadas").select("inicio, fim, status").eq("user_id", usuario.id).gte("inicio", instanteLocal(inicioPeriodo, 0, fuso).toISOString()).not("status", "in", "(cancelada,reagendada)"),
    supabase.from("sessoes_estudo").select("inicio, duracao_seg").eq("user_id", usuario.id).gte("inicio", instanteLocal(inicioPeriodo, 0, fuso).toISOString()),
    supabase.from("historico_desempenho").select("data").eq("user_id", usuario.id).gte("data", somarDias(hoje, -365)),
  ]);

  // Dias com estudo: sessões registradas ou questões respondidas.
  const comEstudo = new Set<string>([...(diasEstudo ?? []).map((d) => d.data as string), ...calor.por_dia.filter((d) => d.estudo_seg > 0 || d.respondidas > 0).map((d) => d.data)]);
  const { atual, recorde } = sequenciaDeEstudo(comEstudo, hoje, (pref?.dias_descanso as number[] | undefined) ?? []);

  // Planejado × registrado, por semana.
  const semanas = Array.from({ length: 6 }, (_, i) => somarDias(inicioDaSemana(hoje), -7 * (5 - i)));
  const semanaDe = (iso: string) => inicioDaSemana(dataLocal(new Date(iso), fuso));
  const cumprimento = semanas.map((s) => {
    const plan = (atividades ?? []).filter((a) => semanaDe(a.inicio) === s);
    const planejadoSeg = plan.reduce((t, a) => t + (new Date(a.fim).getTime() - new Date(a.inicio).getTime()) / 1000, 0);
    const concluidas = plan.filter((a) => a.status === "concluida" || a.status === "parcial").length;
    const registradoSeg = (sessoes ?? []).filter((x) => semanaDe(x.inicio) === s).reduce((t, x) => t + x.duracao_seg, 0);
    return { semana: s, planejadoSeg, registradoSeg, atividades: plan.length, concluidas };
  });

  return (
    <>
      <CabecalhoPagina titulo="Metas e produtividade" descricao="O tempo planejado (cronograma) e o tempo efetivamente registrado (sessões) são contabilizados separadamente." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {pref?.gamificacao !== false && <Indicador rotulo="Sequência de estudo" icone={<Flame />} valor={`${atual} dia(s)`} detalhe="Dias de descanso e 1 dia por semana não quebram a sequência" />}
        {pref?.gamificacao !== false && <Indicador rotulo="Melhor sequência" icone={<Trophy />} valor={`${recorde} dia(s)`} />}
        <Indicador rotulo="Metas cumpridas agora" valor={metas.length ? `${metas.filter((m) => m.percentual >= 100).length}/${metas.length}` : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Metas ativas</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              {metas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma meta definida.</p>}
              {metas.map((m) => (
                <div key={m.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{m.periodo === "diaria" ? "Diária" : m.periodo === "semanal" ? "Semanal" : "Mensal"}: {m.alvo.toLocaleString("pt-BR")} {rotuloMeta(m.tipo)}{m.disciplina ? ` · ${m.disciplina}` : ""}</span>
                    <span className="tabular-nums">{m.realizado.toLocaleString("pt-BR")} ({Math.round(m.percentual)}%)</span>
                  </div>
                  <Progress value={m.percentual} indicadorClassName={m.percentual >= 100 ? "bg-success" : undefined} />
                </div>
              ))}
              <FormMetas disciplinas={disciplinas ?? []} metas={metas.map((m) => ({ id: m.id, rotulo: `${m.periodo} · ${rotuloMeta(m.tipo)}${m.disciplina ? ` · ${m.disciplina}` : ""}` }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Cumprimento semanal</CardTitle></CardHeader>
            <CardContent>
              <Tabela>
                <thead><tr><th>Semana</th><th className="text-right">Planejado</th><th className="text-right">Registrado</th><th className="text-right">Atividades concluídas</th></tr></thead>
                <tbody>
                  {cumprimento.map((c) => (
                    <tr key={c.semana}>
                      <td>{new Date(`${c.semana}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</td>
                      <td className="text-right tabular-nums">{c.planejadoSeg ? formatarDuracao(c.planejadoSeg) : "—"}</td>
                      <td className="text-right tabular-nums">{c.registradoSeg ? formatarDuracao(c.registradoSeg) : "—"}</td>
                      <td className="text-right tabular-nums">{c.atividades ? `${c.concluidas}/${c.atividades}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </CardContent>
          </Card>

          <MapaCalor titulo="Calendário de produtividade" descricao="Minutos registrados por dia (últimos 4 meses)" dias={calor.por_dia.map((d) => ({ data: d.data, minutos: Math.round(d.estudo_seg / 60) }))} />
        </div>

        <Pomodoro
          disciplinas={disciplinas ?? []}
          preferencias={{ foco: pref?.pomodoro_foco_min ?? 25, pausa: pref?.pomodoro_pausa_min ?? 5, pausaLonga: pref?.pomodoro_pausa_longa_min ?? 15, gamificacao: pref?.gamificacao ?? true }}
        />
      </div>
    </>
  );
}
