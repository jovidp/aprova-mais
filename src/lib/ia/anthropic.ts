import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ErroIA, type FluxoConversa, type PedidoConversa, type PedidoEstruturado, type ProvedorIA, type RespostaEstruturada, type UsoTokens } from "./tipos";

/**
 * Provedor Claude (SDK oficial).
 * - Saída estruturada validada por Zod (messages.parse + output_config.format).
 * - Prompt de sistema marcado para cache (instruções estáveis repetidas).
 * - Fallback do servidor em caso de recusa por política ("fallbacks: default").
 */
const BETAS = ["server-side-fallback-2026-07-01"];

function uso(u: Anthropic.Beta.BetaUsage): UsoTokens {
  return {
    entrada: u.input_tokens ?? 0,
    saida: u.output_tokens ?? 0,
    cacheEscrita: u.cache_creation_input_tokens ?? 0,
    cacheLeitura: u.cache_read_input_tokens ?? 0,
  };
}

function tratarErro(erro: unknown): never {
  if (erro instanceof ErroIA) throw erro;
  if (erro instanceof Anthropic.RateLimitError) throw new ErroIA("Limite de uso da IA atingido. Tente novamente em alguns minutos.", "limite");
  if (erro instanceof Anthropic.AuthenticationError || erro instanceof Anthropic.PermissionDeniedError) {
    throw new ErroIA("Chave da IA inválida ou sem permissão. Verifique IA_API_KEY.", "indisponivel");
  }
  if (erro instanceof Anthropic.BadRequestError) throw new ErroIA(`Pedido recusado pela API de IA: ${erro.message}`, "falha");
  if (erro instanceof Anthropic.APIConnectionError) throw new ErroIA("Não foi possível conectar à API de IA.", "indisponivel");
  if (erro instanceof Anthropic.APIError) throw new ErroIA(`Erro da API de IA (${erro.status}).`, "falha");
  throw erro;
}

export function criarProvedorAnthropic(apiKey: string, modelo: string): ProvedorIA {
  const cliente = new Anthropic({ apiKey, maxRetries: 2, timeout: 280_000 });

  return {
    nome: "anthropic",
    modelo,

    async gerarEstruturado<T>(pedido: PedidoEstruturado<T>): Promise<RespostaEstruturada<T>> {
      try {
        const resposta = await cliente.beta.messages.parse({
          model: modelo,
          max_tokens: pedido.maxTokens ?? 16000,
          betas: BETAS,
          fallbacks: "default",
          system: [{ type: "text", text: pedido.sistema, cache_control: { type: "ephemeral" } }],
          messages: pedido.mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
          output_config: { format: betaZodOutputFormat(pedido.esquema), effort: pedido.esforco ?? "medium" },
        });
        if (resposta.stop_reason === "refusal") {
          throw new ErroIA("A IA recusou este pedido. Reformule ou escolha outro trecho do material.", "recusa");
        }
        if (resposta.stop_reason === "max_tokens") {
          throw new ErroIA("A resposta da IA foi cortada por excesso de tamanho. Peça menos itens por vez.", "formato");
        }
        if (!resposta.parsed_output) throw new ErroIA("A IA não devolveu dados no formato esperado.", "formato");
        return { dados: resposta.parsed_output as T, uso: uso(resposta.usage), modelo: resposta.model };
      } catch (erro) {
        tratarErro(erro);
      }
    },

    async conversar(pedido: PedidoConversa): Promise<FluxoConversa> {
      try {
        const fluxo = cliente.beta.messages.stream({
          model: modelo,
          max_tokens: pedido.maxTokens ?? 16000,
          betas: BETAS,
          fallbacks: "default",
          system: [{ type: "text", text: pedido.sistema, cache_control: { type: "ephemeral" } }],
          messages: pedido.mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
          output_config: { effort: pedido.esforco ?? "medium" },
        });
        async function* textos() {
          try {
            for await (const evento of fluxo) {
              if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") yield evento.delta.text;
            }
          } catch (erro) {
            tratarErro(erro);
          }
        }
        return {
          textos: textos(),
          final: async () => {
            const msg = await fluxo.finalMessage();
            if (msg.stop_reason === "refusal") throw new ErroIA("A IA recusou responder a esta pergunta.", "recusa");
            const texto = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
            return { uso: uso(msg.usage), modelo: msg.model, texto };
          },
        };
      } catch (erro) {
        tratarErro(erro);
      }
    },
  };
}
