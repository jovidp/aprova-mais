"use server";

import { z } from "zod";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { garantirDisciplina, vincularDisciplinaAoUsuario } from "@/lib/servidor/taxonomia";
import { regenerarCronograma } from "@/lib/servidor/cronograma";
import { ErroApp } from "@/lib/erros";

const esquema = z.object({
  concurso: z.object({
    nome: z.string().trim().min(2, "Informe o concurso").max(200),
    orgao: z.string().trim().max(200).optional().default(""),
    cargo: z.string().trim().max(200).optional().default(""),
    bancaId: z.string().uuid().optional().or(z.literal("")),
    dataProva: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  }),
  disciplinas: z
    .array(z.object({
      nome: z.string().trim().min(1).max(160),
      dificuldade: z.number().int().min(1).max(5),
      prioridade: z.number().int().min(1).max(5),
      peso: z.number().min(0.1).max(10),
    }))
    .min(1, "Escolha ao menos uma disciplina")
    .max(40),
  janelas: z
    .array(z.object({ diaSemana: z.number().int().min(0).max(6), inicioMin: z.number().int().min(0).max(1439), fimMin: z.number().int().min(1).max(1440) }))
    .max(50)
    .refine((js) => js.every((j) => j.fimMin > j.inicioMin), "Horário final deve ser depois do inicial"),
  diasDescanso: z.array(z.number().int().min(0).max(6)).max(7),
  preferencias: z.array(z.enum(["pdf", "videoaula", "questoes", "flashcards", "resumos"])).min(1),
  metas: z.object({
    questoesDia: z.number().int().min(0).max(1000),
    horasSemana: z.number().min(0).max(100),
    simuladosMes: z.number().int().min(0).max(60),
  }),
});

export type DadosOnboarding = z.infer<typeof esquema>;

function semSobreposicao(janelas: DadosOnboarding["janelas"]) {
  for (let i = 0; i < janelas.length; i++)
    for (let j = i + 1; j < janelas.length; j++) {
      const a = janelas[i];
      const b = janelas[j];
      if (a.diaSemana === b.diaSemana && a.inicioMin < b.fimMin && b.inicioMin < a.fimMin) return false;
    }
  return true;
}

export async function concluirOnboarding(entrada: DadosOnboarding) {
  return executarAcao("onboarding", async () => {
    const usuario = await exigirUsuario();
    const dados = esquema.parse(entrada);
    if (!semSobreposicao(dados.janelas)) throw new ErroApp("Há horários sobrepostos no mesmo dia.");
    const supabase = await clienteServidor();
    const uid = usuario.id;

    const concurso = await supabase
      .from("concursos")
      .insert({
        owner_id: uid, nome: dados.concurso.nome, orgao: dados.concurso.orgao || null, cargo: dados.concurso.cargo || null,
        banca_id: dados.concurso.bancaId || null, data_prova: dados.concurso.dataProva || null,
      })
      .select("id")
      .single();
    if (concurso.error) throw concurso.error;

    for (const d of dados.disciplinas) {
      const id = await garantirDisciplina(supabase, uid, d.nome);
      await vincularDisciplinaAoUsuario(supabase, uid, id);
      const { error } = await supabase.from("usuario_disciplinas")
        .update({ dificuldade: d.dificuldade, prioridade: d.prioridade, peso: d.peso, ativa: true })
        .eq("user_id", uid).eq("disciplina_id", id);
      if (error) throw error;
    }

    const limpar = await supabase.from("disponibilidade_semanal").delete().eq("user_id", uid);
    if (limpar.error) throw limpar.error;
    if (dados.janelas.length) {
      const { error } = await supabase.from("disponibilidade_semanal").insert(
        dados.janelas.map((j) => ({ user_id: uid, dia_semana: j.diaSemana, inicio_min: j.inicioMin, fim_min: j.fimMin })),
      );
      if (error) throw error;
    }

    const pref = await supabase.from("preferencias_usuario")
      .update({ dias_descanso: dados.diasDescanso, preferencias_estudo: dados.preferencias })
      .eq("user_id", uid);
    if (pref.error) throw pref.error;

    const metas = [
      { periodo: "diaria", tipo: "questoes", alvo: dados.metas.questoesDia },
      { periodo: "semanal", tipo: "horas", alvo: dados.metas.horasSemana },
      { periodo: "mensal", tipo: "simulados", alvo: dados.metas.simuladosMes },
    ].filter((m) => m.alvo > 0);
    if (metas.length) {
      await supabase.from("metas").update({ ativa: false }).eq("user_id", uid).eq("ativa", true);
      const { error } = await supabase.from("metas").insert(metas.map((m) => ({ ...m, user_id: uid })));
      if (error) throw error;
    }

    const perfil = await supabase.from("profiles")
      .update({ concurso_alvo_id: concurso.data.id, data_prova: dados.concurso.dataProva || null, onboarding_concluido: true })
      .eq("id", uid);
    if (perfil.error) throw perfil.error;

    const cronograma = await regenerarCronograma(supabase, uid);
    return { atividadesCriadas: cronograma.criadas, semDisponibilidade: cronograma.semDisponibilidade };
  });
}
