import { z } from "zod";

/** Formato pedido à IA na geração (validação fina fica em validacao.ts). */
export const esquemaQuestaoIA = z.object({
  tipo: z.enum(["multipla_escolha", "certo_errado"]),
  estilo: z.enum(["conceitual", "interpretacao", "aplicacao", "situacao_hipotetica", "analise_juridica"]),
  dificuldade: z.enum(["facil", "medio", "dificil"]),
  enunciado: z.string(),
  texto_apoio: z.string().nullable(),
  alternativas: z.array(z.object({
    letra: z.enum(["A", "B", "C", "D", "E"]),
    texto: z.string(),
    correta: z.boolean(),
    justificativa: z.string(),
  })),
  explicacao: z.string(),
  pagina_referencia: z.number(),
  trecho_apoio: z.string(),
  subassunto: z.string().nullable(),
  depende_de_legislacao_recente: z.boolean(),
});

export const esquemaLoteIA = z.object({
  questoes: z.array(esquemaQuestaoIA),
  observacoes: z.string(),
});

export type QuestaoIA = z.infer<typeof esquemaQuestaoIA>;
export type LoteIA = z.infer<typeof esquemaLoteIA>;

/** Revisão independente: a IA responde sem ver o gabarito. */
export const esquemaVerificacao = z.object({
  avaliacoes: z.array(z.object({
    indice: z.number(),
    letra_escolhida: z.enum(["A", "B", "C", "D", "E"]),
    suportada_pelo_material: z.boolean(),
    ambigua: z.boolean(),
    problemas: z.array(z.string()),
  })),
});

export type Verificacao = z.infer<typeof esquemaVerificacao>;

/** Importação de base licenciada (JSON). */
export const esquemaQuestaoImportada = z.object({
  tipo: z.enum(["multipla_escolha", "certo_errado"]),
  enunciado: z.string().min(10).max(8000),
  texto_apoio: z.string().max(12000).optional().nullable(),
  dificuldade: z.enum(["facil", "medio", "dificil"]).default("medio"),
  estilo: z.enum(["conceitual", "interpretacao", "aplicacao", "situacao_hipotetica", "analise_juridica"]).default("conceitual"),
  disciplina: z.string().min(1).max(160),
  assunto: z.string().max(200).optional().nullable(),
  subassunto: z.string().max(240).optional().nullable(),
  banca: z.string().max(40).optional().nullable(),
  ano: z.number().int().min(1990).max(2100).optional().nullable(),
  cargo: z.string().max(200).optional().nullable(),
  alternativas: z.array(z.object({ letra: z.string().length(1), texto: z.string().min(1).max(3000), correta: z.boolean().default(false), justificativa: z.string().max(3000).optional() })).min(2).max(5),
  explicacao: z.string().min(1).max(12000),
});

export const esquemaArquivoImportacao = z.object({
  licenca: z.string().min(3).max(500),
  questoes: z.array(esquemaQuestaoImportada).min(1).max(2000),
});
