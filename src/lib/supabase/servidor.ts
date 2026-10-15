import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envPublico, envServidor } from "@/lib/env";

/**
 * Cliente do servidor com a sessão do usuário (cookies). Sujeito a RLS:
 * é o cliente padrão para Server Components, Server Actions e Route Handlers.
 */
export async function clienteServidor(): Promise<SupabaseClient> {
  const loja = await cookies();
  return createServerClient(envPublico.supabaseUrl, envPublico.supabaseChavePublica, {
    cookies: {
      getAll: () => loja.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) loja.set(name, value, options);
        } catch {
          // Em Server Components os cookies são somente leitura; o proxy renova a sessão.
        }
      },
    },
  });
}

/**
 * Cliente administrativo (chave secreta, ignora RLS). Use apenas para operações
 * que o usuário não pode fazer sozinho (registro de consumo de IA, logs, rotinas
 * agendadas) e sempre depois de verificar a autorização no código.
 */
export function clienteAdmin(): SupabaseClient {
  const chave = envServidor().SUPABASE_SECRET_KEY;
  if (!chave) throw new Error("SUPABASE_SECRET_KEY não configurada");
  return createClient(envPublico.supabaseUrl, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function adminDisponivel() {
  return Boolean(envServidor().SUPABASE_SECRET_KEY);
}
