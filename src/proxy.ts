import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ipDoCliente } from "@/lib/rede/ip";

// Resultado da consulta de bloqueio por IP, em cache por instância (1 min).
const cacheBloqueio = new Map<string, { bloqueado: boolean; ate: number }>();

async function ipEstaBloqueado(ip: string, url: string, chave: string) {
  const agora = Date.now();
  const salvo = cacheBloqueio.get(ip);
  if (salvo && salvo.ate > agora) return salvo.bloqueado;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/ip_bloqueado`, {
      method: "POST",
      headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: ip }),
      signal: AbortSignal.timeout(2500),
    });
    const bloqueado = r.ok ? (await r.json()) === true : false;
    if (cacheBloqueio.size > 5000) cacheBloqueio.clear();
    cacheBloqueio.set(ip, { bloqueado, ate: agora + 60_000 });
    return bloqueado;
  } catch {
    // Falha na consulta não derruba o site; tenta de novo na próxima requisição.
    return false;
  }
}

const PAGINA_BLOQUEIO = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso bloqueado</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0"><main style="text-align:center;padding:24px"><h1 style="font-size:22px">Acesso bloqueado</h1><p>O acesso a esta plataforma foi bloqueado para a sua conexão.</p></main></body></html>`;

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

  // IP banido: consulta iniciada em paralelo com a verificação da sessão.
  const ip = ipDoCliente(request.headers);
  const consultaBloqueio = ip ? ipEstaBloqueado(ip, url, chave) : Promise.resolve(false);

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

  // Bloqueia tudo para IP banido (inclusive login e cadastro).
  if (await consultaBloqueio) {
    return caminho.startsWith("/api/")
      ? NextResponse.json({ erro: "Acesso bloqueado." }, { status: 403 })
      : new NextResponse(PAGINA_BLOQUEIO, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

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
