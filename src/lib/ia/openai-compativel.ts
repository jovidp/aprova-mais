import "server-only";
import { z } from "zod";
import { esperaSugerida } from "./limites";
import { ErroIA, type FluxoConversa, type PedidoConversa, type PedidoEstruturado, type ProvedorIA, type RespostaEstruturada, type UsoTokens } from "./tipos";

/**
 * Provedor para APIs no formato /chat/completions (OpenAI, Groq, OpenRouter,
 * Ollama e outros). Opcional: permite usar outro fornecedor sem mudar o resto
 * da plataforma. A resposta estruturada é validada com o mesmo esquema Zod.
 */
interface RespostaChat {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  model?: string;
  error?: { message?: string };
}

function usoDe(r: RespostaChat["usage"]): UsoTokens {
  const cache = r?.prompt_tokens_details?.cached_tokens ?? 0;
  return { entrada: Math.max(0, (r?.prompt_tokens ?? 0) - cache), saida: r?.completion_tokens ?? 0, cacheEscrita: 0, cacheLeitura: cache };
}

function extrairJson(texto: string): unknown {
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(limpo);
}

/** Espera máxima aceitável dentro de uma requisição (limite por minuto). */
const ESPERA_MAXIMA_MS = 65_000;

// Modelos indisponíveis até um instante (cota diária, modelo descontinuado),
// compartilhado entre provedores da mesma instância do servidor.
const indisponivelAte = new Map<string, number>();

export function criarProvedorCompativel(baseUrl: string, apiKey: string, modelo: string, modelosReserva = ""): ProvedorIA {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // O Gemini aceita "reasoning_effort"; sem ele, o raciocínio interno pode consumir todo o limite de saída.
  const aceitaEsforco = /generativelanguage\.googleapis\.com|api\.openai\.com/.test(baseUrl);
  // Fila de modelos: principal e reservas (IA_MODELO_RESERVA aceita lista separada por vírgula).
  const fila = [...new Set([modelo, ...modelosReserva.split(",").map((m) => m.trim()).filter(Boolean)])];

  async function chamar(corpo: Record<string, unknown>, esforco?: string): Promise<Response> {
    const agora = Date.now();
    const disponiveis = fila.filter((m) => (indisponivelAte.get(m) ?? 0) <= agora);
    // Todos esgotados: tenta mesmo assim o que libera primeiro.
    const modelos = disponiveis.length ? disponiveis : [...fila].sort((a, b) => (indisponivelAte.get(a) ?? 0) - (indisponivelAte.get(b) ?? 0)).slice(0, 1);
    let ultimo = "";
    for (let i = 0; i < modelos.length; i++) {
      const atual = modelos[i];
      const ehUltimo = i === modelos.length - 1;
      // Até 3 tentativas no mesmo modelo para sobrecarga (503) ou limite por minuto (429 curto).
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        let resposta: Response;
        try {
          resposta = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify({ model: atual, ...(aceitaEsforco && esforco ? { reasoning_effort: esforco } : {}), ...corpo }),
            signal: AbortSignal.timeout(280_000),
          });
        } catch {
          throw new ErroIA("Não foi possível conectar à API de IA configurada.", "indisponivel");
        }
        if (resposta.ok) return resposta;
        if (resposta.status === 401 || resposta.status === 403) throw new ErroIA("Chave da IA inválida. Verifique IA_API_KEY.", "indisponivel");

        if (resposta.status === 503 || resposta.status === 529) {
          ultimo = "sobrecarga";
          // Com outro modelo na fila, troca logo; no último, espera um pouco e insiste.
          if (!ehUltimo) break;
          await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
          continue;
        }
        if (resposta.status === 404) {
          // Modelo descontinuado ou inexistente para esta chave.
          indisponivelAte.set(atual, Date.now() + 24 * 3600_000);
          ultimo = "modelo";
          break;
        }
        if (resposta.status === 429) {
          const espera = esperaSugerida(await resposta.text().catch(() => "")) ?? 60_000;
          ultimo = "limite";
          if (espera <= ESPERA_MAXIMA_MS) {
            // Limite por minuto: com outro modelo livre, troca; senão espera e tenta de novo.
            if (!ehUltimo) { indisponivelAte.set(atual, Date.now() + espera); break; }
            await new Promise((r) => setTimeout(r, espera + 500));
            continue;
          }
          // Cota diária: marca até a liberação informada e segue para o próximo.
          indisponivelAte.set(atual, Date.now() + espera);
          break;
        }
        throw new ErroIA(`Erro da API de IA (${resposta.status}).`, "falha");
      }
    }
    if (ultimo === "limite") throw new ErroIA("A cota gratuita de IA de hoje acabou em todos os modelos configurados. Tente novamente mais tarde.", "limite");
    if (ultimo === "modelo") throw new ErroIA("Nenhum dos modelos de IA configurados está disponível para esta chave.", "indisponivel");
    throw new ErroIA("O serviço de IA está sobrecarregado no momento. Tente novamente em alguns minutos.", "limite");
  }

  return {
    nome: "openai_compatible",
    modelo,

    async gerarEstruturado<T>(pedido: PedidoEstruturado<T>): Promise<RespostaEstruturada<T>> {
      const esquemaJson = z.toJSONSchema(pedido.esquema);
      const mensagens = [
        { role: "system", content: `${pedido.sistema}\n\nResponda somente com JSON válido que siga este esquema:\n${JSON.stringify(esquemaJson)}` },
        ...pedido.mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
      ];
      let uso: UsoTokens = { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 };
      // Uma nova tentativa se o JSON vier inválido.
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const resposta = await chamar({
          messages: mensagens,
          max_tokens: pedido.maxTokens ?? 16000,
          response_format: { type: "json_schema", json_schema: { name: pedido.nomeEsquema, schema: esquemaJson } },
        }, pedido.esforco ?? "low");
        const json = (await resposta.json()) as RespostaChat;
        const parcial = usoDe(json.usage);
        uso = { entrada: uso.entrada + parcial.entrada, saida: uso.saida + parcial.saida, cacheEscrita: 0, cacheLeitura: uso.cacheLeitura + parcial.cacheLeitura };
        const texto = json.choices?.[0]?.message?.content ?? "";
        try {
          const dados = pedido.esquema.parse(extrairJson(texto));
          return { dados, uso, modelo: json.model ?? modelo };
        } catch {
          if (tentativa === 1) throw new ErroIA("A IA não devolveu dados no formato esperado.", "formato");
        }
      }
      throw new ErroIA("A IA não devolveu dados no formato esperado.", "formato");
    },

    async conversar(pedido: PedidoConversa): Promise<FluxoConversa> {
      const resposta = await chamar({
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: pedido.maxTokens ?? 16000,
        messages: [{ role: "system", content: pedido.sistema }, ...pedido.mensagens.map((m) => ({ role: m.papel, content: m.conteudo }))],
      }, pedido.esforco ?? "low");
      let texto = "";
      let uso: UsoTokens = { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 };
      let modeloUsado = modelo;
      let concluir: () => void = () => {};
      const terminou = new Promise<void>((r) => { concluir = r; });

      async function* textos() {
        const leitor = resposta.body!.getReader();
        const decodificador = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value, done } = await leitor.read();
            if (done) break;
            buffer += decodificador.decode(value, { stream: true });
            const linhas = buffer.split("\n");
            buffer = linhas.pop() ?? "";
            for (const linha of linhas) {
              const dado = linha.replace(/^data:\s*/, "").trim();
              if (!dado || dado === "[DONE]") continue;
              try {
                const evento = JSON.parse(dado) as RespostaChat & { choices?: { delta?: { content?: string } }[] };
                if (evento.usage) uso = usoDe(evento.usage);
                if (evento.model) modeloUsado = evento.model;
                const pedaco = evento.choices?.[0]?.delta?.content;
                if (pedaco) {
                  texto += pedaco;
                  yield pedaco;
                }
              } catch {
                // Linha parcial ou comentário SSE: ignora.
              }
            }
          }
        } finally {
          concluir();
        }
      }
      return { textos: textos(), final: async () => { await terminou; return { uso, modelo: modeloUsado, texto }; } };
    },
  };
}
