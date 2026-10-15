"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { processarPendencias, regenerarCronograma } from "@/lib/servidor/cronograma";

const uuid = z.string().uuid();

export async function regerar() {
  return executarAcao("cronograma.regerar", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const r = await regenerarCronograma(supabase, usuario.id);
    if (r.semDisponibilidade) throw new ErroApp("Informe sua disponibilidade semanal antes de gerar o cronograma.");
    revalidatePath("/cronograma");
    return r;
  });
}

export async function salvarDisponibilidade(entrada: { janelas: { diaSemana: number; inicioMin: number; fimMin: number }[]; diasDescanso: number[] }) {
  return executarAcao("cronograma.disponibilidade", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      janelas: z.array(z.object({ diaSemana: z.number().int().min(0).max(6), inicioMin: z.number().int().min(0).max(1439), fimMin: z.number().int().min(1).max(1440) })).max(50),
      diasDescanso: z.array(z.number().int().min(0).max(6)).max(7),
    }).parse(entrada);
    if (d.janelas.some((j) => j.fimMin <= j.inicioMin)) throw new ErroApp("O horário final deve ser depois do inicial.");
    const supabase = await clienteServidor();
    await supabase.from("disponibilidade_semanal").delete().eq("user_id", usuario.id);
    if (d.janelas.length) {
      const { error } = await supabase.from("disponibilidade_semanal").insert(d.janelas.map((j) => ({ user_id: usuario.id, dia_semana: j.diaSemana, inicio_min: j.inicioMin, fim_min: j.fimMin })));
      if (error) throw error;
    }
    await supabase.from("preferencias_usuario").update({ dias_descanso: d.diasDescanso }).eq("user_id", usuario.id);
    revalidatePath("/cronograma");
    return null;
  });
}

export async function adicionarBloqueio(entrada: { inicio: string; fim: string; motivo: string }) {
  return executarAcao("cronograma.bloqueio", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ inicio: z.string().datetime({ offset: true }), fim: z.string().datetime({ offset: true }), motivo: z.string().max(200) }).parse(entrada);
    if (new Date(d.fim) <= new Date(d.inicio)) throw new ErroApp("O fim deve ser depois do início.");
    const supabase = await clienteServidor();
    const { error } = await supabase.from("bloqueios_agenda").insert({ user_id: usuario.id, inicio: d.inicio, fim: d.fim, motivo: d.motivo || null });
    if (error) throw error;
    // Atividades planejadas no período bloqueado viram pendências para replanejamento.
    await supabase.from("atividades_planejadas").update({ status: "nao_realizada" }).eq("user_id", usuario.id).eq("status", "planejada")
      .lt("inicio", d.fim).gt("fim", d.inicio);
    revalidatePath("/cronograma");
    return null;
  });
}

export async function removerBloqueio(id: string) {
  return executarAcao("cronograma.bloqueio.remover", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("bloqueios_agenda").delete().eq("id", uuid.parse(id));
    if (error) throw error;
    revalidatePath("/cronograma");
    return null;
  });
}

export async function atualizarAtividade(entrada: { id: string; status: "concluida" | "parcial" | "nao_realizada" | "cancelada" | "planejada"; minutosRealizados?: number }) {
  return executarAcao("cronograma.atividade", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ id: uuid, status: z.enum(["concluida", "parcial", "nao_realizada", "cancelada", "planejada"]), minutosRealizados: z.number().int().min(0).max(720).optional() }).parse(entrada);
    const supabase = await clienteServidor();
    const { data: a } = await supabase.from("atividades_planejadas").select("*").eq("id", d.id).eq("user_id", usuario.id).maybeSingle();
    if (!a) throw new ErroApp("Atividade não encontrada", "nao_encontrado", 404);
    const planejado = Math.round((new Date(a.fim).getTime() - new Date(a.inicio).getTime()) / 60000);
    const minutos = d.status === "concluida" ? d.minutosRealizados ?? planejado : d.status === "parcial" ? d.minutosRealizados ?? Math.round(planejado / 2) : 0;
    const { error } = await supabase.from("atividades_planejadas").update({
      status: d.status, concluida_em: d.status === "concluida" || d.status === "parcial" ? new Date().toISOString() : null, tempo_realizado_seg: minutos * 60,
    }).eq("id", d.id);
    if (error) throw error;
    // Tempo efetivamente registrado (separado do planejado), uma vez por atividade.
    if (minutos > 0) {
      const { count } = await supabase.from("sessoes_estudo").select("id", { count: "exact", head: true }).eq("atividade_id", d.id);
      if (!count) {
        const fim = new Date(Math.min(Date.now(), new Date(a.inicio).getTime() + minutos * 60000));
        const inicio = new Date(fim.getTime() - minutos * 60000);
        await supabase.from("sessoes_estudo").insert({
          user_id: usuario.id, atividade_id: d.id, tipo: ["leitura", "questoes", "revisao", "flashcards", "simulado"].includes(a.tipo) ? a.tipo : "outro",
          disciplina_id: a.disciplina_id, assunto_id: a.assunto_id, material_id: a.material_id, inicio: inicio.toISOString(), fim: fim.toISOString(), origem: "manual",
        });
      }
    }
    if (d.status === "nao_realizada") await processarPendencias(supabase, usuario.id);
    revalidatePath("/cronograma");
    return null;
  });
}

export async function criarAtividade(entrada: { titulo: string; tipo: string; inicio: string; fim: string; disciplinaId?: string | null }) {
  return executarAcao("cronograma.criar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      titulo: z.string().trim().min(1).max(200), tipo: z.enum(["leitura", "questoes", "revisao", "flashcards", "simulado", "correcao_erros", "outro"]),
      inicio: z.string().datetime({ offset: true }), fim: z.string().datetime({ offset: true }), disciplinaId: uuid.nullable().optional(),
    }).parse(entrada);
    const supabase = await clienteServidor();
    const { data: crono } = await supabase.from("cronogramas").select("id").eq("user_id", usuario.id).eq("ativo", true).maybeSingle();
    const { error } = await supabase.from("atividades_planejadas").insert({
      user_id: usuario.id, cronograma_id: crono?.id ?? null, titulo: d.titulo, tipo: d.tipo, inicio: d.inicio, fim: d.fim, disciplina_id: d.disciplinaId ?? null, origem: "manual",
    });
    if (error) {
      if (error.code === "23P01") throw new ErroApp("Esse horário conflita com outra atividade planejada.");
      throw error;
    }
    revalidatePath("/cronograma");
    return null;
  });
}

export async function excluirAtividade(id: string) {
  return executarAcao("cronograma.excluir", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("atividades_planejadas").delete().eq("id", uuid.parse(id));
    if (error) throw error;
    revalidatePath("/cronograma");
    return null;
  });
}

/** Aceita, rejeita ou modifica uma proposta de realocação. */
export async function resolverReplanejamento(entrada: { id: string; decisao: "aceita" | "rejeitada" | "modificada"; inicio?: string; fim?: string }) {
  return executarAcao("cronograma.replanejar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ id: uuid, decisao: z.enum(["aceita", "rejeitada", "modificada"]), inicio: z.string().datetime({ offset: true }).optional(), fim: z.string().datetime({ offset: true }).optional() }).parse(entrada);
    const supabase = await clienteServidor();
    const { data: prop } = await supabase.from("replanejamentos").select("*, atividades_planejadas(*)").eq("id", d.id).eq("user_id", usuario.id).eq("status", "pendente").maybeSingle();
    if (!prop) throw new ErroApp("Proposta não encontrada ou já resolvida.");
    if (d.decisao !== "rejeitada") {
      const original = prop.atividades_planejadas as Record<string, unknown>;
      const inicio = d.decisao === "modificada" && d.inicio ? d.inicio : prop.proposta_inicio;
      const fim = d.decisao === "modificada" && d.fim ? d.fim : prop.proposta_fim;
      if (new Date(fim) <= new Date(inicio)) throw new ErroApp("O fim deve ser depois do início.");
      const { error } = await supabase.from("atividades_planejadas").insert({
        user_id: usuario.id, cronograma_id: original.cronograma_id, tipo: original.tipo, titulo: original.titulo, descricao: original.descricao,
        disciplina_id: original.disciplina_id, assunto_id: original.assunto_id, material_id: original.material_id,
        pagina_inicio: original.pagina_inicio, pagina_fim: original.pagina_fim, quantidade_questoes: original.quantidade_questoes,
        inicio, fim, prioridade: original.prioridade, origem: "replanejamento", reagendada_de: original.id,
      });
      if (error) {
        if (error.code === "23P01") throw new ErroApp("O horário escolhido conflita com outra atividade.");
        throw error;
      }
      await supabase.from("atividades_planejadas").update({ status: "reagendada" }).eq("id", original.id as string);
    }
    await supabase.from("replanejamentos").update({ status: d.decisao, resolvida_em: new Date().toISOString() }).eq("id", d.id);
    revalidatePath("/cronograma");
    return null;
  });
}
