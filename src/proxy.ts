import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const ROTAS_PUBLICAS = ["/entrar", "/cadastro", "/recuperar-senha", "/auth", "/api/health", "/api/cron", "/offline", "/configuracao-pendente"];

function rotaPublica(caminho: string) {
  return caminho === "/" || ROTAS_PUBLICAS.some((r) => caminho === r || caminho.startsWith(`${r}/`));
}

/**
 * Renova a sessão do Supabase a cada requisição e protege as rotas internas.
 * A autorização definitiva acontece no servidor (getClaims) e no banco (RLS).
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const caminho = request.nextUrl.pathname;

  if (!url || !chave) {
    if (caminho.startsWith("/configuracao-pendente") || caminho.startsWith("/api/health")) return NextResponse.next();
    return NextResponse.redirect(new URL("/configuracao-pendente", request.url));
  }

  let resposta = NextResponse.next({ request });
  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) request.cookies.set(name, value);
        resposta = NextResponse.next({ request });
        for (const { name, value, options } of lista) resposta.cookies.set(name, value, options);
      },
    },
  });

  // Não coloque código entre a criação do cliente e getClaims(): a renovação depende disso.
  const { data } = await supabase.auth.getClaims();
  const logado = Boolean(data?.claims?.sub);

  if (!logado && !rotaPublica(caminho)) {
    const destino = new URL("/entrar", request.url);
    destino.searchParams.set("voltar", caminho + request.nextUrl.search);
    return NextResponse.redirect(destino);
  }
  if (logado && (caminho === "/entrar" || caminho === "/cadastro" || caminho === "/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return resposta;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|pdf.worker.min.mjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
