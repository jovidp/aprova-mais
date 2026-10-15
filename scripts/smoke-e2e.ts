/**
 * Teste de fumaça contra o Supabase real e o servidor em execução.
 * Cria um usuário temporário, percorre as páginas autenticadas e executa o
 * fluxo questão → resposta → simulado → correção. Ao final, apaga o usuário
 * (todos os dados dele são removidos em cascata).
 *
 * Uso: npm run dev (em outro terminal) e depois  npx tsx scripts/smoke-e2e.ts [http://localhost:3000]
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
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SEC = process.env.SUPABASE_SECRET_KEY!;

const PAGINAS = [
  "/dashboard", "/biblioteca", "/biblioteca/importar", "/biblioteca/importacoes", "/questoes", "/questoes?status=pendente_revisao",
  "/questoes/gerar", "/questoes/nova", "/questoes/revisao", "/resolver", "/simulados", "/simulados/gerar", "/simulados/comparar",
  "/caderno-erros", "/revisoes", "/flashcards", "/flashcards/estudar", "/cronograma", "/metas", "/tutor", "/relatorios", "/mapa",
  "/disciplinas", "/configuracoes", "/configuracoes?aba=dados", "/busca?q=constituicao", "/notificacoes",
];

let falhas = 0;
function verificar(condicao: boolean, mensagem: string) {
  console.log(`${condicao ? "✓" : "✗"} ${mensagem}`);
  if (!condicao) falhas++;
}

async function main() {
  const admin = createClient(URL_SB, SEC, { auth: { persistSession: false } });
  const email = `smoke-${randomBytes(4).toString("hex")}@teste.invalid`;
  const senha = randomBytes(12).toString("base64url");
  const { data: criado, error: erroCriacao } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome: "Teste Automático" } });
  if (erroCriacao) throw erroCriacao;
  const uid = criado.user.id;
  console.log(`Usuário temporário ${email}`);

  try {
    // Cookies de sessão exatamente como o app os grava.
    const cookies = new Map<string, string>();
    const ssr = createServerClient(URL_SB, PUB, {
      cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => cookies.set(c.name, c.value)) },
    });
    const { error: erroLogin } = await ssr.auth.signInWithPassword({ email, password: senha });
    if (erroLogin) throw erroLogin;
    const cabecalhoCookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const sb = createClient(URL_SB, PUB, { auth: { persistSession: false } });
    await sb.auth.signInWithPassword({ email, password: senha });

    const perfil = await sb.from("profiles").select("nome, onboarding_concluido").eq("id", uid).single();
    verificar(perfil.data?.nome === "Teste Automático" && perfil.data?.onboarding_concluido === false, "perfil criado pelo gatilho de cadastro");

    const semOnboarding = await fetch(`${BASE}/dashboard`, { headers: { cookie: cabecalhoCookie }, redirect: "manual" });
    verificar(semOnboarding.status === 307 && (semOnboarding.headers.get("location") ?? "").includes("/onboarding"), "sem onboarding, o app redireciona para /onboarding");
    const paginaOnboarding = await fetch(`${BASE}/onboarding`, { headers: { cookie: cabecalhoCookie } });
    verificar(paginaOnboarding.status === 200, "página de onboarding abre");

    // Dados mínimos (como o onboarding faria).
    await sb.from("profiles").update({ onboarding_concluido: true }).eq("id", uid);
    const disc = await sb.from("disciplinas").insert({ owner_id: uid, nome: "Direito Constitucional (teste)", slug: `dc-teste-${randomBytes(3).toString("hex")}` }).select("id").single();
    verificar(!disc.error, "cria disciplina própria");
    await sb.from("usuario_disciplinas").insert({ user_id: uid, disciplina_id: disc.data!.id });
    const assunto = await sb.from("assuntos").insert({ owner_id: uid, disciplina_id: disc.data!.id, nome: "Nacionalidade", slug: "nacionalidade" }).select("id").single();

    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = await sb.rpc("salvar_questao", { p_dados: {
        tipo: "multipla_escolha", enunciado: `Questão de teste ${i}: sobre a nacionalidade brasileira originária, assinale a correta.`, dificuldade: "medio",
        disciplina_id: disc.data!.id, assunto_id: assunto.data!.id, origem: "manual", status: "aprovada", explicacao: "Explicação de teste.",
        alternativas: ["A", "B", "C", "D"].map((l, k) => ({ letra: l, texto: `Alternativa ${l} da questão ${i}`, correta: k === 1, justificativa: `Justificativa ${l}` })),
      } });
      verificar(!r.error, `salvar_questao ${i}${r.error ? `: ${r.error.message}` : ""}`);
      if (r.data) ids.push(r.data as string);
    }

    const gabaritoDireto = await sb.from("questao_gabaritos").select("*").in("questao_id", ids);
    verificar((gabaritoDireto.data ?? []).length === 0, "gabaritos não são legíveis diretamente pelo aluno");

    const alts = await sb.from("alternativas").select("id, letra, questao_id").in("questao_id", ids).order("ordem");
    const altDe = (q: string, letra: string) => alts.data!.find((a) => a.questao_id === q && a.letra === letra)!.id;
    const resp = await sb.rpc("responder_questao", { p_questao_id: ids[0], p_alternativa_id: altDe(ids[0], "A"), p_tempo_seg: 42 });
    verificar(resp.data?.correta === false && resp.data?.alternativa_correta_id === altDe(ids[0], "B"), "responder_questao corrige no servidor e devolve gabarito após responder");
    const caderno = await sb.from("caderno_erros").select("total_erros").eq("questao_id", ids[0]).single();
    verificar(caderno.data?.total_erros === 1, "erro registrado no caderno de erros");

    const sim = await sb.rpc("criar_simulado", { p_dados: { nome: "Simulado de teste", tipo: "disciplina", pontos_acerto: 1, pontos_erro: -1, pontos_branco: 0, nota_nao_negativa: false, tempo_limite_seg: 600 }, p_questoes: ids });
    verificar(!sim.error, `criar_simulado${sim.error ? `: ${sim.error.message}` : ""}`);
    const tentativa = await sb.rpc("iniciar_tentativa", { p_simulado_id: sim.data });
    const prova = await sb.rpc("obter_prova", { p_tentativa_id: tentativa.data });
    verificar(!JSON.stringify(prova.data).includes("explicacao"), "prova servida sem gabarito/explicação");
    await sb.rpc("salvar_resposta_simulado", { p_tentativa_id: tentativa.data, p_questao_id: ids[0], p_alternativa_id: altDe(ids[0], "B"), p_tempo_seg: 30 });
    await sb.rpc("salvar_resposta_simulado", { p_tentativa_id: tentativa.data, p_questao_id: ids[1], p_alternativa_id: altDe(ids[1], "C"), p_tempo_seg: 30 });
    const resultado = await sb.rpc("finalizar_tentativa", { p_tentativa_id: tentativa.data });
    verificar(resultado.data?.acertos === 1 && resultado.data?.erros === 1 && resultado.data?.brancos === 1 && Number(resultado.data?.nota) === 0,
      `pontuação +1/−1/0 → 1 acerto, 1 erro, 1 branco, nota 0 (obtido: ${JSON.stringify({ a: resultado.data?.acertos, e: resultado.data?.erros, b: resultado.data?.brancos, n: resultado.data?.nota })})`);

    const resumo = await sb.rpc("resumo_desempenho", { p_inicio: new Date(Date.now() - 86400000).toISOString().slice(0, 10), p_fim: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
    verificar(resumo.data?.totais?.respondidas === 3, `resumo_desempenho conta 3 respostas (prática + simulado) — obtido ${resumo.data?.totais?.respondidas}`);

    for (const caminho of [...PAGINAS, `/questoes/${ids[0]}`, `/resolver`]) {
      const r = await fetch(`${BASE}${caminho}`, { headers: { cookie: cabecalhoCookie }, redirect: "manual" });
      const corpo = await r.text();
      const erroNoHtml = /Application error|Unhandled Runtime Error|__next_error__/.test(corpo);
      verificar(r.status === 200 && !erroNoHtml, `GET ${caminho} → ${r.status}${erroNoHtml ? " (erro no HTML)" : ""}`);
    }
  } finally {
    const { error } = await admin.auth.admin.deleteUser(uid);
    console.log(error ? `! Falha ao remover usuário temporário: ${error.message}` : "Usuário temporário removido (dados apagados em cascata).");
  }
  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
