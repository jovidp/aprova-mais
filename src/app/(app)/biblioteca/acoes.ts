"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { garantirAssunto, garantirDisciplina, garantirSubassunto, novoCacheAssuntos, vincularDisciplinaAoUsuario } from "@/lib/servidor/taxonomia";

const id = z.string().uuid();

export async function alternarFavorito(materialId: string, favorito: boolean) {
  return executarAcao("biblioteca.favorito", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("materiais").update({ favorito }).eq("id", id.parse(materialId));
    if (error) throw error;
    revalidatePath("/biblioteca");
    return null;
  });
}

/** Remove o material, suas páginas e o arquivo do Storage (questões ficam sem a referência). */
export async function excluirMaterial(materialId: string) {
  return executarAcao("biblioteca.excluir", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { data: material } = await supabase.from("materiais").select("storage_path").eq("id", id.parse(materialId)).eq("user_id", usuario.id).maybeSingle();
    if (!material) throw new ErroApp("Material não encontrado", "nao_encontrado", 404);
    const { error } = await supabase.from("materiais").delete().eq("id", materialId);
    if (error) throw error;
    // Outro material com o mesmo arquivo não existe (sha256 é único por usuário), então o objeto pode sair.
    await supabase.storage.from("materiais").remove([material.storage_path]);
    revalidatePath("/biblioteca");
    return null;
  });
}

export async function atualizarMaterial(entrada: { materialId: string; titulo: string; disciplina: string; aulaNumero: number | null; possivelmenteDesatualizado: boolean; observacao: string }) {
  return executarAcao("biblioteca.atualizar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      materialId: id, titulo: z.string().trim().min(1).max(300), disciplina: z.string().trim().max(160),
      aulaNumero: z.number().int().min(0).max(999).nullable(), possivelmenteDesatualizado: z.boolean(), observacao: z.string().max(1000),
    }).parse(entrada);
    const supabase = await clienteServidor();
    const disciplinaId = d.disciplina ? await garantirDisciplina(supabase, usuario.id, d.disciplina) : null;
    if (disciplinaId) await vincularDisciplinaAoUsuario(supabase, usuario.id, disciplinaId);
    const { error } = await supabase.from("materiais").update({
      titulo: d.titulo, disciplina_id: disciplinaId, aula_numero: d.aulaNumero,
      possivelmente_desatualizado: d.possivelmenteDesatualizado, observacao_atualizacao: d.observacao || null,
    }).eq("id", d.materialId);
    if (error) throw error;
    revalidatePath(`/biblioteca/${d.materialId}`);
    return null;
  });
}

/** Corrige a classificação de uma seção (assunto, subassunto, tipo e páginas). */
export async function atualizarSecao(entrada: {
  secaoId: string; assunto: string; subassunto: string; tipo: string; paginaInicio: number; paginaFim: number;
}) {
  return executarAcao("biblioteca.secao", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      secaoId: id, assunto: z.string().trim().max(200), subassunto: z.string().trim().max(240),
      tipo: z.enum(["apresentacao", "teoria", "questoes_comentadas", "lista_questoes", "gabarito", "resumo", "outro"]),
      paginaInicio: z.number().int().min(1), paginaFim: z.number().int().min(1),
    }).parse(entrada);
    if (d.paginaFim < d.paginaInicio) throw new ErroApp("A página final deve ser maior ou igual à inicial.");
    const supabase = await clienteServidor();
    const { data: secao } = await supabase.from("material_secoes")
      .select("material_id, materiais!inner(disciplina_id, total_paginas)").eq("id", d.secaoId).maybeSingle();
    if (!secao) throw new ErroApp("Seção não encontrada", "nao_encontrado", 404);
    const mat = secao.materiais as unknown as { disciplina_id: string | null; total_paginas: number };
    if (d.paginaFim > mat.total_paginas) throw new ErroApp(`O material tem ${mat.total_paginas} páginas.`);

    let assuntoId: string | null = null;
    let subassuntoId: string | null = null;
    if (d.assunto) {
      if (!mat.disciplina_id) throw new ErroApp("Defina a disciplina do material antes de classificar seções.");
      const cache = novoCacheAssuntos();
      assuntoId = await garantirAssunto(supabase, usuario.id, mat.disciplina_id, d.assunto, cache);
      if (d.subassunto) subassuntoId = await garantirSubassunto(supabase, usuario.id, assuntoId, d.subassunto, cache);
    }
    const { error } = await supabase.from("material_secoes").update({
      assunto_id: assuntoId, subassunto_id: subassuntoId, tipo: d.tipo, pagina_inicio: d.paginaInicio, pagina_fim: d.paginaFim,
      classificacao_origem: "manual", revisado_manualmente: true, confianca: 1,
    }).eq("id", d.secaoId);
    if (error) throw error;
    await supabase.from("material_paginas").update({ secao_id: d.secaoId }).eq("material_id", secao.material_id)
      .gte("numero", d.paginaInicio).lte("numero", d.paginaFim);
    revalidatePath(`/biblioteca/${secao.material_id}`);
    return null;
  });
}

export async function urlAssinada(materialId: string) {
  return executarAcao("biblioteca.url", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { data: material } = await supabase.from("materiais").select("storage_path").eq("id", id.parse(materialId)).eq("user_id", usuario.id).maybeSingle();
    if (!material) throw new ErroApp("Material não encontrado", "nao_encontrado", 404);
    const { data, error } = await supabase.storage.from("materiais").createSignedUrl(material.storage_path, 60 * 60);
    if (error) throw error;
    return { url: data.signedUrl };
  });
}
