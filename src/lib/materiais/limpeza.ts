import type { PaginaLinhas } from "./tipos";

/** CPF com ou sem pontuação, seguido de " - Nome" (marca d'água de licenciamento). */
const CPF = String.raw`\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b`;
const MARCA_CPF_NOME = new RegExp(
  String.raw`${CPF}\s*[-–]\s*[\p{Lu}][\p{L}'’]+(?:\s+(?:d[aeo]s?|e)?\s*[\p{Lu}][\p{L}'’]+){0,6}`,
  "gu",
);
const MARCA_CPF = new RegExp(CPF, "g");
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Faixas (fração da altura) consideradas cabeçalho e rodapé. */
const FAIXA_CABECALHO = 0.9;
const FAIXA_RODAPE = 0.08;

function normalizarRepeticao(texto: string) {
  return texto.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function naFaixaMarginal(y: number, altura: number) {
  return y >= altura * FAIXA_CABECALHO || y <= altura * FAIXA_RODAPE;
}

/** Remove dados pessoais de marcas d'água (CPF, nome associado ao CPF, e-mail). */
export function removerDadosPessoais(texto: string) {
  return texto.replace(MARCA_CPF_NOME, "").replace(MARCA_CPF, "").replace(EMAIL, "").replace(/\s{2,}/g, " ").trim();
}

export function contemDadosPessoais(texto: string) {
  MARCA_CPF.lastIndex = 0;
  EMAIL.lastIndex = 0;
  const achou = MARCA_CPF.test(texto) || EMAIL.test(texto);
  MARCA_CPF.lastIndex = 0;
  EMAIL.lastIndex = 0;
  return achou;
}

export interface ResultadoLimpeza {
  paginas: { numero: number; linhas: string[] }[];
  linhasRemovidas: number;
}

/**
 * Remove cabeçalhos e rodapés repetidos (inclusive numeração de página) e
 * marcas d'água com dados pessoais. Uma linha marginal é considerada repetida
 * quando o mesmo padrão (dígitos ignorados) aparece em pelo menos 40% das páginas.
 */
export function limparPaginas(paginas: PaginaLinhas[]): ResultadoLimpeza {
  const frequencia = new Map<string, number>();
  for (const pagina of paginas) {
    const vistos = new Set<string>();
    for (const linha of pagina.linhas) {
      if (!naFaixaMarginal(linha.y, pagina.altura)) continue;
      const chave = normalizarRepeticao(linha.texto);
      if (!vistos.has(chave)) {
        vistos.add(chave);
        frequencia.set(chave, (frequencia.get(chave) ?? 0) + 1);
      }
    }
  }

  const limite = Math.max(3, Math.ceil(paginas.length * 0.4));
  const repetidas = new Set([...frequencia].filter(([, n]) => n >= limite).map(([k]) => k));
  // Numeração isolada ("12", "12 / 140") no rodapé conta como repetida mesmo em documentos curtos.
  const numeracao = /^[#\s/|-]+$/;

  let linhasRemovidas = 0;
  const resultado = paginas.map((pagina) => {
    const linhas: string[] = [];
    for (const linha of pagina.linhas) {
      const chave = normalizarRepeticao(linha.texto);
      const marginal = naFaixaMarginal(linha.y, pagina.altura);
      if (marginal && (repetidas.has(chave) || numeracao.test(chave))) {
        linhasRemovidas++;
        continue;
      }
      const limpa = contemDadosPessoais(linha.texto) ? removerDadosPessoais(linha.texto) : linha.texto;
      if (limpa !== linha.texto) linhasRemovidas++;
      if (limpa.length > 0) linhas.push(limpa);
    }
    return { numero: pagina.numero, linhas };
  });

  return { paginas: resultado, linhasRemovidas };
}

/** Junta as linhas de uma página em texto corrido, desfazendo hifenização de quebra de linha. */
export function juntarLinhas(linhas: string[]) {
  return linhas
    .join("\n")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
