"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth";
import { adminDisponivel, clienteAdmin, clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { apagarUsuarioCompleto } from "@/lib/servidor/contas";

const esquemaPerfil = z.object({
  nome: z.string().trim().max(120),
  dataProva: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
});

export async function salvarPerfil(entrada: z.input<typeof esquemaPerfil>) {
  return executarAcao("config.perfil", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const d = esquemaPerfil.parse(entrada);
    const { error } = await supabase.from("profiles").update({ nome: d.nome, data_prova: d.dataProva || null }).eq("id", usuario.id);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}

const esquemaPref = z.object({
  fuso: z.string().min(3).max(64).refine((f) => { try { new Intl.DateTimeFormat("pt-BR", { timeZone: f }); return true; } catch { return false; } }, "Fuso horário inválido"),
  intervalos: z.array(z.number().int().min(1).max(365)).min(1).max(12),
  iaHabilitada: z.boolean(),
  orcamentoIa: z.number().min(0).max(1000),
  limiteQuestoesIa: z.number().int().min(0).max(1000),
  gamificacao: z.boolean(),
  notificacoes: z.object({ atividades: z.boolean(), simulados: z.boolean(), revisoes: z.boolean(), metas: z.boolean(), processamento: z.boolean() }),
});

export async function salvarPreferencias(entrada: z.input<typeof esquemaPref>) {
  return executarAcao("config.preferencias", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const d = esquemaPref.parse(entrada);
    const intervalos = [...new Set(d.intervalos)].sort((a, b) => a - b);
    const { error } = await supabase.from("preferencias_usuario").update({
      fuso_horario: d.fuso, intervalos_revisao_dias: intervalos, ia_habilitada: d.iaHabilitada, orcamento_ia_mensal_usd: d.orcamentoIa,
      limite_questoes_ia_dia: d.limiteQuestoesIa, gamificacao: d.gamificacao, notificacoes: d.notificacoes,
    }).eq("user_id", usuario.id);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}

/** Exclui a conta e todos os dados (arquivos do Storage inclusive). Irreversível. */
export async function excluirConta(confirmacao: string) {
  const r = await executarAcao("config.excluir", async () => {
    const usuario = await exigirUsuario();
    if (confirmacao.trim().toUpperCase() !== "EXCLUIR") throw new ErroApp('Digite EXCLUIR para confirmar.');
    if (!adminDisponivel()) throw new ErroApp("Exclusão indisponível: SUPABASE_SECRET_KEY não configurada.");
    await apagarUsuarioCompleto(clienteAdmin(), usuario.id);
    const supabase = await clienteServidor();
    await supabase.auth.signOut();
  });
  if (r.ok) redirect("/");
  return r;
}
