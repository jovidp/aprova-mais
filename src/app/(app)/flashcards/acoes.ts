"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { proximaRevisao, dataProxima, INTERVALOS_PADRAO, type Avaliacao } from "@/lib/estudo/srs";
import { dataLocal } from "@/lib/estudo/tempo";

const esquemaFlashcard = z.object({
  frente: z.string().trim().min(1, "Escreva a frente").max(2000),
  verso: z.string().trim().min(1, "Escreva o verso").max(4000),
  disciplinaId: z.string().uuid().nullable().optional(),
  assuntoId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid().nullable().optional(),
  pagina: z.number().int().min(1).nullable().optional(),
  questaoId: z.string().uuid().nullable().optional(),
  origem: z.enum(["manual", "ia", "trecho_pdf", "questao", "erro"]).default("manual"),
});

export async function criarFlashcard(entrada: z.input<typeof esquemaFlashcard>) {
  return executarAcao("flashcards.criar", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaFlashcard.parse(entrada);
    const supabase = await clienteServidor();
    let disciplinaId = d.disciplinaId ?? null;
    if (!disciplinaId && d.materialId) {
      const { data } = await supabase.from("materiais").select("disciplina_id").eq("id", d.materialId).maybeSingle();
      disciplinaId = data?.disciplina_id ?? null;
    }
    const { data, error } = await supabase.from("flashcards").insert({
      user_id: usuario.id, frente: d.frente, verso: d.verso, disciplina_id: disciplinaId, assunto_id: d.assuntoId ?? null,
      material_id: d.materialId ?? null, pagina: d.pagina ?? null, questao_id: d.questaoId ?? null, origem: d.origem,
    }).select("id").single();
    if (error) throw error;
    revalidatePath("/flashcards");
    return { id: data.id as string };
  });
}

export async function editarFlashcard(entrada: { id: string; frente: string; verso: string; suspenso: boolean }) {
  return executarAcao("flashcards.editar", async () => {
    await exigirUsuario();
    const d = z.object({ id: z.string().uuid(), frente: z.string().trim().min(1).max(2000), verso: z.string().trim().min(1).max(4000), suspenso: z.boolean() }).parse(entrada);
    const supabase = await clienteServidor();
    const { error } = await supabase.from("flashcards").update({ frente: d.frente, verso: d.verso, suspenso: d.suspenso }).eq("id", d.id);
    if (error) throw error;
    revalidatePath("/flashcards");
    return null;
  });
}

export async function excluirFlashcard(id: string) {
  return executarAcao("flashcards.excluir", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("flashcards").delete().eq("id", z.string().uuid().parse(id));
    if (error) throw error;
    revalidatePath("/flashcards");
    return null;
  });
}

/** Registra a revisão do cartão e agenda a próxima conforme a avaliação. */
export async function avaliarFlashcard(entrada: { id: string; avaliacao: Avaliacao; tempoMs: number }) {
  return executarAcao("flashcards.avaliar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ id: z.string().uuid(), avaliacao: z.enum(["nao_lembrei", "dificil", "bom", "facil"]), tempoMs: z.number().int().min(0).max(3_600_000) }).parse(entrada);
    const supabase = await clienteServidor();
    const [{ data: cartao }, { data: pref }] = await Promise.all([
      supabase.from("flashcards").select("facilidade, intervalo_dias, repeticoes, lapsos").eq("id", d.id).eq("user_id", usuario.id).maybeSingle(),
      supabase.from("preferencias_usuario").select("intervalos_revisao_dias, fuso_horario").eq("user_id", usuario.id).maybeSingle(),
    ]);
    if (!cartao) throw new ErroApp("Cartão não encontrado", "nao_encontrado", 404);
    const novo = proximaRevisao(
      { facilidade: Number(cartao.facilidade), intervaloDias: cartao.intervalo_dias, repeticoes: cartao.repeticoes, lapsos: cartao.lapsos },
      d.avaliacao, pref?.intervalos_revisao_dias ?? INTERVALOS_PADRAO,
    );
    const hoje = dataLocal(new Date(), pref?.fuso_horario ?? "America/Sao_Paulo");
    const { error } = await supabase.from("flashcards").update({
      facilidade: novo.facilidade, intervalo_dias: novo.intervaloDias, repeticoes: novo.repeticoes, lapsos: novo.lapsos,
      proxima_em: dataProxima(hoje, novo.intervaloDias), ultima_em: new Date().toISOString(),
    }).eq("id", d.id);
    if (error) throw error;
    await supabase.from("flashcard_revisoes").insert({
      flashcard_id: d.id, user_id: usuario.id, avaliacao: d.avaliacao, intervalo_anterior: cartao.intervalo_dias,
      intervalo_novo: novo.intervaloDias, tempo_ms: d.tempoMs,
    });
    return { proximaEm: dataProxima(hoje, novo.intervaloDias), intervaloDias: novo.intervaloDias };
  });
}
