"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { esquemaConfigSimulado, type EntradaConfigSimulado } from "@/lib/simulados/config";
import { dadosCriacao, planejarSimulado, type FonteDados, type PlanoSimulado } from "@/lib/simulados/servico";
import { integrarResultado } from "@/lib/simulados/integracao";
import { regenerarCronograma } from "@/lib/servidor/cronograma";
import type { Candidata } from "@/lib/simulados/selecao";

const uuid = z.string().uuid();

async function fonte(): Promise<FonteDados> {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  return {
    supabase, userId: usuario.id,
    candidatas: async (filtros) => {
      const { data, error } = await supabase.rpc("candidatas_simulado", { p_filtros: filtros });
      if (error) throw error;
      return (data ?? []) as Candidata[];
    },
  };
}

export type ResultadoMontagem =
  | { situacao: "criado"; simuladoId: string; plano: PlanoSimulado }
  | { situacao: "insuficiente"; plano: PlanoSimulado };

/**
 * Monta o simulado. Se faltar conteúdo e o aluno não aceitou montar com menos,
 * devolve o plano com o déficit para que ele escolha: gerar com IA, reduzir a
 * quantidade, incluir questões já respondidas ou seguir com o que há.
 */
export async function montarSimulado(entrada: EntradaConfigSimulado) {
  return executarAcao("simulados.montar", async (): Promise<ResultadoMontagem> => {
    const c = esquemaConfigSimulado.parse(entrada);
    const f = await fonte();
    const plano = await planejarSimulado(f, c);
    if (plano.ids.length === 0) {
      return { situacao: "insuficiente", plano };
    }
    if (plano.ids.length < c.quantidade && !c.aceitarMenos) return { situacao: "insuficiente", plano };
    const { data, error } = await f.supabase.rpc("criar_simulado", { p_dados: dadosCriacao(c, plano), p_questoes: plano.ids });
    if (error) throw error;
    revalidatePath("/simulados");
    return { situacao: "criado", simuladoId: data as string, plano };
  });
}

export async function iniciarTentativa(simuladoId: string) {
  return executarAcao("simulados.iniciar", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("iniciar_tentativa", { p_simulado_id: uuid.parse(simuladoId) });
    if (error) throw error;
    return { tentativaId: data as string };
  });
}

export async function salvarRespostaSimulado(entrada: { tentativaId: string; questaoId: string; alternativaId: string | null; marcada: boolean; tempoSeg: number; questaoAtual: number }) {
  return executarAcao("simulados.resposta", async () => {
    await exigirUsuario();
    const d = z.object({
      tentativaId: uuid, questaoId: uuid, alternativaId: uuid.nullable(), marcada: z.boolean(),
      tempoSeg: z.number().int().min(0).max(86400), questaoAtual: z.number().int().min(1),
    }).parse(entrada);
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("salvar_resposta_simulado", {
      p_tentativa_id: d.tentativaId, p_questao_id: d.questaoId, p_alternativa_id: d.alternativaId,
      p_marcada_revisao: d.marcada, p_tempo_seg: d.tempoSeg, p_questao_atual: d.questaoAtual,
    });
    if (error) throw error;
    return data as { salvo: boolean; expirado: boolean; agora: string; gabarito?: { alternativa_correta_id: string; explicacao: string; justificativas: Record<string, string> } };
  });
}

export async function pausarTentativa(tentativaId: string) {
  return executarAcao("simulados.pausar", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("pausar_tentativa", { p_tentativa_id: uuid.parse(tentativaId) });
    if (error) throw error;
    return data as { pausada: boolean; expirado: boolean };
  });
}

export async function retomarTentativa(tentativaId: string) {
  return executarAcao("simulados.retomar", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.rpc("retomar_tentativa", { p_tentativa_id: uuid.parse(tentativaId) });
    if (error) throw error;
    return null;
  });
}

export async function finalizarTentativa(tentativaId: string, interromper = false) {
  return executarAcao("simulados.finalizar", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.rpc("finalizar_tentativa", { p_tentativa_id: uuid.parse(tentativaId), p_interromper: interromper });
    if (error) throw error;
    await integrarResultado(supabase, usuario.id, tentativaId);
    revalidatePath("/simulados");
    revalidatePath("/dashboard");
    return null;
  });
}

export async function renomearSimulado(simuladoId: string, nome: string) {
  return executarAcao("simulados.renomear", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("simulados").update({ nome: z.string().trim().min(1).max(200).parse(nome) }).eq("id", uuid.parse(simuladoId));
    if (error) throw error;
    revalidatePath("/simulados");
    return null;
  });
}

export async function arquivarSimulado(simuladoId: string) {
  return executarAcao("simulados.arquivar", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("simulados").update({ status: "arquivado" }).eq("id", uuid.parse(simuladoId));
    if (error) throw error;
    revalidatePath("/simulados");
    return null;
  });
}

export async function adicionarAoCaderno(questaoId: string) {
  return executarAcao("simulados.caderno", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.rpc("adicionar_ao_caderno", { p_questao_id: uuid.parse(questaoId) });
    if (error) throw error;
    return null;
  });
}

/** Aplica a recomendação de ajuste: recalcula atividades futuras (concluídas não mudam). */
export async function aplicarAjusteCronograma(recomendacaoId: string) {
  return executarAcao("simulados.ajuste", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const r = await regenerarCronograma(supabase, usuario.id);
    await supabase.from("recomendacoes").update({ status: "aceita" }).eq("id", uuid.parse(recomendacaoId));
    if (r.semDisponibilidade) throw new ErroApp("Informe sua disponibilidade semanal em Meu Cronograma para gerar as atividades.");
    revalidatePath("/cronograma");
    return r;
  });
}

export async function atualizarRecomendacao(id: string, status: "aceita" | "descartada" | "concluida") {
  return executarAcao("recomendacoes.status", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("recomendacoes").update({ status }).eq("id", uuid.parse(id));
    if (error) throw error;
    return null;
  });
}

const esquemaAgendamento = z.object({
  nome: z.string().trim().min(1).max(120),
  frequencia: z.enum(["semanal", "quinzenal", "mensal", "data_unica"]),
  diaSemana: z.number().int().min(0).max(6).nullable(),
  diaMes: z.number().int().min(1).max(28).nullable(),
  dataUnica: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  config: esquemaConfigSimulado,
  permitirIA: z.boolean(),
});

export async function salvarAgendamento(entrada: z.input<typeof esquemaAgendamento>) {
  return executarAcao("simulados.agendar", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaAgendamento.parse(entrada);
    const { proximaExecucao } = await import("@/lib/simulados/agendamento");
    const supabase = await clienteServidor();
    const { data: pref } = await supabase.from("preferencias_usuario").select("fuso_horario").eq("user_id", usuario.id).maybeSingle();
    const proxima = proximaExecucao({ frequencia: d.frequencia, diaSemana: d.diaSemana, diaMes: d.diaMes, dataUnica: d.dataUnica, hora: d.hora }, new Date(), pref?.fuso_horario ?? "America/Sao_Paulo");
    if (!proxima) throw new ErroApp("A data escolhida já passou.");
    const { error } = await supabase.from("simulados_agendamentos").insert({
      user_id: usuario.id, nome: d.nome, frequencia: d.frequencia, dia_semana: d.diaSemana, dia_mes: d.diaMes, data_unica: d.dataUnica,
      hora: d.hora, config: d.config, permitir_ia: d.permitirIA, proxima_execucao_em: proxima.toISOString(),
    });
    if (error) throw error;
    revalidatePath("/simulados");
    return { proxima: proxima.toISOString() };
  });
}

export async function alternarAgendamento(id: string, ativo: boolean) {
  return executarAcao("simulados.agendamento.ativo", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("simulados_agendamentos").update({ ativo }).eq("id", uuid.parse(id));
    if (error) throw error;
    revalidatePath("/simulados");
    return null;
  });
}

export async function excluirAgendamento(id: string) {
  return executarAcao("simulados.agendamento.excluir", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("simulados_agendamentos").delete().eq("id", uuid.parse(id));
    if (error) throw error;
    revalidatePath("/simulados");
    return null;
  });
}
