"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";

export async function excluirConversa(id: string) {
  return executarAcao("tutor.excluir", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("tutor_conversas").delete().eq("id", z.string().uuid().parse(id)).eq("user_id", usuario.id);
    if (error) throw error;
    revalidatePath("/tutor");
  });
}

export async function renomearConversa(id: string, titulo: string) {
  return executarAcao("tutor.renomear", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("tutor_conversas").update({ titulo: z.string().trim().min(1).max(120).parse(titulo) })
      .eq("id", z.string().uuid().parse(id)).eq("user_id", usuario.id);
    if (error) throw error;
    revalidatePath("/tutor");
  });
}
