"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirAdmin } from "@/lib/auth";
import { adminDisponivel, clienteAdmin } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { apagarUsuarioCompleto } from "@/lib/servidor/contas";
import { ErroApp } from "@/lib/erros";
import { ipDoCliente, ipValido, normalizarIp } from "@/lib/rede/ip";

/** Banimento "para sempre" no Auth (100 anos). */
const BAN_PERMANENTE = "876000h";

async function contexto() {
  const admin = await exigirAdmin();
  if (!adminDisponivel()) throw new ErroApp("SUPABASE_SECRET_KEY não configurada no servidor.");
  return { admin, cliente: clienteAdmin(), meuIp: ipDoCliente(await headers()) };
}

async function alvoValido(cliente: ReturnType<typeof clienteAdmin>, adminId: string, userId: string) {
  if (userId === adminId) throw new ErroApp("Você não pode excluir ou banir a sua própria conta por aqui.");
  const { data } = await cliente.from("profiles").select("papel").eq("id", userId).maybeSingle();
  if (data?.papel === "admin") throw new ErroApp("Não é possível excluir ou banir outro administrador.");
  const { data: u, error } = await cliente.auth.admin.getUserById(userId);
  if (error || !u.user) throw new ErroApp("Usuário não encontrado.");
  return u.user;
}

const esquemaPunir = z.object({
  userId: z.string().uuid(),
  acao: z.enum(["banir", "excluir"]),
  bloquearIps: z.boolean(),
  bloquearEmail: z.boolean(),
  motivo: z.string().trim().max(500).default(""),
});

/**
 * Bane (bloqueia o login para sempre) ou exclui um usuário e, opcionalmente,
 * bloqueia os IPs que ele usou e o e-mail (impede novo cadastro).
 */
export async function punirUsuario(entrada: z.input<typeof esquemaPunir>) {
  return executarAcao("admin.punir", async () => {
    const d = esquemaPunir.parse(entrada);
    const { admin, cliente, meuIp } = await contexto();
    const alvo = await alvoValido(cliente, admin.id, d.userId);
    const email = alvo.email?.toLowerCase() ?? null;
    const motivo = d.motivo || null;
    const resultado = { ipsBloqueados: [] as string[], ipsIgnorados: [] as string[] };

    // IPs antes de excluir (a exclusão apaga o histórico de acessos).
    if (d.bloquearIps) {
      const { data: acessos } = await cliente.from("acessos_usuario").select("ip").eq("user_id", d.userId);
      for (const { ip } of acessos ?? []) {
        const valor = String(ip).replace(/\/(32|128)$/, "");
        if (meuIp && valor === meuIp) { resultado.ipsIgnorados.push(valor); continue; }
        const { error } = await cliente.from("ips_bloqueados").upsert({ ip: valor, motivo, email_relacionado: email, criado_por: admin.id }, { onConflict: "ip" });
        if (error) resultado.ipsIgnorados.push(valor); // IP de administrador (protegido no banco)
        else resultado.ipsBloqueados.push(valor);
      }
    }
    if (d.bloquearEmail && email) {
      const { error } = await cliente.from("emails_bloqueados").upsert({ email, motivo, criado_por: admin.id }, { onConflict: "email" });
      if (error) throw error;
    }

    if (d.acao === "excluir") {
      await apagarUsuarioCompleto(cliente, d.userId);
    } else {
      const { error } = await cliente.auth.admin.updateUserById(d.userId, { ban_duration: BAN_PERMANENTE });
      if (error) throw error;
      // Encerra as sessões abertas: o token atual deixa de ser renovado.
      await cliente.auth.admin.signOut(d.userId).catch(() => undefined);
    }
    revalidatePath("/admin/usuarios");
    return resultado;
  });
}

export async function desbanirUsuario(userId: string) {
  return executarAcao("admin.desbanir", async () => {
    const { cliente } = await contexto();
    const { error } = await cliente.auth.admin.updateUserById(z.string().uuid().parse(userId), { ban_duration: "none" });
    if (error) throw error;
    revalidatePath("/admin/usuarios");
  });
}

export async function bloquearIp(ipInformado: string, motivoInformado: string) {
  return executarAcao("admin.bloquear-ip", async () => {
    const { admin, cliente, meuIp } = await contexto();
    const ip = normalizarIp(ipInformado);
    if (!ipValido(ip)) throw new ErroApp("IP inválido. Use, por exemplo, 200.100.50.25 ou 200.100.50.0/24.");
    if (meuIp && ip === meuIp) throw new ErroApp("Este é o seu IP atual; bloqueá-lo tiraria o seu acesso.");
    const { error } = await cliente.from("ips_bloqueados").upsert(
      { ip, motivo: motivoInformado.trim().slice(0, 500) || null, criado_por: admin.id }, { onConflict: "ip" });
    if (error) throw error;
    revalidatePath("/admin/usuarios");
  });
}

export async function desbloquearIp(ip: string) {
  return executarAcao("admin.desbloquear-ip", async () => {
    const { cliente } = await contexto();
    const { error } = await cliente.from("ips_bloqueados").delete().eq("ip", ip);
    if (error) throw error;
    revalidatePath("/admin/usuarios");
  });
}

export async function desbloquearEmail(email: string) {
  return executarAcao("admin.desbloquear-email", async () => {
    const { cliente } = await contexto();
    const { error } = await cliente.from("emails_bloqueados").delete().eq("email", email.toLowerCase());
    if (error) throw error;
    revalidatePath("/admin/usuarios");
  });
}
