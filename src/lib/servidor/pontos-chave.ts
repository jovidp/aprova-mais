import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { envServidor } from "@/lib/env";
import { ErroApp } from "@/lib/erros";
import { executarComIA, obterProvedor } from "@/lib/ia";
import { precosDoModelo } from "@/lib/ia/precos";
import { blocoMaterial } from "@/lib/questoes/prompts";
import { PAGINAS_POR_PARTE, TIPOS_PONTO, dividirEmPartes, quantidadePontos, trechoNaPagina } from "@/lib/materiais/pontos-chave";

const TIPOS_SECAO = ["teoria", "resumo"];

export interface ParteGeracao {
  secaoId: string;
  materialId: string;
  material: string;
  secao: string;
  inicio: number;
  fim: number;
}

export interface PlanoPontos {
  partes: ParteGeracao[];
  paginas: number;
  custoEstimadoUsd: number | null;
  jaGeradas: number;
}

/**
 * Faixas de páginas ainda sem pontos-chave, de um material ou de todos os
 * materiais de uma disciplina, e o custo estimado da geração.
 */
export async function planejarPontos(supabase: SupabaseClient, userId: string, escopo: { materialId?: string; disciplinaId?: string }, refazer: boolean): Promise<PlanoPontos> {
  let mats = supabase.from("materiais").select("id, titulo").eq("user_id", userId).eq("status", "processado");
  if (escopo.materialId) mats = mats.eq("id", escopo.materialId);
  else if (escopo.disciplinaId) mats = mats.eq("disciplina_id", escopo.disciplinaId);
  else throw new ErroApp("Escolha um material ou uma disciplina.");
  const { data: materiais, error } = await mats.order("aula_numero", { nullsFirst: false }).order("titulo");
  if (error) throw error;
  if (!materiais?.length) return { partes: [], paginas: 0, custoEstimadoUsd: 0, jaGeradas: 0 };
  const titulo = new Map(materiais.map((m) => [m.id, m.titulo]));

  const { data: secoes, error: e2 } = await supabase.from("material_secoes")
    .select("id, material_id, titulo, ordem, pagina_inicio, pagina_fim, pontos_paginas_processadas")
    .in("material_id", materiais.map((m) => m.id)).in("tipo", TIPOS_SECAO).order("ordem");
  if (e2) throw e2;

  const ordemMaterial = new Map(materiais.map((m, i) => [m.id, i]));
  const partes: ParteGeracao[] = [];
  let jaGeradas = 0;
  for (const s of [...(secoes ?? [])].sort((a, b) => ordemMaterial.get(a.material_id)! - ordemMaterial.get(b.material_id)! || a.ordem - b.ordem)) {
    const feitas = new Set((s.pontos_paginas_processadas as number[]) ?? []);
    for (const [inicio, fim] of dividirEmPartes(s.pagina_inicio, s.pagina_fim)) {
      if (!refazer && feitas.has(inicio)) { jaGeradas++; continue; }
      partes.push({ secaoId: s.id, materialId: s.material_id, material: titulo.get(s.material_id) ?? "", secao: s.titulo, inicio, fim });
    }
  }
  const paginas = partes.reduce((t, p) => t + p.fim - p.inicio + 1, 0);

  // Estimativa: ~2.600 caracteres por página (≈ 4 caracteres por token) mais
  // ~2.500 tokens de saída e raciocínio por parte.
  const provedor = obterProvedor();
  let custo: number | null = null;
  if (provedor) {
    const env = envServidor();
    const p = precosDoModelo(provedor.modelo, env.IA_PRECO_ENTRADA_POR_MTOK, env.IA_PRECO_SAIDA_POR_MTOK);
    if (p.entrada > 0) custo = Math.round(((paginas * 650 + partes.length * 1500) * p.entrada + partes.length * 2500 * p.saida) / 1_000_000 * 100) / 100;
  }
  return { partes, paginas, custoEstimadoUsd: custo, jaGeradas };
}

const SISTEMA = `Você é um professor experiente de cursos preparatórios para concursos públicos brasileiros.
Sua tarefa: ler o trecho de material de estudo e apontar os pontos MAIS IMPORTANTES para a prova.

Regras:
1. Use somente o conteúdo das páginas fornecidas. Não acrescente informação externa, artigos ou julgados que não estejam no texto.
2. Priorize o que mais cai em prova: definições centrais, letra da lei, entendimentos dos tribunais, exceções e "pegadinhas", prazos, números, competências e classificações.
3. Para cada ponto informe:
   - "titulo": frase curta e objetiva (até 12 palavras).
   - "explicacao": 1 a 3 frases, em suas palavras, explicando o que o aluno deve saber.
   - "pagina": o número da página (atributo numero de <pagina>) onde o ponto aparece.
   - "trecho_literal": uma frase ou parte de frase COPIADA EXATAMENTE do texto daquela página (entre 40 e 250 caracteres), que sustenta o ponto. Não resuma nem altere palavras.
   - "tipo": conceito, lei, jurisprudencia, pegadinha, prazo_numero, classificacao ou exemplo.
   - "importancia": 3 = essencial (cobrado com frequência), 2 = importante, 1 = complementar.
4. Não repita o mesmo ponto. Ignore sumário, apresentação do professor, propaganda e listas de questões.
5. Se as páginas não tiverem conteúdo teórico relevante, devolva a lista vazia.`;

const esquema = z.object({
  pontos: z.array(z.object({
    titulo: z.string(),
    explicacao: z.string(),
    pagina: z.number(),
    trecho_literal: z.string(),
    tipo: z.enum(TIPOS_PONTO),
    importancia: z.number(),
  })),
});

/** Gera e grava os pontos-chave de uma faixa de páginas de uma seção. */
export async function gerarPontosParte(supabase: SupabaseClient, userId: string, secaoId: string, inicio: number, fim: number) {
  const { data: secao } = await supabase.from("material_secoes")
    .select("id, titulo, tipo, pagina_inicio, pagina_fim, pontos_paginas_processadas, material_id, assuntos(nome), materiais!inner(id, titulo, user_id, data_material, disciplinas(nome))")
    .eq("id", secaoId).maybeSingle();
  const material = secao?.materiais as unknown as { id: string; titulo: string; user_id: string; data_material: string | null; disciplinas: { nome: string } | null } | undefined;
  if (!secao || !material || material.user_id !== userId) throw new ErroApp("Seção não encontrada.");
  if (!TIPOS_SECAO.includes(secao.tipo)) throw new ErroApp("Pontos-chave são gerados só para seções de teoria e resumo.");
  if (inicio < secao.pagina_inicio || fim > secao.pagina_fim || fim < inicio || fim - inicio + 1 > PAGINAS_POR_PARTE) throw new ErroApp("Faixa de páginas inválida.");

  const { data: paginas, error } = await supabase.from("material_paginas").select("numero, texto")
    .eq("material_id", material.id).gte("numero", inicio).lte("numero", fim).order("numero");
  if (error) throw error;
  const comTexto = (paginas ?? []).filter((p) => (p.texto ?? "").trim().length >= 80);

  const marcarProcessada = async () => {
    const feitas = new Set((secao.pontos_paginas_processadas as number[]) ?? []);
    feitas.add(inicio);
    await supabase.from("material_secoes").update({ pontos_paginas_processadas: [...feitas].sort((a, b) => a - b) }).eq("id", secao.id);
  };

  if (comTexto.reduce((t, p) => t + p.texto.length, 0) < 300) {
    await marcarProcessada();
    return { criados: 0, custoUsd: 0 };
  }

  const n = quantidadePontos(comTexto.length);
  const { resultado, processamentoId, custoUsd } = await executarComIA(userId, "pontos_chave", { material_id: material.id, secao_id: secao.id, inicio, fim },
    async (provedor, registrarUso) => {
      const r = await provedor.gerarEstruturado({
        sistema: SISTEMA, nomeEsquema: "pontos_chave", esquema, esforco: "low", maxTokens: 6000,
        mensagens: [{ papel: "user", conteudo: `Aponte até ${n} pontos mais importantes das páginas ${inicio} a ${fim} (seção "${secao.titulo}").\n\n${blocoMaterial({
          tituloMaterial: material.titulo, disciplina: material.disciplinas?.nome ?? "", assunto: (secao.assuntos as unknown as { nome: string } | null)?.nome ?? null,
          dataMaterial: material.data_material, paginas: comTexto,
        })}` }],
      });
      registrarUso(r.uso, r.modelo);
      return r.dados.pontos;
    }, { resumoResultado: (p) => ({ pontos: p.length }) });

  const textoPorPagina = new Map(comTexto.map((p) => [p.numero, p.texto as string]));
  const vistos = new Set<string>();
  const linhas = resultado
    .filter((p) => p.titulo.trim() && p.explicacao.trim())
    .map((p, i) => {
      const pagina = textoPorPagina.has(Math.round(p.pagina)) ? Math.round(p.pagina) : comTexto[0].numero;
      const trecho = p.trecho_literal.trim();
      return {
        user_id: userId, material_id: material.id, secao_id: secao.id, pagina, ordem: inicio * 100 + i, tipo: p.tipo,
        importancia: Math.min(3, Math.max(1, Math.round(p.importancia))),
        titulo: p.titulo.trim().slice(0, 200), explicacao: p.explicacao.trim().slice(0, 2000),
        // Só guarda o trecho se ele existir de fato na página (é o que será realçado no PDF).
        trecho: trecho && trechoNaPagina(trecho, textoPorPagina.get(pagina) ?? "") ? trecho.slice(0, 600) : null,
        processamento_id: processamentoId,
      };
    })
    .filter((l) => {
      const chave = l.titulo.toLowerCase();
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .slice(0, n);

  // Refazer: substitui os pontos anteriores desta faixa.
  const { error: e1 } = await supabase.from("material_pontos_chave").delete().eq("secao_id", secao.id).gte("pagina", inicio).lte("pagina", fim);
  if (e1) throw e1;
  if (linhas.length) {
    const { error: e2 } = await supabase.from("material_pontos_chave").insert(linhas);
    if (e2) throw e2;
  }
  await marcarProcessada();
  return { criados: linhas.length, custoUsd };
}
