import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { clienteServidor } from "@/lib/supabase/servidor";

export interface UsuarioAtual {
  id: string;
  email: string | null;
  nome: string;
  papel: "aluno" | "admin";
  onboardingConcluido: boolean;
  /** Fuso das preferências, carregado junto com o perfil (evita outra consulta por página). */
  fuso: string;
}

/**
 * Usuário da requisição, com o JWT verificado por getClaims().
 * Memorizado por requisição (React cache).
 */
export const obterUsuario = cache(async (): Promise<UsuarioAtual | null> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (error || !id) return null;
  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome, papel, onboarding_concluido, preferencias_usuario(fuso_horario)")
    .eq("id", id)
    .maybeSingle();
  const pref = perfil?.preferencias_usuario as unknown as { fuso_horario: string } | { fuso_horario: string }[] | null;
  const fuso = (Array.isArray(pref) ? pref[0] : pref)?.fuso_horario ?? "America/Sao_Paulo";
  return {
    id,
    email: (data.claims.email as string | undefined) ?? null,
    nome: perfil?.nome ?? "",
    papel: perfil?.papel === "admin" ? "admin" : "aluno",
    onboardingConcluido: Boolean(perfil?.onboarding_concluido),
    fuso,
  };
});

export async function exigirUsuario(): Promise<UsuarioAtual> {
  const usuario = await obterUsuario();
  if (!usuario) redirect("/entrar");
  return usuario;
}

export async function exigirAdmin(): Promise<UsuarioAtual> {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "admin") redirect("/dashboard");
  return usuario;
}
