"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import type { CorrecaoExibicao } from "@/lib/questoes/exibicao";
import { esquemaArquivoImportacao } from "@/lib/questoes/esquemas";
import { garantirAssunto, garantirDisciplina, garantirSubassunto, novoCacheAssuntos, vincularDisciplinaAoUsuario } from "@/lib/servidor/taxonomia";

const uuid = z.string().uuid();

export interface RespostaCorrigida extends CorrecaoExibicao {
  correta: boolean;
  tentativa_numero: number;
  repetida: boolean;
}

export async function responderQuestao(entrada: { questaoId: string; alternativaId: string; tempoSeg: number; sessaoId?: string | null; chave: string; contexto?: "pratica" | "revisao" | "diagnostico" }) {
  return executarAcao("questoes.responder", async () => {
    await exigirUsuario();
    const d = z.object({
      questaoId: uuid, alternativaId: uuid, tempoSeg: z.number().int().min(0).max(86400), sessaoId: uuid.nullable().optional(),
      chave: uuid, contexto: z.enum(["pratica", "revisao", "diagnostico"]).optional(),
    }).parse(entrada);
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("responder_questao", {
      p_questao_id: d.questaoId, p_alternativa_id: d.alternativaId, p_tempo_seg: d.tempoSeg,
      p_sessao_id: d.sessaoId ?? null, p_contexto: d.contexto ?? "pratica", p_chave: d.chave,
    });
    if (error) throw error;
    return data as RespostaCorrigida;
  });
}

export async function obterCorrecao(questaoId: string) {
  return executarAcao("questoes.correcao", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("obter_correcao_questao", { p_questao_id: uuid.parse(questaoId) });
    if (error) throw error;
    return data as CorrecaoExibicao;
  });
}

export async function alternarFavoritoQuestao(questaoId: string, favorita: boolean) {
  return executarAcao("questoes.favorito", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const id = uuid.parse(questaoId);
    const r = favorita
      ? await supabase.from("favoritos").upsert({ user_id: usuario.id, questao_id: id }, { onConflict: "user_id,questao_id", ignoreDuplicates: true })
      : await supabase.from("favoritos").delete().eq("user_id", usuario.id).eq("questao_id", id);
    if (r.error) throw r.error;
    return null;
  });
}

export async function salvarMarcacao(entrada: { questaoId: string; marcadaRevisao?: boolean; duvida?: string }) {
  return executarAcao("questoes.marcacao", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ questaoId: uuid, marcadaRevisao: z.boolean().optional(), duvida: z.string().max(4000).optional() }).parse(entrada);
    const supabase = await clienteServidor();
    const { data: atual } = await supabase.from("questao_marcacoes").select("marcada_revisao, duvida").eq("user_id", usuario.id).eq("questao_id", d.questaoId).maybeSingle();
    const { error } = await supabase.from("questao_marcacoes").upsert({
      user_id: usuario.id, questao_id: d.questaoId,
      marcada_revisao: d.marcadaRevisao ?? atual?.marcada_revisao ?? false,
      duvida: d.duvida !== undefined ? d.duvida || null : atual?.duvida ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,questao_id" });
    if (error) throw error;
    return null;
  });
}

export async function definirStatusQuestao(questaoId: string, status: "aprovada" | "rejeitada" | "arquivada" | "pendente_revisao", motivo?: string) {
  return executarAcao("questoes.status", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.rpc("definir_status_questao", { p_questao_id: uuid.parse(questaoId), p_status: status, p_motivo: motivo ?? null });
    if (error) throw error;
    revalidatePath("/questoes");
    return null;
  });
}

export async function obterGabaritoRevisao(questaoId: string) {
  return executarAcao("questoes.gabarito_revisao", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("obter_gabarito_revisao", { p_questao_id: uuid.parse(questaoId) });
    if (error) throw error;
    return data as { alternativa_correta_id: string; explicacao: string; justificativas: Record<string, string> };
  });
}

const esquemaManual = z.object({
  id: uuid.optional(),
  tipo: z.enum(["multipla_escolha", "certo_errado"]),
  estilo: z.enum(["conceitual", "interpretacao", "aplicacao", "situacao_hipotetica", "analise_juridica"]),
  enunciado: z.string().trim().min(10, "Enunciado curto demais").max(8000),
  textoApoio: z.string().max(12000).optional(),
  dificuldade: z.enum(["facil", "medio", "dificil"]),
  disciplinaId: uuid,
  assunto: z.string().trim().max(200).optional(),
  subassunto: z.string().trim().max(240).optional(),
  bancaEstiloId: uuid.optional().or(z.literal("")),
  alternativas: z.array(z.object({ letra: z.string(), texto: z.string().trim().min(1, "Alternativa vazia").max(3000), correta: z.boolean(), justificativa: z.string().max(3000).optional() })).min(2).max(5),
  explicacao: z.string().trim().min(5, "Escreva a explicação").max(12000),
  materialId: uuid.optional().or(z.literal("")),
  pagina: z.number().int().min(1).optional(),
  status: z.enum(["rascunho", "pendente_revisao", "aprovada"]),
});

export async function salvarQuestaoManual(entrada: z.input<typeof esquemaManual>) {
  return executarAcao("questoes.manual", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaManual.parse(entrada);
    const supabase = await clienteServidor();
    const cache = novoCacheAssuntos();
    const assuntoId = d.assunto ? await garantirAssunto(supabase, usuario.id, d.disciplinaId, d.assunto, cache) : null;
    const subassuntoId = assuntoId && d.subassunto ? await garantirSubassunto(supabase, usuario.id, assuntoId, d.subassunto, cache) : null;
    const { data, error } = await supabase.rpc("salvar_questao", {
      p_dados: {
        id: d.id, tipo: d.tipo, estilo: d.estilo, enunciado: d.enunciado, texto_apoio: d.textoApoio || null, dificuldade: d.dificuldade,
        disciplina_id: d.disciplinaId, assunto_id: assuntoId, subassunto_id: subassuntoId, banca_estilo_id: d.bancaEstiloId || null,
        origem: "manual", status: d.status, explicacao: d.explicacao,
        alternativas: d.alternativas.map((a) => ({ ...a, letra: a.letra.toUpperCase() })),
        fontes: d.materialId ? [{ tipo: "material", material_id: d.materialId, pagina: d.pagina ?? null }] : [],
      },
    });
    if (error) throw error;
    revalidatePath("/questoes");
    return { id: data as string };
  });
}

/**
 * Importa base de questões licenciada (JSON). O usuário declara a licença;
 * as questões ficam privadas na conta dele e marcadas como "base licenciada".
 */
export async function importarBaseLicenciada(conteudoJson: string) {
  return executarAcao("questoes.importar", async () => {
    const usuario = await exigirUsuario();
    if (conteudoJson.length > 15_000_000) throw new ErroApp("Arquivo grande demais (máx. 15 MB).");
    let bruto: unknown;
    try {
      bruto = JSON.parse(conteudoJson);
    } catch {
      throw new ErroApp("O arquivo não é um JSON válido.");
    }
    const arquivo = esquemaArquivoImportacao.parse(bruto);
    const supabase = await clienteServidor();
    const { data: bancas } = await supabase.from("bancas").select("id, sigla");
    const porSigla = new Map((bancas ?? []).map((b) => [b.sigla.toLowerCase(), b.id as string]));
    const cache = novoCacheAssuntos();
    const disciplinas = new Map<string, string>();
    const resultado = { importadas: 0, duplicadas: 0, erros: [] as { indice: number; erro: string }[] };

    for (let i = 0; i < arquivo.questoes.length; i++) {
      const q = arquivo.questoes[i];
      try {
        let disciplinaId = disciplinas.get(q.disciplina);
        if (!disciplinaId) {
          disciplinaId = await garantirDisciplina(supabase, usuario.id, q.disciplina);
          await vincularDisciplinaAoUsuario(supabase, usuario.id, disciplinaId);
          disciplinas.set(q.disciplina, disciplinaId);
        }
        const assuntoId = q.assunto ? await garantirAssunto(supabase, usuario.id, disciplinaId, q.assunto, cache) : null;
        const subassuntoId = assuntoId && q.subassunto ? await garantirSubassunto(supabase, usuario.id, assuntoId, q.subassunto, cache) : null;
        const bancaId = q.banca ? porSigla.get(q.banca.toLowerCase()) ?? null : null;
        const { error } = await supabase.rpc("salvar_questao", {
          p_dados: {
            tipo: q.tipo, estilo: q.estilo, enunciado: q.enunciado, texto_apoio: q.texto_apoio ?? null, dificuldade: q.dificuldade,
            disciplina_id: disciplinaId, assunto_id: assuntoId, subassunto_id: subassuntoId,
            banca_oficial_id: bancaId, ano: q.ano ?? null, cargo: q.cargo ?? null,
            origem: "importada_licenciada", licenca: arquivo.licenca, status: "pendente_revisao", explicacao: q.explicacao,
            alternativas: q.alternativas.map((a) => ({ ...a, letra: a.letra.toUpperCase() })),
          },
        });
        if (error) {
          if (error.code === "23505") resultado.duplicadas++;
          else resultado.erros.push({ indice: i, erro: error.message });
        } else resultado.importadas++;
      } catch (e) {
        resultado.erros.push({ indice: i, erro: e instanceof Error ? e.message : "erro" });
      }
    }
    revalidatePath("/questoes");
    return resultado;
  });
}

const esquemaSessao = z.object({
  nome: z.string().max(120).optional(),
  modo: z.enum(["pratica", "revisao_erros", "diagnostico"]).default("pratica"),
  quantidade: z.number().int().min(1).max(200),
  filtros: z.record(z.string(), z.unknown()),
  ordem: z.enum(["aleatoria", "recentes"]).default("aleatoria"),
});

/** Cria uma sessão de prática com as questões que atendem aos filtros. */
export async function criarSessaoQuestoes(entrada: z.input<typeof esquemaSessao>) {
  return executarAcao("questoes.sessao", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaSessao.parse(entrada);
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc("listar_questoes", { p_filtros: { ...d.filtros, status: ["aprovada"] }, p_limite: 200, p_offset: 0 });
    if (error) throw error;
    let ids = ((data as { itens: { id: string }[] }).itens ?? []).map((i) => i.id);
    if (ids.length === 0) throw new ErroApp("Nenhuma questão aprovada atende a esses filtros.");
    if (d.ordem === "aleatoria") {
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    ids = ids.slice(0, d.quantidade);
    const { data: sessao, error: e2 } = await supabase.from("sessoes_questoes").insert({
      user_id: usuario.id, nome: d.nome || "Sessão de questões", modo: d.modo, filtros: d.filtros, questao_ids: ids,
    }).select("id").single();
    if (e2) throw e2;
    return { sessaoId: sessao.id as string, total: ids.length };
  });
}

export async function atualizarSessao(entrada: { sessaoId: string; posicao: number; status?: "em_andamento" | "concluida" | "abandonada" }) {
  return executarAcao("questoes.sessao.atualizar", async () => {
    await exigirUsuario();
    const d = z.object({ sessaoId: uuid, posicao: z.number().int().min(0), status: z.enum(["em_andamento", "concluida", "abandonada"]).optional() }).parse(entrada);
    const supabase = await clienteServidor();
    const { error } = await supabase.from("sessoes_questoes").update({
      posicao: d.posicao, ...(d.status ? { status: d.status, finalizada_em: d.status !== "em_andamento" ? new Date().toISOString() : null } : {}),
    }).eq("id", d.sessaoId);
    if (error) throw error;
    return null;
  });
}

/** Registra o tempo de uma sessão de questões como sessão de estudo. */
export async function registrarTempoQuestoes(entrada: { inicio: string; fim: string; disciplinaId?: string | null }) {
  return executarAcao("questoes.tempo", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ inicio: z.string().datetime(), fim: z.string().datetime(), disciplinaId: uuid.nullable().optional() }).parse(entrada);
    const inicio = new Date(d.inicio);
    const fim = new Date(Math.min(new Date(d.fim).getTime(), Date.now(), inicio.getTime() + 16 * 3600_000));
    if (fim.getTime() - inicio.getTime() < 60_000) return null;
    const supabase = await clienteServidor();
    await supabase.from("sessoes_estudo").insert({ user_id: usuario.id, tipo: "questoes", origem: "questoes", disciplina_id: d.disciplinaId ?? null, inicio: inicio.toISOString(), fim: fim.toISOString() });
    return null;
  });
}
