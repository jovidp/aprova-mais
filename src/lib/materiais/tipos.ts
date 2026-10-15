/**
 * Tipos compartilhados pelo pipeline de leitura de materiais.
 * O pipeline roda tanto no navegador (importação) quanto no servidor (reprocessamento),
 * por isso não depende de APIs de Node nem do DOM.
 */

export interface ItemTexto {
  str: string;
  x: number;
  /** Coordenada vertical do PDF (origem no rodapé da página). */
  y: number;
  largura: number;
  altura: number;
}

export interface PaginaBruta {
  numero: number;
  largura: number;
  altura: number;
  itens: ItemTexto[];
}

export interface Linha {
  texto: string;
  x: number;
  y: number;
  altura: number;
}

export interface PaginaLinhas {
  numero: number;
  altura: number;
  linhas: Linha[];
}

export interface PaginaProcessada {
  numero: number;
  texto: string;
  caracteres: number;
}

export type TipoSecao =
  | "apresentacao"
  | "teoria"
  | "questoes_comentadas"
  | "lista_questoes"
  | "gabarito"
  | "resumo"
  | "outro";

export interface EntradaIndice {
  ordem: number;
  titulo: string;
  pagina: number;
}

export interface SecaoDetectada {
  ordem: number;
  titulo: string;
  paginaInicio: number;
  paginaFim: number;
  tipo: TipoSecao;
  /** Assunto sugerido (nome legível). */
  assunto: string | null;
  subassunto: string | null;
  /** Banca citada no título (ex.: "Questões Comentadas - X - Cebraspe"). */
  banca: string | null;
  origem: "indice" | "titulos" | "documento_inteiro";
  confianca: number;
}

export interface MetadadosMaterial {
  aulaNumero: number | null;
  aulaRotulo: string | null;
  concurso: string | null;
  disciplina: string | null;
  autor: string | null;
  /** Data impressa na capa, em ISO (AAAA-MM-DD). */
  dataMaterial: string | null;
  fonteDisciplina: "capa" | "pasta" | "nome_arquivo" | "indefinida";
}

export interface ResultadoAnalise {
  metadados: MetadadosMaterial;
  secoes: SecaoDetectada[];
  paginas: PaginaProcessada[];
  totalPaginas: number;
  /** Quantidade de linhas removidas por serem cabeçalho, rodapé ou marca d'água. */
  linhasRemovidas: number;
  /** Páginas com pouco ou nenhum texto (possível digitalização). */
  paginasSemTexto: number[];
  requerOcr: boolean;
  avisos: string[];
}
