/**
 * Mede o tempo de resposta das páginas principais (HTML e navegação RSC)
 * com um usuário temporário, que é apagado ao final.
 *
 * Uso: npx tsx scripts/medir-navegacao.ts [https://aprova-mais-ten.vercel.app]
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

try {
  process.loadEnvFile(".env.local");
} catch {
  // variáveis já no ambiente
}

const BASE = process.argv[2] ?? "http://localhost:3000";
const RODADAS = Number(process.argv[3] ?? 4);
const PAGINAS = ["/dashboard", "/cronograma", "/disciplinas", "/biblioteca", "/questoes", "/resolver", "/simulados", "/simulados/gerar",
  "/caderno-erros", "/revisoes", "/flashcards", "/tutor", "/metas", "/relatorios", "/mapa", "/configuracoes"];

const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `medicao-${randomBytes(4).toString("hex")}@teste.invalid`;
  const senha = randomBytes(12).toString("base64url");
  const { data: criado, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome: "Medição" } });
  if (error) throw error;
  const uid = criado.user.id;
  try {
    await admin.from("profiles").update({ onboarding_concluido: true }).eq("id", uid);
    const cookies = new Map<string, string>();
    const ssr = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => cookies.set(c.name, c.value)) },
    });
    const { error: e2 } = await ssr.auth.signInWithPassword({ email, password: senha });
    if (e2) throw e2;
    const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");

    const tempo = async (caminho: string, rsc: boolean) => {
      const t0 = performance.now();
      const r = await fetch(`${BASE}${caminho}`, { headers: { cookie, ...(rsc ? { RSC: "1" } : {}) }, redirect: "manual" });
      await r.arrayBuffer();
      return { ms: performance.now() - t0, status: r.status };
    };

    // Aquecimento (instância fria) e referência de rede.
    for (let i = 0; i < 2; i++) await tempo("/api/health", false);
    const rede = mediana(await Promise.all([0, 1, 2].map(async () => (await tempo("/api/health", false)).ms)));
    console.log(`referência (/api/health): ${rede.toFixed(0)} ms\n`);
    console.log("página".padEnd(20), "navegação (RSC)".padStart(16), "HTML".padStart(10));
    const linhas: { p: string; rsc: number; html: number }[] = [];
    for (const p of PAGINAS) {
      await tempo(p, true); // aquece a rota
      const rsc: number[] = [];
      const html: number[] = [];
      let status = 0;
      for (let i = 0; i < RODADAS; i++) {
        const a = await tempo(p, true);
        rsc.push(a.ms);
        status = a.status;
        html.push((await tempo(p, false)).ms);
      }
      linhas.push({ p, rsc: mediana(rsc), html: mediana(html) });
      console.log(p.padEnd(20), `${mediana(rsc).toFixed(0)} ms`.padStart(16), `${mediana(html).toFixed(0)} ms`.padStart(10), status !== 200 ? `(status ${status})` : "");
    }
    const media = linhas.reduce((s, l) => s + l.rsc, 0) / linhas.length;
    console.log(`\nmédia da navegação: ${media.toFixed(0)} ms`);
  } finally {
    await admin.auth.admin.deleteUser(uid);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
