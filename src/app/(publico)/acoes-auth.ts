"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { clienteServidor } from "@/lib/supabase/servidor";
import { envPublico } from "@/lib/env";
import type { Resultado } from "@/lib/erros";
import { esquemaCadastro, esquemaEmail, esquemaEntrar, esquemaSenha } from "@/lib/validacao/auth";

const email = esquemaEmail;
const senha = esquemaSenha;

async function urlBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocolo = h.get("x-forwarded-proto") ?? "https";
  return host ? `${protocolo}://${host}` : envPublico.siteUrl;
}

/** Só permite redirecionamento para caminhos internos (evita open redirect). */
function destinoSeguro(voltar: unknown) {
  return typeof voltar === "string" && voltar.startsWith("/") && !voltar.startsWith("//") ? voltar : "/dashboard";
}

export async function entrar(dados: z.infer<typeof esquemaEntrar> & { voltar?: string }): Promise<Resultado<null>> {
  const v = esquemaEntrar.safeParse(dados);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: v.data.email, password: v.data.senha });
  if (error) {
    if (/email not confirmed/i.test(error.message)) return { ok: false, erro: "Confirme seu e-mail antes de entrar." };
    if (/invalid login credentials/i.test(error.message)) return { ok: false, erro: "E-mail ou senha incorretos." };
    if (/rate limit/i.test(error.message)) return { ok: false, erro: "Muitas tentativas. Aguarde alguns minutos." };
    return { ok: false, erro: "Não foi possível entrar agora. Tente novamente." };
  }
  redirect(destinoSeguro(dados.voltar));
}

export async function cadastrar(dados: z.infer<typeof esquemaCadastro>): Promise<Resultado<{ confirmarEmail: boolean }>> {
  const v = esquemaCadastro.safeParse(dados);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  const supabase = await clienteServidor();
  const { data, error } = await supabase.auth.signUp({
    email: v.data.email,
    password: v.data.senha,
    options: { data: { nome: v.data.nome }, emailRedirectTo: `${await urlBase()}/auth/callback?proximo=/onboarding` },
  });
  if (error) {
    if (/already registered/i.test(error.message)) return { ok: false, erro: "Este e-mail já está cadastrado." };
    if (/password/i.test(error.message)) return { ok: false, erro: "Senha fraca. Use letras, números e símbolos." };
    if (/rate limit/i.test(error.message)) return { ok: false, erro: "Limite de e-mails atingido. Tente mais tarde." };
    return { ok: false, erro: "Não foi possível criar a conta agora." };
  }
  if (data.session) redirect("/onboarding");
  return { ok: true, dados: { confirmarEmail: true } };
}

export async function solicitarRecuperacao(emailInformado: string): Promise<Resultado<null>> {
  const v = email.safeParse(emailInformado);
  if (!v.success) return { ok: false, erro: "E-mail inválido" };
  const supabase = await clienteServidor();
  await supabase.auth.resetPasswordForEmail(v.data, { redirectTo: `${await urlBase()}/auth/callback?proximo=/redefinir-senha` });
  // Mesma resposta exista ou não a conta (não revela e-mails cadastrados).
  return { ok: true, dados: null };
}

export async function redefinirSenha(novaSenha: string, confirmacao: string): Promise<Resultado<null>> {
  const v = senha.safeParse(novaSenha);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  if (novaSenha !== confirmacao) return { ok: false, erro: "As senhas não conferem" };
  const supabase = await clienteServidor();
  const { error } = await supabase.auth.updateUser({ password: v.data });
  if (error) return { ok: false, erro: "Não foi possível alterar a senha. Solicite um novo link." };
  redirect("/dashboard");
}

export async function sair() {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  redirect("/entrar");
}
