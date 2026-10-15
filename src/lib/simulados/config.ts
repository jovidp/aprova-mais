import { z } from "zod";

/** Configuração de simulado: compartilhada entre formulário, servidor e agendamentos. */
export const TIPOS_SIMULADO = {
  geral: { rotulo: "Geral", descricao: "Várias disciplinas, distribuídas pelos pesos de cada uma." },
  disciplina: { rotulo: "Por disciplina", descricao: "Uma disciplina, cobrindo todos os assuntos com questões." },
  assunto: { rotulo: "Por assunto", descricao: "Somente os assuntos escolhidos." },
  erros: { rotulo: "De erros", descricao: "Questões que você errou na última tentativa, para medir sua evolução." },
  adaptativo: { rotulo: "Adaptativo", descricao: "Mais questões dos assuntos em que você erra mais, sem deixar de cobrir os demais." },
  banca: { rotulo: "Estilo da banca", descricao: "Questões autorais no formato da banca escolhida (nunca apresentadas como oficiais)." },
  concurso: { rotulo: "Completo do concurso", descricao: "Distribuição, duração e pontuação do edital cadastrado (ou configuradas por você)." },
  diagnostico: { rotulo: "Diagnóstico", descricao: "Amostra equilibrada de todas as suas disciplinas para medir o nível inicial." },
  semanal: { rotulo: "Semanal", descricao: "Assuntos que você estudou nos últimos 7 dias." },
  revisao_acumulada: { rotulo: "Revisão acumulada", descricao: "Mistura conteúdos recentes (60%) e anteriores (40%) para retenção de longo prazo." },
} as const;

export type TipoSimulado = keyof typeof TIPOS_SIMULADO;

export const esquemaConfigSimulado = z.object({
  tipo: z.enum(Object.keys(TIPOS_SIMULADO) as [TipoSimulado, ...TipoSimulado[]]),
  nome: z.string().trim().max(200).default(""),
  disciplinaIds: z.array(z.string().uuid()).max(40).default([]),
  assuntoIds: z.array(z.string().uuid()).max(200).default([]),
  bancaId: z.string().uuid().nullable().default(null),
  concursoId: z.string().uuid().nullable().default(null),
  editalId: z.string().uuid().nullable().default(null),
  quantidade: z.number().int().min(1).max(300),
  dificuldades: z.object({ facil: z.number().min(0).max(100), medio: z.number().min(0).max(100), dificil: z.number().min(0).max(100) })
    .default({ facil: 1, medio: 1, dificil: 1 }),
  tipos: z.array(z.enum(["multipla_escolha", "certo_errado"])).min(1).default(["multipla_escolha", "certo_errado"]),
  incluirRespondidas: z.boolean().default(true),
  somenteIneditas: z.boolean().default(false),
  ordem: z.enum(["aleatoria", "organizada"]).default("aleatoria"),
  tempoLimiteMin: z.number().int().min(1).max(720).nullable().default(null),
  permitePausa: z.boolean().default(false),
  mostrarGabaritoDurante: z.boolean().default(false),
  finalizarAoEsgotar: z.boolean().default(true),
  regraPontuacaoId: z.string().uuid().nullable().default(null),
  pontosAcerto: z.number().min(0.01).max(100).default(1),
  pontosErro: z.number().min(-100).max(100).default(0),
  pontosBranco: z.number().min(-100).max(100).default(0),
  notaNaoNegativa: z.boolean().default(true),
  gerarComIA: z.boolean().default(false),
  /** Aceitar montar com menos questões quando faltar conteúdo. */
  aceitarMenos: z.boolean().default(false),
});

export type ConfigSimulado = z.infer<typeof esquemaConfigSimulado>;
export type EntradaConfigSimulado = z.input<typeof esquemaConfigSimulado>;

export const QUANTIDADES_SUGERIDAS = [10, 20, 30, 50, 80, 120];
