"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { garantirAssunto, garantirDisciplina, novoCacheAssuntos, vincularDisciplinaAoUsuario } from "@/lib/servidor/taxonomia";
import { slugificar } from "@/lib/materiais/normalizacao";

export async function adicionarDisciplina(nome: string) {
  return executarAcao("disciplinas.adicionar", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const id = await garantirDisciplina(supabase, usuario.id, z.string().trim().min(2, "Informe o nome").max(160).parse(nome));
    await vincularDisciplinaAoUsuario(supabase, usuario.id, id);
    await supabase.from("usuario_disciplinas").update({ ativa: true }).eq("user_id", usuario.id).eq("disciplina_id", id);
    revalidatePath("/disciplinas");
  });
}

const esquemaConfig = z.object({
  disciplinaId: z.string().uuid(),
  peso: z.number().min(0.1).max(10),
  dificuldade: z.number().int().min(1).max(5),
  prioridade: z.number().int().min(1).max(5),
  ativa: z.boolean(),
});

export async function salvarConfigDisciplina(entrada: z.input<typeof esquemaConfig>) {
  return executarAcao("disciplinas.config", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const d = esquemaConfig.parse(entrada);
    const { error } = await supabase.from("usuario_disciplinas").upsert({
      user_id: usuario.id, disciplina_id: d.disciplinaId, peso: d.peso, dificuldade: d.dificuldade, prioridade: d.prioridade, ativa: d.ativa,
    }, { onConflict: "user_id,disciplina_id" });
    if (error) throw error;
    revalidatePath("/disciplinas");
  });
}

export async function adicionarAssunto(disciplinaId: string, nome: string) {
  return executarAcao("disciplinas.assunto", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    await garantirAssunto(supabase, usuario.id, z.string().uuid().parse(disciplinaId), z.string().trim().min(2, "Informe o nome").max(200).parse(nome), novoCacheAssuntos());
    revalidatePath("/disciplinas");
  });
}

export async function renomearAssunto(id: string, nome: string) {
  return executarAcao("disciplinas.renomear", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const novo = z.string().trim().min(2, "Informe o nome").max(200).parse(nome);
    const slug = slugificar(novo) || "assunto";
    const { data, error } = await supabase.from("assuntos").update({ nome: novo, slug }).eq("id", z.string().uuid().parse(id)).eq("owner_id", usuario.id).select("id");
    if (error) {
      if (error.code === "23505") throw new ErroApp("Já existe um assunto com esse nome nesta disciplina.");
      throw error;
    }
    if (!data?.length) throw new ErroApp("Somente assuntos criados por você podem ser renomeados.");
    revalidatePath("/disciplinas");
    revalidatePath("/mapa");
  });
}
