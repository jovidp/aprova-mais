/**
 * Verificações de qualidade das questões (funções puras).
 * Problemas "bloqueantes" descartam a questão; "alertas" a enviam para revisão.
 */
import type { QuestaoIA } from "./esquemas";
import { chaveNome } from "@/lib/materiais/normalizacao";

export interface Problema {
  verificador: "estrutural" | "referencia" | "duplicidade" | "ia" | "copia" | "atualizacao";
  gravidade: "bloqueante" | "alerta";
  mensagem: string;
}

const LETRAS = ["A", "B", "C", "D", "E"];

function palavras(texto: string) {
  return chaveNome(texto).split(" ").filter(Boolean);
}

export function validarEstrutura(q: QuestaoIA): Problema[] {
  const p: Problema[] = [];
  const add = (mensagem: string, gravidade: Problema["gravidade"] = "bloqueante") => p.push({ verificador: "estrutural", gravidade, mensagem });
  const enunciado = q.enunciado.trim();

  if (enunciado.length < 30) add("Enunciado incompleto ou curto demais.");
  if (enunciado.length > 6000) add("Enunciado longo demais.");
  if (q.explicacao.trim().length < 30) add("Explicação da resposta ausente ou insuficiente.");

  const corretas = q.alternativas.filter((a) => a.correta).length;
  if (corretas !== 1) add(`A questão deve ter exatamente uma alternativa correta (tem ${corretas}).`);

  const letras = q.alternativas.map((a) => a.letra);
  if (q.tipo === "certo_errado") {
    if (letras.join("") !== "CE") add("Certo/errado deve ter as alternativas C (Certo) e E (Errado), nessa ordem.");
    if (/\?\s*$/.test(enunciado)) add("No formato certo/errado o enunciado deve ser uma afirmação, não uma pergunta.");
  } else {
    if (letras.length < 4 || letras.length > 5 || letras.join("") !== LETRAS.slice(0, letras.length).join("")) {
      add("Múltipla escolha deve ter 4 ou 5 alternativas em sequência (A, B, C...).");
    }
  }

  const textos = q.alternativas.map((a) => chaveNome(a.texto));
  if (textos.some((t) => t.length === 0)) add("Alternativa sem texto.");
  if (new Set(textos).size !== textos.length) add("Alternativas repetidas.");
  if (q.tipo === "multipla_escolha") {
    if (textos.some((t) => /^(todas|nenhuma) (as|das) (alternativas|anteriores)|^todas as anteriores|^nenhuma das anteriores/.test(t))) {
      add("Evite \"todas/nenhuma das anteriores\": costuma gerar ambiguidade.", "alerta");
    }
    for (let i = 0; i < textos.length; i++)
      for (let j = 0; j < textos.length; j++)
        if (i !== j && textos[i].length > 15 && textos[j].includes(textos[i])) add("Uma alternativa está contida em outra (possível ambiguidade).", "alerta");
  }
  const erradasSemJustificativa = q.alternativas.filter((a) => !a.correta && a.justificativa.trim().length < 5).length;
  if (erradasSemJustificativa > 0) add("Faltam justificativas para alternativas incorretas.", "alerta");
  return p;
}

/**
 * Confere se o trecho de apoio citado pela IA existe na página indicada.
 * Tolerante a quebras de linha/acentuação: exige que ≥ 85% das palavras do
 * trecho apareçam em sequência aproximada (janela) na página.
 */
export function verificarReferencia(q: QuestaoIA, paginas: Map<number, string>): Problema[] {
  const texto = paginas.get(q.pagina_referencia);
  if (texto === undefined) {
    return [{ verificador: "referencia", gravidade: "bloqueante", mensagem: `Página de referência ${q.pagina_referencia} não pertence ao trecho usado.` }];
  }
  const alvo = palavras(q.trecho_apoio);
  if (alvo.length < 3) return [{ verificador: "referencia", gravidade: "alerta", mensagem: "Trecho de apoio curto demais para conferir." }];
  const pagina = palavras(texto);
  const indice = new Map<string, number[]>();
  pagina.forEach((w, i) => indice.set(w, [...(indice.get(w) ?? []), i]));
  // Melhor alinhamento: a partir de cada ocorrência da primeira palavra rara, conta acertos em ordem.
  let melhor = 0;
  const ancoras = new Set<number>();
  for (const w of alvo.slice(0, 5)) for (const pos of indice.get(w) ?? []) ancoras.add(pos);
  for (const inicio of ancoras) {
    let cursor = Math.max(0, inicio - 5);
    let acertos = 0;
    for (const w of alvo) {
      const limite = cursor + 6;
      let achou = -1;
      for (let k = cursor; k < Math.min(pagina.length, limite); k++) if (pagina[k] === w) { achou = k; break; }
      if (achou >= 0) { acertos++; cursor = achou + 1; }
    }
    melhor = Math.max(melhor, acertos / alvo.length);
  }
  return melhor >= 0.85 ? [] : [{ verificador: "referencia", gravidade: "alerta", mensagem: "O trecho de apoio não foi encontrado literalmente na página indicada." }];
}

/** Maior sequência de palavras idênticas entre a questão e o material (detecção de cópia). */
export function maiorSequenciaComum(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0;
  const posicoes = new Map<string, number[]>();
  b.forEach((w, i) => posicoes.set(w, [...(posicoes.get(w) ?? []), i]));
  let melhor = 0;
  for (let i = 0; i < a.length; i++) {
    for (const j of posicoes.get(a[i]) ?? []) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > melhor) melhor = k;
    }
  }
  return melhor;
}

export const LIMITE_COPIA_PALAVRAS = 25;

export function detectarCopia(q: QuestaoIA, textosMaterial: string[]): Problema[] {
  const questao = palavras([q.enunciado, q.texto_apoio ?? "", ...q.alternativas.map((a) => a.texto)].join(" "));
  const material = palavras(textosMaterial.join(" "));
  const seq = maiorSequenciaComum(questao, material);
  return seq >= LIMITE_COPIA_PALAVRAS
    ? [{ verificador: "copia", gravidade: "bloqueante", mensagem: `Trecho de ${seq} palavras copiado literalmente do material.` }]
    : [];
}

/** Similaridade de Jaccard entre conjuntos de trigramas de palavras. */
export function similaridadeEnunciados(a: string, b: string) {
  const g = (t: string) => {
    const w = palavras(t);
    const s = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) s.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    if (w.length < 3) s.add(w.join(" "));
    return s;
  };
  const A = g(a);
  const B = g(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const LIMITE_DUPLICADA = 0.6;

export function verificarDuplicidade(q: QuestaoIA, existentes: string[]): Problema[] {
  const sim = existentes.reduce((m, e) => Math.max(m, similaridadeEnunciados(q.enunciado, e)), 0);
  return sim >= LIMITE_DUPLICADA
    ? [{ verificador: "duplicidade", gravidade: "bloqueante", mensagem: `Muito parecida com questão já existente (similaridade ${Math.round(sim * 100)}%).` }]
    : [];
}

/** Material antigo + citação de norma específica = possível desatualização. */
export function sinalDesatualizacao(q: QuestaoIA, dataMaterial: string | null, hoje = new Date()): Problema[] {
  const citaNorma = /\b(ec|emenda constitucional|lei|decreto|medida provis[oó]ria|s[uú]mula)\b\s*(n[ºo°.]*\s*)?\d/i.test(`${q.enunciado} ${q.explicacao}`);
  const anos = dataMaterial ? (hoje.getTime() - new Date(dataMaterial).getTime()) / (365.25 * 86400000) : null;
  if (q.depende_de_legislacao_recente || (citaNorma && anos !== null && anos > 1.5)) {
    return [{ verificador: "atualizacao", gravidade: "alerta", mensagem: "Conteúdo normativo que pode ter sido alterado após a data do material; confira a legislação vigente." }];
  }
  return [];
}

export type Decisao = "aprovada" | "pendente_revisao" | "descartada";

/** Atualização é só uma sinalização (não impede aprovação); demais alertas vão para revisão. */
export function decidir(problemas: Problema[]): Decisao {
  if (problemas.some((p) => p.gravidade === "bloqueante")) return "descartada";
  if (problemas.some((p) => p.gravidade === "alerta" && p.verificador !== "atualizacao")) return "pendente_revisao";
  return "aprovada";
}
