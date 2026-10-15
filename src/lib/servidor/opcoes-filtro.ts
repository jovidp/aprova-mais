import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpcoesFiltro } from "@/lib/questoes/filtros";

export async function carregarOpcoesFiltro(supabase: SupabaseClient, userId: string): Promise<OpcoesFiltro> {
  const [d, a, b, m, c] = await Promise.all([
    supabase.from("disciplinas").select("id, nome").order("nome"),
    supabase.from("assuntos").select("id, nome, disciplina_id").order("nome").limit(2000),
    supabase.from("bancas").select("id, sigla").order("sigla"),
    supabase.from("materiais").select("id, titulo, disciplina_id").eq("user_id", userId).order("titulo").limit(1000),
    supabase.from("concursos").select("id, nome").order("nome"),
  ]);
  return { disciplinas: d.data ?? [], assuntos: a.data ?? [], bancas: b.data ?? [], materiais: m.data ?? [], concursos: c.data ?? [] };
}
