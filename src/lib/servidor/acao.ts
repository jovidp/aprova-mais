import "server-only";
import { codigoDeErro, mensagemDeErro, type Resultado } from "@/lib/erros";
import { registrarErro } from "@/lib/servidor/logs";

/**
 * Envolve uma Server Action: toda falha vira { ok: false, erro } com mensagem
 * amigável e é registrada no log do servidor. A ação nunca lança para o cliente.
 */
export async function executarAcao<T>(origem: string, fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, dados: await fn() };
  } catch (erro) {
    // redirect() e notFound() do Next usam exceções de controle de fluxo.
    if (erro && typeof erro === "object" && "digest" in erro && String((erro as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw erro;
    }
    const codigo = codigoDeErro(erro);
    const esperado = codigo && ["22023", "55000", "P0002", "42501", "23505", "23P01"].includes(codigo);
    if (!esperado) await registrarErro(origem, erro);
    return { ok: false, erro: mensagemDeErro(erro), codigo };
  }
}
