/**
 * Pontos-chave dos materiais: regras puras usadas no servidor (geração e
 * validação) e no leitor (realce do trecho na página).
 */

export const TIPOS_PONTO = ["conceito", "lei", "jurisprudencia", "pegadinha", "prazo_numero", "classificacao", "exemplo"] as const;
export type TipoPonto = (typeof TIPOS_PONTO)[number];

export const ROTULO_TIPO_PONTO: Record<TipoPonto, string> = {
  conceito: "Conceito",
  lei: "Letra da lei",
  jurisprudencia: "Jurisprudência",
  pegadinha: "Pegadinha de prova",
  prazo_numero: "Prazo/número",
  classificacao: "Classificação",
  exemplo: "Exemplo",
};

export const ROTULO_IMPORTANCIA: Record<number, string> = { 3: "Essencial", 2: "Importante", 1: "Complementar" };

/** Máximo de páginas enviadas por chamada de IA. */
export const PAGINAS_POR_PARTE = 10;

/** Divide [inicio, fim] em faixas de até `max` páginas. */
export function dividirEmPartes(inicio: number, fim: number, max = PAGINAS_POR_PARTE): [number, number][] {
  const partes: [number, number][] = [];
  if (fim < inicio) return partes;
  const n = Math.ceil((fim - inicio + 1) / max);
  // Faixas de tamanho equilibrado (evita uma última parte de 1 página).
  const tamanho = Math.ceil((fim - inicio + 1) / n);
  for (let a = inicio; a <= fim; a += tamanho) partes.push([a, Math.min(fim, a + tamanho - 1)]);
  return partes;
}

/** Quantos pontos pedir para uma faixa: cerca de 1 a cada 1,5 página, entre 3 e 10. */
export function quantidadePontos(paginas: number) {
  return Math.min(10, Math.max(3, Math.round(paginas / 1.5)));
}

/** Minúsculas, sem acentos, sem hifenização de quebra de linha e com espaços simples. */
export function normalizarTrecho(texto: string) {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\w)-\s+(\w)/g, "$1$2")
    .replace(/[“”"'‘’`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** O trecho informado pela IA existe (literalmente, salvo espaços/acentos) na página? */
export function trechoNaPagina(trecho: string, textoPagina: string) {
  const t = normalizarTrecho(trecho);
  return t.length >= 15 && normalizarTrecho(textoPagina).includes(t);
}

/**
 * Decide se um item da camada de texto do PDF (geralmente uma linha) faz
 * parte de algum trecho destacado da página. Itens curtos demais não são
 * realçados, para evitar falsos positivos ("Art. 5º", números de página).
 */
export function itemFazParteDeTrecho(item: string, trechosNormalizados: string[]) {
  const i = normalizarTrecho(item);
  if (i.length < 12) return false;
  return trechosNormalizados.some((t) => {
    if (t.includes(i) || i.includes(t)) return true;
    // Bordas: a linha começa antes do trecho ou termina depois dele.
    return sobreposicao(i, t) >= 15 || sobreposicao(t, i) >= 15;
  });
}

/** Tamanho do maior sufixo de `a` que é prefixo de `b`. */
function sobreposicao(a: string, b: string) {
  for (let k = Math.min(a.length, b.length); k > 0; k--) if (a.endsWith(b.slice(0, k))) return k;
  return 0;
}
