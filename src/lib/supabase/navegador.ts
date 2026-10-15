"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { envPublico } from "@/lib/env";

let cliente: SupabaseClient | null = null;

/** Cliente do navegador (chave publicável; protegido por RLS). */
export function clienteNavegador(): SupabaseClient {
  if (!cliente) cliente = createBrowserClient(envPublico.supabaseUrl, envPublico.supabaseChavePublica);
  return cliente;
}
