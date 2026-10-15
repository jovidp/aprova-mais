import type { EntradaIndice, SecaoDetectada, TipoSecao } from "./tipos";
import { chaveNome, SEPARADOR_TITULO } from "./normalizacao";
import { atribuirAssuntos, limparTitulo } from "./taxonomia";

const BANCAS_CONHECIDAS: Record<string, string> = {
  cebraspe: "CEBRASPE",
  cespe: "CEBRASPE",
  fgv: "FGV",
  fcc: "FCC",
  vunesp: "VUNESP",
  ibfc: "IBFC",
  "instituto aocp": "Instituto AOCP",
  aocp: "Instituto AOCP",
  cesgranrio: "CESGRANRIO",
  idecan: "IDECAN",
  quadrix: "Quadrix",
  "fundatec": "FUNDATEC",
  "consulplan": "CONSULPLAN",
  "multibancas": "Multibancas",
  "multiibancas": "Multibancas",
  "diversas bancas": "Multibancas",
};

export function classificarTipoSecao(titulo: string): TipoSecao {
  const t = chaveNome(titulo);
  if (/lista de questoes|lista de exercicios|questoes sem comentarios/.test(t)) return "lista_questoes";
  if (/questoes comentadas|^questoes\b|exercicios comentados/.test(t)) return "questoes_comentadas";
  if (/^gabarito/.test(t)) return "gabarito";
  if (/^apresentacao|^abertura de curso|^introducao ao curso|^metodologia/.test(t)) return "apresentacao";
  if (/^resumo|resumo$|resumo estrategico|mapa mental|^consideracoes finais|^esquema/.test(t)) return "resumo";
  return "teoria";
}

/** Partes do título que indicam o formato da seção, não o assunto. */
const PARTE_DE_FORMATO =
  /^(questoes comentadas.*|questoes|lista de questoes.*|lista de exercicios.*|exercicios comentados.*|gabarito|resumo|resumo estrategico|mapa mental|teoria|ineditas|questoes ineditas|aula completa|completo)$/;

/** Banca citada no final do título ("... - Cebraspe"). */
export function extrairBanca(titulo: string): string | null {
  const partes = titulo.split(SEPARADOR_TITULO);
  for (let i = partes.length - 1; i >= 1; i--) {
    const banca = BANCAS_CONHECIDAS[chaveNome(partes[i])];
    if (banca) return banca;
  }
  return null;
}

/**
 * Tema tratado pela seção. Para seções de questões, remove o prefixo
 * ("Questões Comentadas - ") e a banca do final.
 */
export function temaDaSecao(titulo: string, tipo: TipoSecao): string {
  let partes = limparTitulo(titulo).split(SEPARADOR_TITULO).map((p) => p.trim()).filter(Boolean);
  if (tipo === "questoes_comentadas" || tipo === "lista_questoes" || tipo === "gabarito" || tipo === "resumo") {
    const primeira = chaveNome(partes[0] ?? "");
    if (/^(questoes comentadas|lista de questoes|lista de exercicios|exercicios comentados|gabarito|resumo)$/.test(primeira)) {
      partes = partes.slice(1);
    } else if (/^questoes\s/.test(primeira)) {
      // "Questões Recrutamento e Seleção - Multibancas"
      partes[0] = partes[0].replace(/^quest(?:õ|o)es\s+/i, "");
    }
  }
  // Formato ("- Teoria", "- Questões Comentadas") e banca não fazem parte do assunto.
  const semFormato = partes.filter((p) => !PARTE_DE_FORMATO.test(chaveNome(p)) && !BANCAS_CONHECIDAS[chaveNome(p)]);
  if (semFormato.length > 0) partes = semFormato;
  // Referências a artigos no meio do tema ("... - Art. 5º - XXXII a LXXIX") também não.
  const idxArtigo = partes.findIndex((p, i) => i > 0 && /^arts?\.?\s*\d/i.test(p));
  if (idxArtigo > 0) partes = partes.slice(0, idxArtigo);
  return partes.join(" - ") || titulo;
}

/** Converte as entradas do índice em seções com intervalo de páginas, tipo e assunto sugerido. */
export function montarSecoes(
  entradas: EntradaIndice[],
  totalPaginas: number,
  disciplina: string | null,
): SecaoDetectada[] {
  const base = entradas.map((entrada) => {
    const tipo = classificarTipoSecao(entrada.titulo);
    return { tipo, tema: temaDaSecao(entrada.titulo, tipo) };
  });
  const sugestoes = atribuirAssuntos(base, disciplina);

  return entradas.map((entrada, i) => {
    const proxima = entradas[i + 1];
    const paginaFim = proxima ? Math.max(entrada.pagina, proxima.pagina - 1) : totalPaginas;
    const tipo = base[i].tipo;
    const sugestao = sugestoes[i];
    return {
      ordem: entrada.ordem,
      titulo: entrada.titulo,
      paginaInicio: entrada.pagina,
      paginaFim,
      tipo,
      assunto: sugestao?.assunto ?? null,
      subassunto: sugestao?.subassunto ?? null,
      banca: extrairBanca(entrada.titulo),
      origem: "indice",
      confianca: sugestao?.confianca ?? 0.5,
    };
  });
}
