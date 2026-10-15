import { obterUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";

export const maxDuration = 60;

// Tabelas exportadas (somente linhas do próprio usuário, via RLS).
const TABELAS: [tabela: string, coluna: string][] = [
  ["profiles", "id"], ["preferencias_usuario", "user_id"], ["usuario_disciplinas", "user_id"], ["materiais", "user_id"],
  ["material_secoes", "user_id"], ["anotacoes", "user_id"], ["progresso_leitura", "user_id"], ["questoes", "owner_id"],
  ["respostas_usuario", "user_id"], ["caderno_erros", "user_id"], ["favoritos", "user_id"], ["resultados_externos", "user_id"],
  ["simulados", "user_id"], ["simulados_tentativas", "user_id"], ["simulados_resultados", "user_id"], ["cronogramas", "user_id"],
  ["disponibilidade_semanal", "user_id"], ["atividades_planejadas", "user_id"], ["sessoes_estudo", "user_id"], ["metas", "user_id"],
  ["revisoes", "user_id"], ["revisao_historico", "user_id"], ["flashcards", "user_id"], ["tutor_conversas", "user_id"],
  ["tutor_mensagens", "user_id"], ["relatorios", "user_id"], ["processamentos_ia", "user_id"],
];

export async function GET() {
  const usuario = await obterUsuario();
  if (!usuario) return new Response("Não autenticado", { status: 401 });
  const supabase = await clienteServidor();
  const dados: Record<string, unknown> = { exportado_em: new Date().toISOString(), usuario: { id: usuario.id, email: usuario.email } };
  for (const [tabela, coluna] of TABELAS) {
    const linhas: unknown[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from(tabela).select("*").eq(coluna, usuario.id).range(de, de + 999);
      if (error) { dados[`${tabela}_erro`] = error.message; break; }
      linhas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    dados[tabela] = linhas;
  }
  // Texto das páginas é omitido (é extraído dos PDFs, que ficam no Storage).
  return new Response(JSON.stringify(dados, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="aprova-mais-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
