import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diferencaDias, instanteLocal, somarDias } from "@/lib/estudo/tempo";
import type { DadosRelatorio } from "@/lib/relatorios/analise";
import { fusoDoUsuario, resumoDesempenho } from "./painel";

/** Consolida os números do período (e do período anterior de mesmo tamanho). */
export async function montarDadosRelatorio(supabase: SupabaseClient, userId: string, inicio: string, fim: string, tipo: DadosRelatorio["periodo"]["tipo"]): Promise<DadosRelatorio> {
  const fuso = await fusoDoUsuario(supabase, userId);
  const dias = diferencaDias(inicio, fim) + 1;
  const [atual, anterior, { data: atividades }] = await Promise.all([
    resumoDesempenho(supabase, inicio, fim),
    resumoDesempenho(supabase, somarDias(inicio, -dias), somarDias(inicio, -1)),
    supabase.from("atividades_planejadas").select("inicio, fim, status").eq("user_id", userId)
      .gte("inicio", instanteLocal(inicio, 0, fuso).toISOString()).lt("inicio", instanteLocal(somarDias(fim, 1), 0, fuso).toISOString())
      .not("status", "in", "(cancelada,reagendada)"),
  ]);
  const lista = atividades ?? [];
  const t = atual.totais;
  return {
    periodo: { inicio, fim, tipo },
    totais: {
      respondidas: t.respondidas, acertos: t.acertos, tempo_estudo_seg: t.tempo_estudo_seg, tempo_questoes_seg: t.tempo_questoes_seg,
      simulados_concluidos: t.simulados_concluidos, revisoes_concluidas: t.revisoes_concluidas, flashcards_revisados: t.flashcards_revisados,
      paginas_lidas: t.paginas_lidas, disciplinas_trabalhadas: t.disciplinas_trabalhadas,
    },
    anterior: { respondidas: anterior.totais.respondidas, acertos: anterior.totais.acertos, tempo_estudo_seg: anterior.totais.tempo_estudo_seg },
    planejado_seg: Math.round(lista.reduce((s, a) => s + (new Date(a.fim).getTime() - new Date(a.inicio).getTime()) / 1000, 0)),
    atividades: { total: lista.length, concluidas: lista.filter((a) => a.status === "concluida" || a.status === "parcial").length },
    por_dia: atual.por_dia,
    por_disciplina: atual.por_disciplina,
    por_assunto: atual.por_assunto.map(({ id, nome, respondidas, acertos }) => ({ id, nome, respondidas, acertos })),
    simulados: atual.simulados.map(({ nome, data, percentual_acerto_total, nota, nota_maxima }) => ({ nome, data, percentual_acerto_total, nota, nota_maxima })),
    erros_por_causa: atual.erros_por_causa,
    revisoes_pendentes: atual.revisoes_pendentes,
  };
}
