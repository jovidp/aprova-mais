import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { envPublico, envServidor } from "@/lib/env";

export const dynamic = "force-dynamic";

function autorizado(request: NextRequest) {
  const segredo = envServidor().CRON_SECRET;
  const cabecalho = request.headers.get("authorization") ?? "";
  if (!segredo || !cabecalho.startsWith("Bearer ")) return false;
  const a = Buffer.from(cabecalho.slice(7));
  const b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verificação de disponibilidade.
 * - Sem credencial: apenas confirma que a aplicação responde (não toca no banco).
 * - Com "Authorization: Bearer <CRON_SECRET>": executa uma consulta leve e
 *   somente leitura no banco (verificar_saude) e mede a latência.
 */
export async function GET(request: NextRequest) {
  const inicio = Date.now();
  if (!autorizado(request)) {
    return NextResponse.json({ ok: true, aplicacao: "online", horario: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const supabase = createClient(envPublico.supabaseUrl, envPublico.supabaseChavePublica, { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("verificar_saude");
    const latencia = Date.now() - inicio;
    if (error) {
      return NextResponse.json({ ok: false, aplicacao: "online", banco: "erro", detalhe: error.message, latencia_ms: latencia }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: true, aplicacao: "online", banco: "online", latencia_ms: latencia, verificacao: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return NextResponse.json(
      { ok: false, aplicacao: "online", banco: "inacessivel", detalhe: erro instanceof Error ? erro.message : "erro", latencia_ms: Date.now() - inicio },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
