"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";

export async function salvarMeta(entrada: { periodo: "diaria" | "semanal" | "mensal"; tipo: string; alvo: number; disciplinaId?: string | null }) {
  return executarAcao("metas.salvar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      periodo: z.enum(["diaria", "semanal", "mensal"]),
      tipo: z.enum(["questoes", "horas", "simulados", "revisoes", "paginas", "flashcards"]),
      alvo: z.number().positive().max(100000),
      disciplinaId: z.string().uuid().nullable().optional(),
    }).parse(entrada);
    const supabase = await clienteServidor();
    // Substitui a meta ativa equivalente (mesmo período, tipo e disciplina).
    let anterior = supabase.from("metas").update({ ativa: false }).eq("user_id", usuario.id).eq("ativa", true).eq("periodo", d.periodo).eq("tipo", d.tipo);
    anterior = d.disciplinaId ? anterior.eq("disciplina_id", d.disciplinaId) : anterior.is("disciplina_id", null);
    await anterior;
    const { error } = await supabase.from("metas").insert({ user_id: usuario.id, periodo: d.periodo, tipo: d.tipo, alvo: d.alvo, disciplina_id: d.disciplinaId ?? null });
    if (error) throw error;
    revalidatePath("/metas");
    revalidatePath("/dashboard");
    return null;
  });
}

export async function desativarMeta(id: string) {
  return executarAcao("metas.desativar", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("metas").update({ ativa: false }).eq("id", z.string().uuid().parse(id));
    if (error) throw error;
    revalidatePath("/metas");
    return null;
  });
}

/** Registra uma sessão concluída no Pomodoro (tempo efetivamente estudado). */
export async function registrarPomodoro(entrada: { inicio: string; fim: string; pomodoros: number; disciplinaId?: string | null; notas?: string }) {
  return executarAcao("metas.pomodoro", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      inicio: z.string().datetime(), fim: z.string().datetime(), pomodoros: z.number().int().min(0).max(50),
      disciplinaId: z.string().uuid().nullable().optional(), notas: z.string().max(2000).optional(),
    }).parse(entrada);
    const inicio = new Date(d.inicio);
    const fim = new Date(Math.min(new Date(d.fim).getTime(), Date.now()));
    if (fim.getTime() - inicio.getTime() < 60_000) throw new ErroApp("Sessão curta demais para registrar.");
    const supabase = await clienteServidor();
    const { error } = await supabase.from("sessoes_estudo").insert({
      user_id: usuario.id, tipo: "pomodoro", origem: "pomodoro", pomodoros: d.pomodoros, disciplina_id: d.disciplinaId ?? null,
      inicio: inicio.toISOString(), fim: fim.toISOString(), notas: d.notas || null,
    });
    if (error) throw error;
    revalidatePath("/metas");
    return null;
  });
}

export async function registrarSessaoManual(entrada: { data: string; minutos: number; tipo: string; disciplinaId?: string | null; notas?: string }) {
  return executarAcao("metas.sessao", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      data: z.string().datetime({ offset: true }), minutos: z.number().int().min(1).max(960),
      tipo: z.enum(["leitura", "questoes", "revisao", "flashcards", "simulado", "outro"]), disciplinaId: z.string().uuid().nullable().optional(), notas: z.string().max(2000).optional(),
    }).parse(entrada);
    const inicio = new Date(d.data);
    if (inicio.getTime() > Date.now()) throw new ErroApp("Registre apenas sessões já realizadas.");
    const supabase = await clienteServidor();
    const { error } = await supabase.from("sessoes_estudo").insert({
      user_id: usuario.id, tipo: d.tipo, origem: "manual", disciplina_id: d.disciplinaId ?? null, notas: d.notas || null,
      inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + d.minutos * 60000).toISOString(),
    });
    if (error) throw error;
    revalidatePath("/metas");
    return null;
  });
}

export async function salvarPreferenciasPomodoro(entrada: { foco: number; pausa: number; pausaLonga: number; gamificacao: boolean }) {
  return executarAcao("metas.preferencias", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ foco: z.number().int().min(5).max(120), pausa: z.number().int().min(1).max(60), pausaLonga: z.number().int().min(1).max(90), gamificacao: z.boolean() }).parse(entrada);
    const supabase = await clienteServidor();
    const { error } = await supabase.from("preferencias_usuario").update({ pomodoro_foco_min: d.foco, pomodoro_pausa_min: d.pausa, pomodoro_pausa_longa_min: d.pausaLonga, gamificacao: d.gamificacao }).eq("user_id", usuario.id);
    if (error) throw error;
    revalidatePath("/metas");
    return null;
  });
}
