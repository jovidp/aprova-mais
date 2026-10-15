"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { INTERVALOS_PADRAO, dataProxima, proximaRevisao } from "@/lib/estudo/srs";
import { dataLocal, somarDias } from "@/lib/estudo/tempo";

const uuid = z.string().uuid();

export async function avaliarRevisao(entrada: { id: string; avaliacao: "nao_lembrei" | "dificil" | "bom" | "facil" }) {
  return executarAcao("revisoes.avaliar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ id: uuid, avaliacao: z.enum(["nao_lembrei", "dificil", "bom", "facil"]) }).parse(entrada);
    const supabase = await clienteServidor();
    const [{ data: rev }, { data: pref }] = await Promise.all([
      supabase.from("revisoes").select("facilidade, intervalo_dias, repeticoes, lapsos, status").eq("id", d.id).eq("user_id", usuario.id).maybeSingle(),
      supabase.from("preferencias_usuario").select("intervalos_revisao_dias, fuso_horario").eq("user_id", usuario.id).maybeSingle(),
    ]);
    if (!rev) throw new ErroApp("Revisão não encontrada", "nao_encontrado", 404);
    const novo = proximaRevisao(
      { facilidade: Number(rev.facilidade), intervaloDias: rev.intervalo_dias, repeticoes: rev.repeticoes, lapsos: rev.lapsos },
      d.avaliacao, pref?.intervalos_revisao_dias ?? INTERVALOS_PADRAO,
    );
    const hoje = dataLocal(new Date(), pref?.fuso_horario ?? "America/Sao_Paulo");
    const { error } = await supabase.from("revisoes").update({
      facilidade: novo.facilidade, intervalo_dias: novo.intervaloDias, repeticoes: novo.repeticoes, lapsos: novo.lapsos,
      proxima_em: dataProxima(hoje, novo.intervaloDias), ultima_em: new Date().toISOString(),
    }).eq("id", d.id);
    if (error) throw error;
    await supabase.from("revisao_historico").insert({
      revisao_id: d.id, user_id: usuario.id, avaliacao: d.avaliacao, intervalo_anterior: rev.intervalo_dias,
      intervalo_novo: novo.intervaloDias, facilidade_nova: novo.facilidade,
    });
    revalidatePath("/revisoes");
    return { proximaEm: dataProxima(hoje, novo.intervaloDias), intervaloDias: novo.intervaloDias };
  });
}

export async function criarRevisaoAssunto(assuntoId: string) {
  return executarAcao("revisoes.criar", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { data: assunto } = await supabase.from("assuntos").select("nome").eq("id", uuid.parse(assuntoId)).maybeSingle();
    if (!assunto) throw new ErroApp("Assunto não encontrado");
    const { data: pref } = await supabase.from("preferencias_usuario").select("intervalos_revisao_dias, fuso_horario").eq("user_id", usuario.id).maybeSingle();
    const primeiro = (pref?.intervalos_revisao_dias ?? INTERVALOS_PADRAO)[0] ?? 1;
    const data = somarDias(dataLocal(new Date(), pref?.fuso_horario ?? "America/Sao_Paulo"), primeiro);
    const { error } = await supabase.rpc("agendar_revisao_assunto", { p_assunto_id: assuntoId, p_titulo: assunto.nome, p_data: data, p_origem: "manual" });
    if (error) throw error;
    revalidatePath("/revisoes");
    return { data };
  });
}

export async function alterarStatusRevisao(id: string, status: "ativa" | "suspensa" | "concluida") {
  return executarAcao("revisoes.status", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("revisoes").update({ status }).eq("id", uuid.parse(id));
    if (error) throw error;
    revalidatePath("/revisoes");
    return null;
  });
}
