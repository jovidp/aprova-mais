import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * Destino dos links de e-mail (confirmação de cadastro e recuperação de senha).
 * Aceita o fluxo PKCE (?code=) e o de token (?token_hash=&type=).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const proximoBruto = url.searchParams.get("proximo") ?? "/dashboard";
  const proximo = proximoBruto.startsWith("/") && !proximoBruto.startsWith("//") ? proximoBruto : "/dashboard";
  const supabase = await clienteServidor();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const tipo = url.searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && tipo) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo })).error;
  }

  const destino = ok
    ? new URL(tipo === "recovery" ? "/redefinir-senha" : proximo, url.origin)
    : new URL("/entrar?erro=link", url.origin);
  return NextResponse.redirect(destino);
}
