import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executarComIA } from "@/lib/ia";
import { ErroApp } from "@/lib/erros";
import { esquemaLoteIA, esquemaVerificacao, type QuestaoIA } from "./esquemas";
import { SISTEMA_GERACAO, SISTEMA_VERIFICACAO, mensagemGeracao, mensagemVerificacao } from "./prompts";
import {
  decidir, detectarCopia, sinalDesatualizacao, similaridadeEnunciados, validarEstrutura, verificarDuplicidade,
  verificarReferencia, LIMITE_DUPLICADA, type Problema,
} from "./validacao";
import { garantirSubassunto, novoCacheAssuntos } from "@/lib/servidor/taxonomia";

export interface FiltroContexto {
  disciplinaId?: string | null;
  assuntoId?: string | null;
  materialId?: string | null;
  secaoId?: string | null;
}

export interface ParametrosGeracao extends FiltroContexto {
  quantidade: number;
  tipos: ("multipla_escolha" | "certo_errado")[];
  dificuldades: ("facil" | "medio" | "dificil")[];
  estilos: ("conceitual" | "interpretacao" | "aplicacao" | "situacao_hipotetica" | "analise_juridica")[];
  bancaEstiloId?: string | null;
  verificarComIA: boolean;
}

export interface ContextoGeracao {
  material: { id: string; titulo: string; dataMaterial: string | null; disciplinaId: string };
  disciplinaNome: string;
  assunto: { id: string; nome: string } | null;
  subassuntoId: string | null;
  secaoId: string;
  paginas: { numero: number; texto: string }[];
}

const MAX_CARACTERES_CONTEXTO = 14_000;
const MAX_PAGINAS_CONTEXTO = 8;
const TIPOS_CONTEUDO = ["teoria", "resumo"];

/**
 * Escolhe um trecho de teoria para gerar questões: entre as seções que casam
 * com o filtro, a menos explorada (menos páginas já usadas como fonte), e
 * dentro dela as páginas ainda não usadas. Seções de questões comentadas e
 * listas de questões nunca entram (conteúdo protegido de bancas/cursos).
 */
export async function selecionarContexto(supabase: SupabaseClient, userId: string, filtro: FiltroContexto): Promise<ContextoGeracao> {
  let consulta = supabase
    .from("material_secoes")
    .select("id, material_id, pagina_inicio, pagina_fim, assunto_id, subassunto_id, assuntos(id, nome), materiais!inner(id, titulo, data_material, disciplina_id, status, disciplinas(nome))")
    .eq("user_id", userId)
    .in("tipo", TIPOS_CONTEUDO)
    .eq("materiais.status", "processado")
    .limit(800);
  if (filtro.secaoId) consulta = consulta.eq("id", filtro.secaoId);
  if (filtro.materialId) consulta = consulta.eq("material_id", filtro.materialId);
  if (filtro.assuntoId) consulta = consulta.eq("assunto_id", filtro.assuntoId);
  if (filtro.disciplinaId) consulta = consulta.eq("materiais.disciplina_id", filtro.disciplinaId);
  const { data: secoes, error } = await consulta;
  if (error) throw error;

  type Secao = {
    id: string; material_id: string; pagina_inicio: number; pagina_fim: number; assunto_id: string | null; subassunto_id: string | null;
    assuntos: { id: string; nome: string } | null;
    materiais: { id: string; titulo: string; data_material: string | null; disciplina_id: string | null; disciplinas: { nome: string } | null };
  };
  const candidatas = ((secoes ?? []) as unknown as Secao[]).filter((s) => s.materiais.disciplina_id);
  if (candidatas.length === 0) {
    throw new ErroApp("Não há conteúdo de teoria processado para esse filtro. Importe ou classifique o material primeiro.");
  }

  const materiais = [...new Set(candidatas.map((s) => s.material_id))];
  const { data: fontes } = await supabase
    .from("questao_fontes").select("material_id, pagina, questoes!inner(owner_id)")
    .in("material_id", materiais).eq("questoes.owner_id", userId).limit(10000);
  const usadas = new Map<string, number>();
  for (const f of (fontes ?? []) as { material_id: string; pagina: number | null }[]) {
    if (f.pagina) usadas.set(`${f.material_id}:${f.pagina}`, (usadas.get(`${f.material_id}:${f.pagina}`) ?? 0) + 1);
  }
  const usoSecao = (s: Secao) => {
    let n = 0;
    for (let p = s.pagina_inicio; p <= s.pagina_fim; p++) n += usadas.get(`${s.material_id}:${p}`) ?? 0;
    return n / (s.pagina_fim - s.pagina_inicio + 1);
  };
  const menorUso = Math.min(...candidatas.map(usoSecao));
  const empatadas = candidatas.filter((s) => usoSecao(s) <= menorUso + 0.05);
  const secao = empatadas[Math.floor(Math.random() * empatadas.length)];

  const fimBusca = Math.min(secao.pagina_fim, secao.pagina_inicio + 59);
  const { data: paginas, error: erroPaginas } = await supabase
    .from("material_paginas").select("numero, texto")
    .eq("material_id", secao.material_id).gte("numero", secao.pagina_inicio).lte("numero", fimBusca).order("numero");
  if (erroPaginas) throw erroPaginas;
  const comTexto = (paginas ?? []).filter((p) => p.texto.trim().length >= 200);
  if (comTexto.length === 0) throw new ErroApp("As páginas desse trecho não têm texto suficiente (o PDF pode precisar de OCR).");

  // Começa pela página menos usada e segue em sequência (dando a volta na seção).
  let inicio = 0;
  for (let i = 1; i < comTexto.length; i++) {
    if ((usadas.get(`${secao.material_id}:${comTexto[i].numero}`) ?? 0) < (usadas.get(`${secao.material_id}:${comTexto[inicio].numero}`) ?? 0)) inicio = i;
  }
  const escolhidas: { numero: number; texto: string }[] = [];
  let total = 0;
  for (let k = 0; k < comTexto.length && escolhidas.length < MAX_PAGINAS_CONTEXTO; k++) {
    const p = comTexto[(inicio + k) % comTexto.length];
    if (total + p.texto.length > MAX_CARACTERES_CONTEXTO && escolhidas.length > 0) break;
    escolhidas.push({ numero: p.numero, texto: p.texto });
    total += p.texto.length;
  }
  escolhidas.sort((a, b) => a.numero - b.numero);

  return {
    material: { id: secao.materiais.id, titulo: secao.materiais.titulo, dataMaterial: secao.materiais.data_material, disciplinaId: secao.materiais.disciplina_id! },
    disciplinaNome: secao.materiais.disciplinas?.nome ?? "Disciplina",
    assunto: secao.assuntos ? { id: secao.assuntos.id, nome: secao.assuntos.nome } : null,
    subassuntoId: secao.subassunto_id,
    secaoId: secao.id,
    paginas: escolhidas,
  };
}

export interface ResultadoGeracao {
  criadas: { id: string; status: "aprovada" | "pendente_revisao"; enunciado: string; alertas: string[] }[];
  descartadas: { enunciado: string; motivos: string[] }[];
  observacoes: string;
  fonte: { materialId: string; titulo: string; paginas: number[]; assunto: string | null };
  custoUsd: number;
  processamentoId: string;
}

/** Limite diário configurado pelo usuário (preferências). */
async function conferirLimiteDiario(supabase: SupabaseClient, userId: string, quantidade: number) {
  const { data: pref } = await supabase.from("preferencias_usuario").select("limite_questoes_ia_dia").eq("user_id", userId).maybeSingle();
  const limite = pref?.limite_questoes_ia_dia ?? 50;
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase.from("questoes").select("id", { count: "exact", head: true })
    .eq("owner_id", userId).eq("origem", "ia").gte("created_at", desde);
  if ((count ?? 0) + quantidade > limite) {
    throw new ErroApp(`Limite diário de ${limite} questões geradas por IA atingido (ajuste em Configurações).`);
  }
}

export async function gerarQuestoes(supabase: SupabaseClient, userId: string, p: ParametrosGeracao): Promise<ResultadoGeracao> {
  if (p.quantidade < 1 || p.quantidade > 6) throw new ErroApp("Gere de 1 a 6 questões por vez.");
  await conferirLimiteDiario(supabase, userId, p.quantidade);
  const ctx = await selecionarContexto(supabase, userId, p);

  const [{ data: existentes }, { data: banca }] = await Promise.all([
    supabase.from("questoes").select("enunciado").eq("owner_id", userId).neq("status", "arquivada")
      .eq(ctx.assunto ? "assunto_id" : "disciplina_id", ctx.assunto ? ctx.assunto.id : ctx.material.disciplinaId)
      .order("created_at", { ascending: false }).limit(300),
    p.bancaEstiloId ? supabase.from("bancas").select("id, sigla, descricao_estilo").eq("id", p.bancaEstiloId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const enunciadosExistentes = (existentes ?? []).map((e) => e.enunciado as string);

  const base = {
    disciplina: ctx.disciplinaNome, assunto: ctx.assunto?.nome ?? null, tituloMaterial: ctx.material.titulo,
    dataMaterial: ctx.material.dataMaterial, paginas: ctx.paginas,
  };

  const { resultado, processamentoId, custoUsd } = await executarComIA(
    userId, "gerar_questoes",
    { quantidade: p.quantidade, tipos: p.tipos, dificuldades: p.dificuldades, material_id: ctx.material.id, paginas: ctx.paginas.map((x) => x.numero), verificar: p.verificarComIA },
    async (provedor, registrarUso) => {
      const geracao = await provedor.gerarEstruturado({
        sistema: SISTEMA_GERACAO,
        nomeEsquema: "lote_questoes",
        esquema: esquemaLoteIA,
        esforco: "medium",
        maxTokens: 24000,
        mensagens: [{
          papel: "user",
          conteudo: mensagemGeracao({
            ...base, quantidade: p.quantidade, tipos: p.tipos, dificuldades: p.dificuldades, estilos: p.estilos,
            banca: banca ? { sigla: banca.sigla, descricao: banca.descricao_estilo } : null,
            enunciadosExistentes: enunciadosExistentes.slice(0, 40),
          }),
        }],
      });
      registrarUso(geracao.uso, geracao.modelo);
      const lote = geracao.dados.questoes.slice(0, p.quantidade);

      let verificacao: Map<number, { letra: string; suportada: boolean; ambigua: boolean; problemas: string[] }> | null = null;
      if (p.verificarComIA && lote.length > 0) {
        const rev = await provedor.gerarEstruturado({
          sistema: SISTEMA_VERIFICACAO,
          nomeEsquema: "verificacao_questoes",
          esquema: esquemaVerificacao,
          esforco: "medium",
          maxTokens: 12000,
          mensagens: [{ papel: "user", conteudo: mensagemVerificacao(base, lote) }],
        });
        registrarUso(rev.uso, rev.modelo);
        verificacao = new Map(rev.dados.avaliacoes.map((a) => [a.indice, { letra: a.letra_escolhida, suportada: a.suportada_pelo_material, ambigua: a.ambigua, problemas: a.problemas }]));
      }
      return { lote, observacoes: geracao.dados.observacoes, verificacao };
    },
    { resumoResultado: (r) => ({ geradas: r.lote.length, observacoes: r.observacoes }) },
  );

  const mapaPaginas = new Map(ctx.paginas.map((x) => [x.numero, x.texto]));
  const textos = ctx.paginas.map((x) => x.texto);
  const aceitasNoLote: string[] = [];
  const criadas: ResultadoGeracao["criadas"] = [];
  const descartadas: ResultadoGeracao["descartadas"] = [];
  const cache = novoCacheAssuntos();

  for (let i = 0; i < resultado.lote.length; i++) {
    const q: QuestaoIA = resultado.lote[i];
    const problemas: Problema[] = [
      ...validarEstrutura(q),
      ...verificarReferencia(q, mapaPaginas),
      ...detectarCopia(q, textos),
      ...verificarDuplicidade(q, enunciadosExistentes),
      ...sinalDesatualizacao(q, ctx.material.dataMaterial),
    ];
    if (aceitasNoLote.some((e) => similaridadeEnunciados(e, q.enunciado) >= LIMITE_DUPLICADA)) {
      problemas.push({ verificador: "duplicidade", gravidade: "bloqueante", mensagem: "Repete outra questão do mesmo lote." });
    }
    const rev = resultado.verificacao?.get(i);
    const correta = q.alternativas.find((a) => a.correta)?.letra;
    if (resultado.verificacao && !rev) problemas.push({ verificador: "ia", gravidade: "alerta", mensagem: "O revisor não avaliou esta questão." });
    if (rev) {
      if (rev.letra !== correta) problemas.push({ verificador: "ia", gravidade: "alerta", mensagem: `Revisor independente marcou ${rev.letra}; gabarito informado é ${correta}. Possível gabarito incorreto.` });
      if (rev.ambigua) problemas.push({ verificador: "ia", gravidade: "alerta", mensagem: "Revisor considerou a questão ambígua." });
      if (!rev.suportada) problemas.push({ verificador: "ia", gravidade: "alerta", mensagem: "Revisor não encontrou base suficiente no material." });
      for (const pr of rev.problemas.slice(0, 3)) problemas.push({ verificador: "ia", gravidade: "alerta", mensagem: pr.slice(0, 300) });
    }

    const decisao = decidir(problemas);
    if (decisao === "descartada") {
      descartadas.push({ enunciado: q.enunciado.slice(0, 300), motivos: problemas.filter((x) => x.gravidade === "bloqueante").map((x) => x.mensagem) });
      continue;
    }

    let subassuntoId = ctx.subassuntoId;
    if (!subassuntoId && q.subassunto && ctx.assunto) {
      subassuntoId = await garantirSubassunto(supabase, userId, ctx.assunto.id, q.subassunto.slice(0, 200), cache).catch(() => null);
    }

    const { data: id, error } = await supabase.rpc("salvar_questao", {
      p_dados: {
        tipo: q.tipo, estilo: q.estilo, enunciado: q.enunciado.trim(), texto_apoio: q.texto_apoio?.trim() || null,
        dificuldade: q.dificuldade, disciplina_id: ctx.material.disciplinaId, assunto_id: ctx.assunto?.id ?? null,
        subassunto_id: subassuntoId, banca_estilo_id: p.bancaEstiloId ?? null, origem: "ia", status: decisao,
        possivelmente_desatualizada: problemas.some((x) => x.verificador === "atualizacao"),
        processamento_ia_id: processamentoId, explicacao: q.explicacao.trim(),
        alternativas: q.alternativas.map((a) => ({ letra: a.letra, texto: a.texto.trim(), correta: a.correta, justificativa: a.justificativa.trim() })),
        fontes: [{ tipo: "material", material_id: ctx.material.id, pagina: q.pagina_referencia, secao_id: ctx.secaoId, trecho: q.trecho_apoio.slice(0, 600) }],
      },
    });
    if (error) {
      descartadas.push({ enunciado: q.enunciado.slice(0, 300), motivos: [error.code === "23505" ? "Duplicada de questão existente." : error.message] });
      continue;
    }
    aceitasNoLote.push(q.enunciado);

    // Auditoria: um registro por verificador (cópia e atualização entram como estruturais).
    const verificadores = ["estrutural", "referencia", "duplicidade", ...(resultado.verificacao ? ["ia"] : [])];
    const registros = verificadores.map((v) => {
      const lista = problemas.filter((x) => x.verificador === v || (v === "estrutural" && (x.verificador === "copia" || x.verificador === "atualizacao")));
      return { questao_id: id, verificador: v, resultado: lista.length ? "alerta" : "aprovada", problemas: lista.map((x) => x.mensagem) };
    });
    await supabase.from("questao_validacoes").insert(registros);

    criadas.push({
      id: id as string, status: decisao, enunciado: q.enunciado.slice(0, 200),
      alertas: problemas.filter((x) => x.gravidade === "alerta").map((x) => x.mensagem),
    });
  }

  return {
    criadas, descartadas, observacoes: resultado.observacoes,
    fonte: { materialId: ctx.material.id, titulo: ctx.material.titulo, paginas: ctx.paginas.map((x) => x.numero), assunto: ctx.assunto?.nome ?? null },
    custoUsd, processamentoId,
  };
}
