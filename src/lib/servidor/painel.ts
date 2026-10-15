import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataLocal, diaSemanaDe, somarDias } from "@/lib/estudo/tempo";
import { calcularDominio, evidenciaDeLinha, type ResultadoDominio } from "@/lib/estudo/dominio";

export interface ResumoDesempenho {
  periodo: { inicio: string; fim: string; fuso: string };
  totais: {
    respondidas: number; acertos: number; questoes_unicas: number; acertos_unicos: number; tempo_questoes_seg: number;
    tempo_estudo_seg: number; disciplinas_trabalhadas: number; simulados_concluidos: number; revisoes_concluidas: number;
    flashcards_revisados: number; paginas_lidas: number;
  };
  por_dia: { data: string; respondidas: number; acertos: number; estudo_seg: number }[];
  por_disciplina: { id: string | null; nome: string; respondidas: number; acertos: number }[];
  por_assunto: { id: string | null; nome: string; disciplina_id: string | null; respondidas: number; acertos: number }[];
  simulados: { tentativa_id: string; simulado_id: string; nome: string; data: string; nota: number; nota_maxima: number; percentual_acerto: number | null; percentual_acerto_total: number }[];
  erros_por_causa: { causa: string; total: number }[];
  revisoes_pendentes: number;
  flashcards_pendentes: number;
  externos: { respondidas?: number; acertos?: number };
}

export async function resumoDesempenho(supabase: SupabaseClient, inicio: string, fim: string): Promise<ResumoDesempenho> {
  const { data, error } = await supabase.rpc("resumo_desempenho", { p_inicio: inicio, p_fim: fim });
  if (error) throw error;
  return data as ResumoDesempenho;
}

export async function fusoDoUsuario(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from("preferencias_usuario").select("fuso_horario").eq("user_id", userId).maybeSingle();
  return data?.fuso_horario ?? "America/Sao_Paulo";
}

/** Início (segunda) da semana que contém a data. */
export function inicioDaSemana(data: string) {
  const d = diaSemanaDe(data);
  return somarDias(data, d === 0 ? -6 : 1 - d);
}

export interface ProgressoMeta {
  id: string;
  periodo: "diaria" | "semanal" | "mensal";
  tipo: string;
  alvo: number;
  realizado: number;
  disciplina: string | null;
  percentual: number;
  intervalo: { inicio: string; fim: string };
}

const ROTULO_TIPO_META: Record<string, string> = {
  questoes: "questões", horas: "horas de estudo", simulados: "simulados", revisoes: "revisões", paginas: "páginas lidas", flashcards: "flashcards",
};
export function rotuloMeta(tipo: string) {
  return ROTULO_TIPO_META[tipo] ?? tipo;
}

/**
 * Progresso das metas ativas no período corrente de cada uma, calculado dos
 * registros (respostas, sessões de estudo, simulados, revisões).
 * Metas por disciplina usam somente os números daquela disciplina quando disponíveis.
 */
export async function progressoMetas(supabase: SupabaseClient, userId: string): Promise<ProgressoMeta[]> {
  const fuso = await fusoDoUsuario(supabase, userId);
  const hoje = dataLocal(new Date(), fuso);
  const { data: metas } = await supabase.from("metas").select("id, periodo, tipo, alvo, disciplina_id, disciplinas(nome)").eq("user_id", userId).eq("ativa", true);
  if (!metas?.length) return [];
  const intervalos = {
    diaria: { inicio: hoje, fim: hoje },
    semanal: { inicio: inicioDaSemana(hoje), fim: somarDias(inicioDaSemana(hoje), 6) },
    mensal: { inicio: `${hoje.slice(0, 7)}-01`, fim: hoje },
  } as const;
  const resumos = new Map<string, ResumoDesempenho>();
  for (const p of new Set(metas.map((m) => m.periodo as keyof typeof intervalos))) {
    resumos.set(p, await resumoDesempenho(supabase, intervalos[p].inicio, intervalos[p].fim));
  }
  return metas.map((m) => {
    const periodo = m.periodo as keyof typeof intervalos;
    const r = resumos.get(periodo)!;
    const disc = m.disciplina_id ? r.por_disciplina.find((d) => d.id === m.disciplina_id) : null;
    let realizado = 0;
    switch (m.tipo) {
      case "questoes": realizado = m.disciplina_id ? disc?.respondidas ?? 0 : r.totais.respondidas; break;
      case "horas": realizado = r.totais.tempo_estudo_seg / 3600; break;
      case "simulados": realizado = r.totais.simulados_concluidos; break;
      case "revisoes": realizado = r.totais.revisoes_concluidas; break;
      case "paginas": realizado = r.totais.paginas_lidas; break;
      case "flashcards": realizado = r.totais.flashcards_revisados; break;
    }
    const alvo = Number(m.alvo);
    return {
      id: m.id, periodo, tipo: m.tipo, alvo, realizado: Math.round(realizado * 10) / 10,
      disciplina: (m.disciplinas as unknown as { nome: string } | null)?.nome ?? null,
      percentual: alvo > 0 ? Math.min(100, (100 * realizado) / alvo) : 0, intervalo: intervalos[periodo],
    };
  });
}

export interface DominioAssunto extends ResultadoDominio {
  assuntoId: string;
  nome: string;
  disciplinaId: string | null;
  disciplina: string;
  respondidas: number;
}

/** Índice de domínio por assunto (somente assuntos com respostas). */
export async function dominioPorAssunto(supabase: SupabaseClient): Promise<DominioAssunto[]> {
  const { data, error } = await supabase.rpc("dados_dominio");
  if (error) throw error;
  const linhas = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(linhas.map((l) => l.assunto_id as string | null).filter((x): x is string => Boolean(x)))];
  const { data: assuntos } = ids.length
    ? await supabase.from("assuntos").select("id, nome, disciplina_id, disciplinas(nome)").in("id", ids)
    : { data: [] as { id: string; nome: string; disciplina_id: string; disciplinas: unknown }[] };
  const porId = new Map((assuntos ?? []).map((a) => [a.id, a]));
  return linhas.flatMap((l) => {
    const a = l.assunto_id ? porId.get(l.assunto_id as string) : null;
    if (!a) return [];
    const ev = evidenciaDeLinha(l);
    return [{ ...calcularDominio(ev), assuntoId: a.id, nome: a.nome, disciplinaId: a.disciplina_id, disciplina: (a.disciplinas as { nome: string } | null)?.nome ?? "", respondidas: ev.respondidas }];
  });
}
