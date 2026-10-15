import { ROTULO_ORIGEM_QUESTAO } from "@/lib/utils";

export interface AlternativaExibicao {
  id: string;
  letra: string;
  texto: string;
}

export interface QuestaoExibicao {
  id: string;
  tipo: "multipla_escolha" | "certo_errado";
  enunciado: string;
  texto_apoio?: string | null;
  dificuldade: string;
  origem: string;
  disciplina?: string | null;
  assunto?: string | null;
  subassunto?: string | null;
  banca_estilo?: string | null;
  banca_oficial?: string | null;
  ano?: number | null;
  possivelmente_desatualizada?: boolean;
  alternativas: AlternativaExibicao[];
}

export interface FonteCorrecao {
  material_id: string | null;
  pagina: number | null;
  trecho: string | null;
  descricao: string | null;
  material_titulo: string | null;
  tipo?: string;
}

export interface CorrecaoExibicao {
  alternativa_correta_id: string;
  explicacao: string;
  justificativas: Record<string, string>;
  fontes: FonteCorrecao[];
}

/** Rótulo de origem que nunca apresenta questão autoral como oficial de banca. */
export function rotuloOrigem(q: { origem: string; banca_estilo?: string | null; banca_oficial?: string | null; ano?: number | null }) {
  if (q.origem === "importada_licenciada" && q.banca_oficial) return `${q.banca_oficial}${q.ano ? ` ${q.ano}` : ""} · base licenciada`;
  const base = ROTULO_ORIGEM_QUESTAO[q.origem] ?? q.origem;
  return q.banca_estilo ? `${base} · estilo ${q.banca_estilo}` : base;
}
