"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { LIMITES_ZIP, MIME_POR_TIPO } from "@/lib/materiais/zip-seguranca";
import { garantirAssunto, garantirDisciplina, garantirSubassunto, novoCacheAssuntos, vincularDisciplinaAoUsuario } from "@/lib/servidor/taxonomia";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const tipoArquivo = z.enum(["pdf", "docx", "txt", "md"]);

export async function criarImportacao(entrada: { nomeArquivo: string; tamanhoBytes: number; totalArquivos: number; ignorados: number }) {
  return executarAcao("importacao.criar", async () => {
    const usuario = await exigirUsuario();
    const dados = z.object({
      nomeArquivo: z.string().min(1).max(300),
      tamanhoBytes: z.number().int().min(0).max(LIMITES_ZIP.tamanhoZipMax),
      totalArquivos: z.number().int().min(0).max(LIMITES_ZIP.entradasMax),
      ignorados: z.number().int().min(0),
    }).parse(entrada);
    const supabase = await clienteServidor();
    const { data, error } = await supabase.from("importacoes").insert({
      user_id: usuario.id, nome_arquivo: dados.nomeArquivo, tamanho_bytes: dados.tamanhoBytes,
      total_arquivos: dados.totalArquivos, arquivos_ignorados: dados.ignorados, status: "processando",
    }).select("id").single();
    if (error) throw error;
    return { importacaoId: data.id as string, userId: usuario.id };
  });
}

/**
 * Registra um arquivo do ZIP. Se o usuário já tem um material com o mesmo
 * SHA-256, ele é marcado como duplicado e nada é reenviado.
 */
export async function registrarArquivo(entrada: { importacaoId: string; caminho: string; tipo: string; tamanhoBytes: number; sha256: string }) {
  return executarAcao("importacao.registrar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({
      importacaoId: z.string().uuid(), caminho: z.string().min(1).max(1000), tipo: tipoArquivo,
      tamanhoBytes: z.number().int().min(1).max(LIMITES_ZIP.arquivoMax), sha256,
    }).parse(entrada);
    const supabase = await clienteServidor();
    const nomeArquivo = d.caminho.split("/").pop()!;

    const { data: existente } = await supabase.from("materiais").select("id, titulo, status").eq("user_id", usuario.id).eq("sha256", d.sha256).maybeSingle();
    const { data: arquivo, error } = await supabase.from("importacao_arquivos").upsert({
      importacao_id: d.importacaoId, user_id: usuario.id, caminho_original: d.caminho, nome_arquivo: nomeArquivo,
      tipo: d.tipo, tamanho_bytes: d.tamanhoBytes, sha256: d.sha256,
      status: existente && existente.status === "processado" ? "duplicado" : "enviando",
      motivo: existente && existente.status === "processado" ? `Já existe na biblioteca: ${existente.titulo}` : null,
      material_id: existente?.id ?? null,
    }, { onConflict: "importacao_id,caminho_original" }).select("id").single();
    if (error) throw error;

    if (existente && existente.status === "processado") {
      return { arquivoId: arquivo.id as string, duplicado: true as const, materialId: existente.id as string };
    }
    return {
      arquivoId: arquivo.id as string, duplicado: false as const, materialId: (existente?.id as string | undefined) ?? null,
      storagePath: `${usuario.id}/${d.sha256}.${d.tipo}`,
    };
  });
}

const esquemaSecao = z.object({
  ordem: z.number().int().min(1).max(500),
  titulo: z.string().min(1).max(500),
  paginaInicio: z.number().int().min(1),
  paginaFim: z.number().int().min(1),
  tipo: z.enum(["apresentacao", "teoria", "questoes_comentadas", "lista_questoes", "gabarito", "resumo", "outro"]),
  assunto: z.string().max(200).nullable(),
  subassunto: z.string().max(240).nullable(),
  banca: z.string().max(60).nullable(),
  origem: z.enum(["indice", "titulos", "documento_inteiro"]),
  confianca: z.number().min(0).max(1),
});

const esquemaMaterial = z.object({
  arquivoId: z.string().uuid(),
  importacaoId: z.string().uuid().nullable(),
  storagePath: z.string().max(400),
  caminho: z.string().max(1000),
  tipo: tipoArquivo,
  tamanhoBytes: z.number().int().min(1).max(LIMITES_ZIP.arquivoMax),
  sha256,
  totalPaginas: z.number().int().min(1).max(5000),
  requerOcr: z.boolean(),
  avisos: z.array(z.string().max(500)).max(20),
  metadados: z.object({
    aulaNumero: z.number().int().min(0).max(999).nullable(),
    aulaRotulo: z.string().max(200).nullable(),
    concurso: z.string().max(300).nullable(),
    disciplina: z.string().max(200).nullable(),
    autor: z.string().max(300).nullable(),
    dataMaterial: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  secoes: z.array(esquemaSecao).max(500),
});

/**
 * Cria o material e suas seções classificadas depois do envio ao Storage.
 * As páginas chegam em lotes por salvarPaginas().
 */
export async function criarMaterial(entrada: z.infer<typeof esquemaMaterial>) {
  return executarAcao("importacao.material", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaMaterial.parse(entrada);
    if (!d.storagePath.startsWith(`${usuario.id}/`)) throw new ErroApp("Caminho de armazenamento inválido", "proibido", 403);
    if (d.secoes.some((s) => s.paginaFim < s.paginaInicio || s.paginaFim > d.totalPaginas)) throw new ErroApp("Seções com páginas inválidas");
    const supabase = await clienteServidor();

    // Confere que o arquivo realmente está no Storage, na pasta do usuário.
    const pasta = d.storagePath.split("/").slice(0, -1).join("/");
    const nome = d.storagePath.split("/").pop()!;
    const { data: lista, error: erroLista } = await supabase.storage.from("materiais").list(pasta, { search: nome, limit: 1 });
    if (erroLista) throw erroLista;
    if (!lista?.some((o) => o.name === nome)) throw new ErroApp("O arquivo não foi encontrado no armazenamento. Envie novamente.");

    const disciplinaId = d.metadados.disciplina ? await garantirDisciplina(supabase, usuario.id, d.metadados.disciplina) : null;
    if (disciplinaId) await vincularDisciplinaAoUsuario(supabase, usuario.id, disciplinaId);

    const nomeArquivo = d.caminho.split("/").pop()!;
    const aula = d.metadados.aulaNumero !== null ? `Aula ${String(d.metadados.aulaNumero).padStart(2, "0")}` : null;
    const principal = d.secoes.find((s) => s.tipo === "teoria" && s.assunto)?.assunto ?? d.secoes.find((s) => s.assunto)?.assunto;
    const titulo = [aula, principal ?? nomeArquivo.replace(/\.\w+$/, "")].filter(Boolean).join(" — ").slice(0, 300);

    const registro = {
      user_id: usuario.id, titulo, nome_arquivo: nomeArquivo, caminho_original: d.caminho, storage_path: d.storagePath,
      tipo: d.tipo, mime: MIME_POR_TIPO[d.tipo], tamanho_bytes: d.tamanhoBytes, sha256: d.sha256,
      total_paginas: d.totalPaginas, paginas_processadas: 0, status: d.requerOcr ? "requer_ocr" : "processando",
      erro: d.requerOcr ? "PDF digitalizado: o texto precisa de OCR para busca e geração de questões." : null,
      disciplina_id: disciplinaId, concurso_detectado: d.metadados.concurso, autor: d.metadados.autor,
      aula_numero: d.metadados.aulaNumero, aula_rotulo: d.metadados.aulaRotulo, data_material: d.metadados.dataMaterial,
      origem: d.importacaoId ? "importacao_zip" : "upload", importacao_id: d.importacaoId,
      metadados: { avisos: d.avisos },
    };
    const { data: material, error } = await supabase.from("materiais").upsert(registro, { onConflict: "user_id,sha256" }).select("id").single();
    if (error) throw error;

    // Reprocessamento substitui seções e páginas anteriores.
    await supabase.from("material_paginas").delete().eq("material_id", material.id);
    await supabase.from("material_secoes").delete().eq("material_id", material.id);

    const cache = novoCacheAssuntos();
    const linhas = [];
    for (const s of d.secoes) {
      let assuntoId: string | null = null;
      let subassuntoId: string | null = null;
      if (disciplinaId && s.assunto && s.tipo !== "apresentacao") {
        assuntoId = await garantirAssunto(supabase, usuario.id, disciplinaId, s.assunto, cache, d.metadados.aulaNumero ?? 0);
        if (s.subassunto) subassuntoId = await garantirSubassunto(supabase, usuario.id, assuntoId, s.subassunto, cache, s.ordem);
      }
      linhas.push({
        material_id: material.id, user_id: usuario.id, ordem: s.ordem, titulo: s.titulo.slice(0, 500),
        pagina_inicio: s.paginaInicio, pagina_fim: s.paginaFim, tipo: s.tipo, assunto_id: assuntoId,
        subassunto_id: subassuntoId, banca: s.banca, classificacao_origem: s.origem, confianca: s.confianca,
      });
    }
    if (linhas.length) {
      const { error: erroSecoes } = await supabase.from("material_secoes").insert(linhas);
      if (erroSecoes) throw erroSecoes;
    }

    await supabase.from("importacao_arquivos").update({ status: "processando", material_id: material.id }).eq("id", d.arquivoId);
    return { materialId: material.id as string };
  });
}

const esquemaPaginas = z.object({
  materialId: z.string().uuid(),
  paginas: z.array(z.object({ numero: z.number().int().min(1).max(5000), texto: z.string().max(60000) })).min(1).max(60),
});

export async function salvarPaginas(entrada: z.infer<typeof esquemaPaginas>) {
  return executarAcao("importacao.paginas", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaPaginas.parse(entrada);
    const supabase = await clienteServidor();
    const { data: material } = await supabase.from("materiais").select("total_paginas").eq("id", d.materialId).eq("user_id", usuario.id).maybeSingle();
    if (!material) throw new ErroApp("Material não encontrado", "nao_encontrado", 404);
    if (d.paginas.some((p) => p.numero > material.total_paginas)) throw new ErroApp("Página fora do documento");
    const { error } = await supabase.from("material_paginas").upsert(
      d.paginas.map((p) => ({ material_id: d.materialId, numero: p.numero, user_id: usuario.id, texto: p.texto.replace(/\u0000/g, "") })),
      { onConflict: "material_id,numero" },
    );
    if (error) throw error;
    return { salvas: d.paginas.length };
  });
}

/** Liga páginas às seções, marca o material como processado e atualiza a importação. */
export async function finalizarMaterial(entrada: { materialId: string; arquivoId: string | null; importacaoId: string | null }) {
  return executarAcao("importacao.finalizar", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ materialId: z.string().uuid(), arquivoId: z.string().uuid().nullable(), importacaoId: z.string().uuid().nullable() }).parse(entrada);
    const supabase = await clienteServidor();
    const { data: material } = await supabase.from("materiais").select("status, total_paginas").eq("id", d.materialId).eq("user_id", usuario.id).maybeSingle();
    if (!material) throw new ErroApp("Material não encontrado", "nao_encontrado", 404);

    const { count } = await supabase.from("material_paginas").select("numero", { count: "exact", head: true }).eq("material_id", d.materialId);
    const { data: secoes } = await supabase.from("material_secoes").select("id, pagina_inicio, pagina_fim").eq("material_id", d.materialId).order("ordem");
    for (const s of secoes ?? []) {
      await supabase.from("material_paginas").update({ secao_id: s.id }).eq("material_id", d.materialId)
        .gte("numero", s.pagina_inicio).lte("numero", s.pagina_fim);
    }
    const completo = (count ?? 0) >= material.total_paginas;
    await supabase.from("materiais").update({
      paginas_processadas: count ?? 0,
      status: material.status === "requer_ocr" ? "requer_ocr" : completo ? "processado" : "erro",
      erro: completo || material.status === "requer_ocr" ? undefined : `Somente ${count} de ${material.total_paginas} páginas foram salvas.`,
    }).eq("id", d.materialId);
    if (d.arquivoId) {
      await supabase.from("importacao_arquivos").update({ status: completo ? "concluido" : "erro", motivo: completo ? null : "Páginas incompletas" }).eq("id", d.arquivoId);
    }
    if (d.importacaoId) await atualizarContadores(d.importacaoId);
    return { completo };
  });
}

export async function marcarFalhaArquivo(entrada: { arquivoId: string; importacaoId: string; motivo: string; status?: "erro" | "ignorado" }) {
  return executarAcao("importacao.falha", async () => {
    await exigirUsuario();
    const d = z.object({ arquivoId: z.string().uuid(), importacaoId: z.string().uuid(), motivo: z.string().max(500), status: z.enum(["erro", "ignorado"]).optional() }).parse(entrada);
    const supabase = await clienteServidor();
    await supabase.from("importacao_arquivos").update({ status: d.status ?? "erro", motivo: d.motivo }).eq("id", d.arquivoId);
    await atualizarContadores(d.importacaoId);
    return null;
  });
}

async function atualizarContadores(importacaoId: string) {
  const supabase = await clienteServidor();
  const { data: arquivos } = await supabase.from("importacao_arquivos").select("status").eq("importacao_id", importacaoId);
  const lista = arquivos ?? [];
  const conta = (s: string) => lista.filter((a) => a.status === s).length;
  await supabase.from("importacoes").update({
    arquivos_processados: conta("concluido"), arquivos_com_erro: conta("erro"), arquivos_duplicados: conta("duplicado"),
  }).eq("id", importacaoId);
}

export async function concluirImportacao(entrada: { importacaoId: string; cancelada?: boolean }) {
  return executarAcao("importacao.concluir", async () => {
    await exigirUsuario();
    const d = z.object({ importacaoId: z.string().uuid(), cancelada: z.boolean().optional() }).parse(entrada);
    await atualizarContadores(d.importacaoId);
    const supabase = await clienteServidor();
    const { data: imp } = await supabase.from("importacoes").select("arquivos_com_erro, user_id").eq("id", d.importacaoId).single();
    await supabase.from("importacoes").update({
      status: d.cancelada ? "cancelada" : (imp?.arquivos_com_erro ?? 0) > 0 ? "concluida_com_erros" : "concluida",
      concluida_em: new Date().toISOString(),
    }).eq("id", d.importacaoId);
    if (imp && (imp.arquivos_com_erro ?? 0) > 0) {
      await supabase.from("notificacoes").insert({
        user_id: imp.user_id, tipo: "processamento", titulo: "Importação concluída com erros",
        mensagem: `${imp.arquivos_com_erro} arquivo(s) não puderam ser processados.`, link: `/biblioteca/importacoes/${d.importacaoId}`,
      });
    }
    revalidatePath("/biblioteca");
    return null;
  });
}
