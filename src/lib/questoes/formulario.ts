export interface DadosFormQuestao {
  id?: string;
  tipo: "multipla_escolha" | "certo_errado";
  estilo: "conceitual" | "interpretacao" | "aplicacao" | "situacao_hipotetica" | "analise_juridica";
  enunciado: string;
  textoApoio: string;
  dificuldade: "facil" | "medio" | "dificil";
  disciplinaId: string;
  assunto: string;
  subassunto: string;
  bancaEstiloId: string;
  alternativas: { letra: string; texto: string; correta: boolean; justificativa: string }[];
  explicacao: string;
  materialId: string;
  pagina: string;
}

export const QUESTAO_VAZIA: DadosFormQuestao = {
  tipo: "multipla_escolha", estilo: "conceitual", enunciado: "", textoApoio: "", dificuldade: "medio", disciplinaId: "",
  assunto: "", subassunto: "", bancaEstiloId: "", explicacao: "", materialId: "", pagina: "",
  alternativas: ["A", "B", "C", "D", "E"].map((letra, i) => ({ letra, texto: "", correta: i === 0, justificativa: "" })),
};
