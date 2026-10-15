"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { dataLocal, somarDias } from "@/lib/estudo/tempo";
import { CAUSAS } from "./rotulos";

export async function atualizarErro(entrada: { id: string; causa?: (typeof CAUSAS)[number]; observacoes?: string; status?: "ativo" | "superado" | "arquivado" }) {
  return executarAcao("caderno.atualizar", async () => {
    await exigirUsuario();
    const d = z.object({
      id: z.string().uuid(), causa: z.enum(CAUSAS).optional(), observacoes: z.string().max(4000).optional(),
      status: z.enum(["ativo", "superado", "arquivado"]).optional(),
    }).parse(entrada);
    const supabase = await clienteServidor();
    const { error } = await supabase.from("caderno_erros").update({
      ...(d.causa ? { causa: d.causa } : {}), ...(d.observacoes !== undefined ? { observacoes: d.observacoes || null } : {}), ...(d.status ? { status: d.status } : {}),
    }).eq("id", d.id);
    if (error) throw error;
    revalidatePath("/caderno-erros");
    return null;
  });
}

/** Agenda revisão (amanhã) para cada assunto com erros ativos, sem duplicar. */
export async function proporRevisoesDosErros() {
  return executarAcao("caderno.revisoes", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { data } = await supabase.from("caderno_erros").select("questoes!inner(assunto_id, assuntos(nome))").eq("user_id", usuario.id).eq("status", "ativo");
    const { data: pref } = await supabase.from("preferencias_usuario").select("fuso_horario").eq("user_id", usuario.id).maybeSingle();
    const amanha = somarDias(dataLocal(new Date(), pref?.fuso_horario ?? "America/Sao_Paulo"), 1);
    const assuntos = new Map<string, string>();
    for (const l of (data ?? []) as unknown as { questoes: { assunto_id: string | null; assuntos: { nome: string } | null } }[]) {
      if (l.questoes.assunto_id) assuntos.set(l.questoes.assunto_id, l.questoes.assuntos?.nome ?? "Assunto");
    }
    for (const [id, nome] of assuntos) await supabase.rpc("agendar_revisao_assunto", { p_assunto_id: id, p_titulo: nome, p_data: amanha, p_origem: "erro" });
    revalidatePath("/revisoes");
    return { assuntos: assuntos.size };
  });
}
