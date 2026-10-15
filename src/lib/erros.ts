/**
 * Tratamento centralizado de erros: converte erros técnicos (Postgres,
 * Supabase, rede, validação) em mensagens compreensíveis, sem vazar detalhes internos.
 */
import { ZodError } from "zod";

export class ErroApp extends Error {
  constructor(
    message: string,
    public readonly codigo: string = "erro",
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ErroApp";
  }
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string; codigo?: string };

interface ErroPostgrest {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

const MENSAGENS_POR_CODIGO: Record<string, string> = {
  "42501": "Você não tem permissão para esta operação.",
  "23505": "Este registro já existe.",
  "23503": "Este item está em uso e não pode ser removido.",
  "23P01": "O horário escolhido conflita com outra atividade.",
  "PGRST116": "Registro não encontrado.",
  "PGRST301": "Sessão expirada. Entre novamente.",
};

/**
 * Funções do banco já lançam mensagens em português para regras de negócio
 * (códigos 22023, 55000, P0002, 42501). Para os demais casos, usa uma mensagem genérica.
 */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroApp) return erro.message;
  if (erro instanceof ZodError) {
    const primeiro = erro.issues[0];
    return primeiro ? `${primeiro.path.join(".") || "Dados"}: ${primeiro.message}` : "Dados inválidos.";
  }
  const pg = erro as ErroPostgrest | undefined;
  if (pg && typeof pg === "object" && typeof pg.message === "string") {
    if (pg.code && ["22023", "55000", "P0002"].includes(pg.code)) return pg.message;
    if (pg.code === "42501" && /[áéíóúãõç]/i.test(pg.message)) return pg.message;
    if (pg.code === "23505" && pg.message === "Questão duplicada") return "Já existe uma questão com o mesmo conteúdo.";
    if (pg.code && MENSAGENS_POR_CODIGO[pg.code]) return MENSAGENS_POR_CODIGO[pg.code];
    if (/fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(pg.message)) {
      return "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.";
    }
  }
  return "Ocorreu um erro inesperado. Tente novamente.";
}

export function codigoDeErro(erro: unknown): string | undefined {
  if (erro instanceof ErroApp) return erro.codigo;
  const pg = erro as ErroPostgrest | undefined;
  return pg && typeof pg === "object" ? pg.code : undefined;
}

/** Lança se a resposta do Supabase trouxer erro; devolve os dados tipados. */
export function exigirDados<T>(resposta: { data: T | null; error: unknown }): T {
  if (resposta.error) throw resposta.error;
  if (resposta.data === null) throw new ErroApp("Registro não encontrado.", "nao_encontrado", 404);
  return resposta.data;
}
