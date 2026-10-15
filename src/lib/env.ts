import { z } from "zod";

/** Variáveis públicas (seguras no navegador). Referências literais para o bundler substituir. */
export const envPublico = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseChavePublica: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

export function supabaseConfigurado() {
  return Boolean(envPublico.supabaseUrl && envPublico.supabaseChavePublica);
}

const esquemaServidor = z.object({
  SUPABASE_SECRET_KEY: z.string().optional().default(""),
  IA_PROVEDOR: z.enum(["anthropic", "openai_compatible", "nenhum"]).optional().default("nenhum"),
  IA_API_KEY: z.string().optional().default(""),
  IA_MODELO: z.string().optional().default(""),
  IA_BASE_URL: z.string().optional().default(""),
  IA_MODELO_RESERVA: z.string().optional().default(""),
  IA_PRECO_ENTRADA_POR_MTOK: z.coerce.number().min(0).optional().default(0),
  IA_PRECO_SAIDA_POR_MTOK: z.coerce.number().min(0).optional().default(0),
  IA_ORCAMENTO_MENSAL_USD: z.coerce.number().min(0).optional().default(0),
  CRON_SECRET: z.string().optional().default(""),
});

export type EnvServidor = z.infer<typeof esquemaServidor>;

let cache: EnvServidor | null = null;

/** Lê e valida variáveis do servidor. Nunca importe em componentes de cliente. */
export function envServidor(): EnvServidor {
  if (typeof window !== "undefined") throw new Error("envServidor() só pode ser usado no servidor");
  if (!cache) cache = esquemaServidor.parse(process.env);
  return cache;
}
