import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Apaga um usuário por completo: arquivos do Storage (pasta <uid>/) e a
 * conta no Auth, que remove os dados em cascata. Exige o cliente admin.
 */
export async function apagarUsuarioCompleto(admin: SupabaseClient, userId: string) {
  for (;;) {
    const { data: arquivos, error: e1 } = await admin.storage.from("materiais").list(userId, { limit: 100 });
    if (e1) throw e1;
    if (!arquivos?.length) break;
    const { error } = await admin.storage.from("materiais").remove(arquivos.map((a) => `${userId}/${a.name}`));
    if (error) throw error;
    if (arquivos.length < 100) break;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}
