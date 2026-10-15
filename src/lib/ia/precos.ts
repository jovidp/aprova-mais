import type { UsoTokens } from "./tipos";

/**
 * Preços públicos da Anthropic (US$ por milhão de tokens), consultados em
 * 2026-10. São usados apenas para ESTIMAR custos; podem ser sobrescritos por
 * IA_PRECO_ENTRADA_POR_MTOK / IA_PRECO_SAIDA_POR_MTOK.
 * Escrita em cache (5 min) custa 1,25× a entrada.
 */
const TABELA: Record<string, { entrada: number; saida: number; cacheLeitura: number }> = {
  "claude-opus-5-5": { entrada: 4, saida: 20, cacheLeitura: 0.2 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10, cacheLeitura: 0.2 },
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01 },
  "claude-fable-5-1": { entrada: 10, saida: 50, cacheLeitura: 0.25 },
  // Google (agregadores de preço, 2026-10; confira no site oficial).
  "gemini-3.5-flash": { entrada: 1.5, saida: 9, cacheLeitura: 0.15 },
};

export interface Precos {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export function precosDoModelo(modelo: string, entradaEnv = 0, saidaEnv = 0): Precos {
  const base = TABELA[modelo];
  const entrada = entradaEnv > 0 ? entradaEnv : base?.entrada ?? 0;
  const saida = saidaEnv > 0 ? saidaEnv : base?.saida ?? 0;
  const cacheLeitura = base && entradaEnv <= 0 ? base.cacheLeitura : entrada * 0.1;
  return { entrada, saida, cacheLeitura, cacheEscrita: entrada * 1.25 };
}

export function custoEstimado(uso: UsoTokens, p: Precos): number {
  const total =
    (uso.entrada * p.entrada + uso.saida * p.saida + uso.cacheLeitura * p.cacheLeitura + uso.cacheEscrita * p.cacheEscrita) / 1_000_000;
  return Math.round(total * 1e6) / 1e6;
}

export function precoConhecido(modelo: string) {
  return modelo in TABELA;
}
