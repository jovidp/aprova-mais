import type { z } from "zod";

export type Esforco = "low" | "medium" | "high";

export interface UsoTokens {
  entrada: number;
  saida: number;
  cacheEscrita: number;
  cacheLeitura: number;
}

export interface MensagemIA {
  papel: "user" | "assistant";
  conteudo: string;
}

export interface PedidoEstruturado<T> {
  /** Instruções estáveis (candidatas a cache). */
  sistema: string;
  mensagens: MensagemIA[];
  esquema: z.ZodType<T>;
  nomeEsquema: string;
  maxTokens?: number;
  esforco?: Esforco;
}

export interface PedidoConversa {
  sistema: string;
  mensagens: MensagemIA[];
  maxTokens?: number;
  esforco?: Esforco;
}

export interface RespostaEstruturada<T> {
  dados: T;
  uso: UsoTokens;
  modelo: string;
}

export interface FluxoConversa {
  textos: AsyncIterable<string>;
  /** Resolve ao final do fluxo com o uso total. */
  final: () => Promise<{ uso: UsoTokens; modelo: string; texto: string }>;
}

export interface ProvedorIA {
  nome: "anthropic" | "openai_compatible";
  modelo: string;
  gerarEstruturado<T>(pedido: PedidoEstruturado<T>): Promise<RespostaEstruturada<T>>;
  conversar(pedido: PedidoConversa): Promise<FluxoConversa>;
}

export class ErroIA extends Error {
  constructor(message: string, public readonly codigo: "indisponivel" | "orcamento" | "recusa" | "formato" | "limite" | "falha" = "falha") {
    super(message);
    this.name = "ErroIA";
  }
}
