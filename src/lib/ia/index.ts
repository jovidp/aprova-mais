import "server-only";
import { createHash } from "node:crypto";
import { envServidor } from "@/lib/env";
import { adminDisponivel, clienteAdmin } from "@/lib/supabase/servidor";
import { criarProvedorAnthropic } from "./anthropic";
import { criarProvedorCompativel } from "./openai-compativel";
import { custoEstimado, precosDoModelo } from "./precos";
import { ErroIA, type ProvedorIA, type UsoTokens } from "./tipos";

export * from "./tipos";

const MODELO_PADRAO_ANTHROPIC = "claude-opus-5-5";

let provedorCache: ProvedorIA | null | undefined;

/** Provedor configurado por variáveis de ambiente, ou nulo se a IA estiver desligada. */
export function obterProvedor(): ProvedorIA | null {
  if (provedorCache !== undefined) return provedorCache;
  const env = envServidor();
  if (env.IA_PROVEDOR === "anthropic" && env.IA_API_KEY) {
    provedorCache = criarProvedorAnthropic(env.IA_API_KEY, env.IA_MODELO || MODELO_PADRAO_ANTHROPIC);
  } else if (env.IA_PROVEDOR === "openai_compatible" && env.IA_BASE_URL && env.IA_MODELO) {
    provedorCache = criarProvedorCompativel(env.IA_BASE_URL, env.IA_API_KEY, env.IA_MODELO, env.IA_MODELO_RESERVA);
  } else {
    provedorCache = null;
  }
  return provedorCache;
}

export interface EstadoIA {
  configurada: boolean;
  provedor: string | null;
  modelo: string | null;
  orcamentoMensalUsd: number;
  gastoMesUsd: number;
  gastoMesUsuarioUsd: number;
  limiteUsuarioUsd: number | null;
  bloqueadaPorOrcamento: boolean;
}

function inicioDoMes() {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
}

/**
 * Situação da IA para o usuário: provedor, orçamento da plataforma (variável
 * de ambiente) e limite pessoal (preferências). Gastos vêm de processamentos_ia.
 */
export async function estadoIA(userId: string): Promise<EstadoIA> {
  const env = envServidor();
  const provedor = obterProvedor();
  const base: EstadoIA = {
    configurada: Boolean(provedor), provedor: provedor?.nome ?? null, modelo: provedor?.modelo ?? null,
    orcamentoMensalUsd: env.IA_ORCAMENTO_MENSAL_USD, gastoMesUsd: 0, gastoMesUsuarioUsd: 0, limiteUsuarioUsd: null,
    bloqueadaPorOrcamento: false,
  };
  if (!provedor || !adminDisponivel()) return { ...base, bloqueadaPorOrcamento: Boolean(provedor) };
  const admin = clienteAdmin();
  const desde = inicioDoMes();
  const [{ data: todos }, { data: doUsuario }, { data: pref }] = await Promise.all([
    admin.from("processamentos_ia").select("custo_estimado_usd").gte("created_at", desde),
    admin.from("processamentos_ia").select("custo_estimado_usd").eq("user_id", userId).gte("created_at", desde),
    admin.from("preferencias_usuario").select("orcamento_ia_mensal_usd, ia_habilitada").eq("user_id", userId).maybeSingle(),
  ]);
  const soma = (l: { custo_estimado_usd: number | string }[] | null) => (l ?? []).reduce((s, r) => s + Number(r.custo_estimado_usd), 0);
  const gastoMes = soma(todos);
  const gastoUsuario = soma(doUsuario);
  const limiteUsuario = pref && Number(pref.orcamento_ia_mensal_usd) > 0 ? Number(pref.orcamento_ia_mensal_usd) : null;
  const bloqueada =
    pref?.ia_habilitada === false ||
    gastoMes >= env.IA_ORCAMENTO_MENSAL_USD ||
    (limiteUsuario !== null && gastoUsuario >= limiteUsuario);
  return { ...base, gastoMesUsd: gastoMes, gastoMesUsuarioUsd: gastoUsuario, limiteUsuarioUsd: limiteUsuario, bloqueadaPorOrcamento: bloqueada };
}

export function hashEntrada(valor: unknown) {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}

type TipoProcessamento = "gerar_questoes" | "validar_questao" | "classificar_material" | "tutor" | "analise_desempenho" | "gerar_flashcards" | "gerar_simulado" | "relatorio" | "edital" | "pontos_chave";

/**
 * Executa uma tarefa de IA com controle de orçamento e registro completo
 * (estado, tokens, custo estimado, erro). Sem IA configurada ou sem orçamento,
 * lança ErroIA e nada é cobrado.
 */
export async function executarComIA<T>(
  userId: string,
  tipo: TipoProcessamento,
  parametros: Record<string, unknown>,
  tarefa: (provedor: ProvedorIA, registrarUso: (uso: UsoTokens, modelo?: string) => void) => Promise<T>,
  opcoes: { resumoResultado?: (r: T) => unknown } = {},
): Promise<{ resultado: T; processamentoId: string; custoUsd: number }> {
  const provedor = obterProvedor();
  if (!provedor) throw new ErroIA("Nenhum provedor de IA está configurado. Defina IA_PROVEDOR e IA_API_KEY.", "indisponivel");
  if (!adminDisponivel()) throw new ErroIA("SUPABASE_SECRET_KEY é necessária para registrar o consumo de IA.", "indisponivel");
  const estado = await estadoIA(userId);
  if (estado.bloqueadaPorOrcamento) {
    throw new ErroIA(
      estado.orcamentoMensalUsd <= 0
        ? "O orçamento mensal de IA está zerado (IA_ORCAMENTO_MENSAL_USD). Defina um valor para habilitar as funções de IA."
        : "O orçamento de IA deste mês foi atingido. As demais funções continuam disponíveis.",
      "orcamento",
    );
  }

  const env = envServidor();
  const precos = precosDoModelo(provedor.modelo, env.IA_PRECO_ENTRADA_POR_MTOK, env.IA_PRECO_SAIDA_POR_MTOK);
  const admin = clienteAdmin();
  const { data: registro, error } = await admin.from("processamentos_ia").insert({
    user_id: userId, tipo, status: "executando", provedor: provedor.nome, modelo: provedor.modelo,
    parametros, entrada_hash: hashEntrada({ tipo, parametros }), iniciado_em: new Date().toISOString(), tentativas: 1,
  }).select("id").single();
  if (error) throw error;

  const total: UsoTokens = { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 };
  let modeloUsado = provedor.modelo;
  const registrarUso = (u: UsoTokens, modelo?: string) => {
    total.entrada += u.entrada; total.saida += u.saida; total.cacheEscrita += u.cacheEscrita; total.cacheLeitura += u.cacheLeitura;
    if (modelo) modeloUsado = modelo;
  };

  try {
    const resultado = await tarefa(provedor, registrarUso);
    const custo = custoEstimado(total, precos);
    await admin.from("processamentos_ia").update({
      status: "concluido", modelo: modeloUsado, tokens_entrada: total.entrada + total.cacheEscrita + total.cacheLeitura,
      tokens_saida: total.saida, custo_estimado_usd: custo, concluido_em: new Date().toISOString(),
      resultado: (opcoes.resumoResultado ? opcoes.resumoResultado(resultado) : null) as never,
      progresso: { cache_leitura: total.cacheLeitura, cache_escrita: total.cacheEscrita },
    }).eq("id", registro.id);
    return { resultado, processamentoId: registro.id, custoUsd: custo };
  } catch (erro) {
    const custo = custoEstimado(total, precos);
    await admin.from("processamentos_ia").update({
      status: "falhou", erro: erro instanceof Error ? erro.message.slice(0, 1000) : "erro", modelo: modeloUsado,
      tokens_entrada: total.entrada + total.cacheEscrita + total.cacheLeitura, tokens_saida: total.saida,
      custo_estimado_usd: custo, concluido_em: new Date().toISOString(),
    }).eq("id", registro.id);
    throw erro;
  }
}
