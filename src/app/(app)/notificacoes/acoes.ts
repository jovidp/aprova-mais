"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";

export async function marcarTodasLidas() {
  return executarAcao("notificacoes.lidas", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("notificacoes").update({ lida: true }).eq("user_id", usuario.id).eq("lida", false);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}
