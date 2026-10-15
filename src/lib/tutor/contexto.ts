import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FonteTutor {
  indice: number;
  materialId: string;
  titulo: string;
  pagina: number;
  secao: string | null;
  trecho: string;
}

export const SISTEMA_TUTOR = `Você é um tutor de estudos para concursos públicos brasileiros. Responda em português do Brasil, de forma didática e precisa.

Regras:
1. Priorize os trechos dos materiais do aluno fornecidos em <fontes>. Cite as fontes no texto como [1], [2]... correspondendo aos números das fontes.
2. Se as fontes não cobrirem a pergunta, diga claramente que o material importado não trata do tema. Você pode dar uma explicação geral, deixando explícito que ela não vem do material.
3. Nunca invente artigos de lei, números de lei, súmulas, julgados ou referências. Se não tiver certeza de um dispositivo, diga isso.
4. Em temas jurídicos, diferencie o que está no material (com a data do material, se houver) de possíveis alterações legislativas ou jurisprudenciais posteriores, que o aluno deve conferir em fonte oficial.
5. Use exemplos curtos quando ajudarem. Termine com uma sugestão prática de estudo quando fizer sentido (questões, revisão de páginas específicas).
6. Formate com parágrafos curtos e listas quando útil. Não use tabelas grandes.`;

const MAX_CARACTERES_FONTE = 2600;
const MAX_TOTAL = 16000;

function recortar(texto: string, max: number) {
  const limpo = texto.replace(/\s+\n/g, "\n").trim();
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo;
}

/** Trechos relevantes por busca textual (português, sem acento). */
export async function recuperarFontes(supabase: SupabaseClient, consulta: string, filtros: { materialIds?: string[]; assuntoIds?: string[] } = {}): Promise<FonteTutor[]> {
  const { data, error } = await supabase.rpc("buscar_trechos", {
    p_consulta: consulta.slice(0, 500), p_material_ids: filtros.materialIds?.length ? filtros.materialIds : null,
    p_assunto_ids: filtros.assuntoIds?.length ? filtros.assuntoIds : null, p_limite: 6,
  });
  if (error) throw error;
  let total = 0;
  const fontes: FonteTutor[] = [];
  for (const r of (data ?? []) as { material_id: string; material_titulo: string; pagina: number; texto: string; secao_titulo: string | null }[]) {
    const trecho = recortar(r.texto, MAX_CARACTERES_FONTE);
    if (total + trecho.length > MAX_TOTAL) break;
    total += trecho.length;
    fontes.push({ indice: fontes.length + 1, materialId: r.material_id, titulo: r.material_titulo, pagina: r.pagina, secao: r.secao_titulo, trecho });
  }
  return fontes;
}

/** "Resuma a aula 04": usa o início de cada seção de teoria da aula. */
export async function fontesDaAula(supabase: SupabaseClient, userId: string, aula: number, disciplinaId?: string | null): Promise<FonteTutor[]> {
  let consulta = supabase.from("materiais").select("id, titulo").eq("user_id", userId).eq("aula_numero", aula).eq("status", "processado");
  if (disciplinaId) consulta = consulta.eq("disciplina_id", disciplinaId);
  const { data: materiais } = await consulta.limit(3);
  if (!materiais?.length) return [];
  const m = materiais[0];
  const { data: secoes } = await supabase.from("material_secoes").select("titulo, pagina_inicio, pagina_fim").eq("material_id", m.id).in("tipo", ["teoria", "resumo"]).order("ordem");
  const fontes: FonteTutor[] = [];
  let total = 0;
  const porSecao = Math.max(800, Math.floor(MAX_TOTAL / Math.max(1, secoes?.length ?? 1)));
  for (const s of secoes ?? []) {
    const { data: paginas } = await supabase.from("material_paginas").select("numero, texto").eq("material_id", m.id)
      .gte("numero", s.pagina_inicio).lte("numero", Math.min(s.pagina_fim, s.pagina_inicio + 2)).order("numero");
    const texto = recortar((paginas ?? []).map((p) => p.texto).join("\n"), porSecao);
    if (!texto || total + texto.length > MAX_TOTAL) continue;
    total += texto.length;
    fontes.push({ indice: fontes.length + 1, materialId: m.id, titulo: m.titulo, pagina: s.pagina_inicio, secao: s.titulo, trecho: texto });
  }
  return fontes;
}

export function blocoFontes(fontes: FonteTutor[]) {
  if (!fontes.length) return "<fontes>\n(nenhum trecho dos materiais do aluno foi encontrado para esta pergunta)\n</fontes>";
  return `<fontes>\n${fontes.map((f) => `<fonte numero="${f.indice}" material="${f.titulo.replace(/"/g, "'")}" pagina="${f.pagina}"${f.secao ? ` secao="${f.secao.replace(/"/g, "'")}"` : ""}>\n${f.trecho}\n</fonte>`).join("\n")}\n</fontes>`;
}

/** Contexto de uma questão (enunciado, alternativas e, se já respondida, a correção). */
export async function contextoQuestao(supabase: SupabaseClient, userId: string, questaoId: string): Promise<string | null> {
  const { data: q } = await supabase.from("questoes").select("enunciado, texto_apoio, alternativas(id, letra, texto, ordem)").eq("id", questaoId).maybeSingle();
  if (!q) return null;
  const alts = [...(q.alternativas as { id: string; letra: string; texto: string; ordem: number }[])].sort((a, b) => a.ordem - b.ordem);
  const { data: ultima } = await supabase.from("respostas_usuario").select("alternativa_id, correta").eq("questao_id", questaoId).eq("user_id", userId).order("tentativa_numero", { ascending: false }).limit(1).maybeSingle();
  let correcao = "";
  if (ultima) {
    const { data: c } = await supabase.rpc("obter_correcao_questao", { p_questao_id: questaoId });
    const g = c as { alternativa_correta_id: string; explicacao: string } | null;
    if (g) {
      correcao = `\nResposta do aluno: ${alts.find((a) => a.id === ultima.alternativa_id)?.letra ?? "—"} (${ultima.correta ? "acertou" : "errou"}).` +
        `\nGabarito: ${alts.find((a) => a.id === g.alternativa_correta_id)?.letra}.\nComentário do gabarito: ${g.explicacao}`;
    }
  }
  return `<questao>\n${q.texto_apoio ? `${q.texto_apoio}\n` : ""}${q.enunciado}\n${alts.map((a) => `${a.letra}) ${a.texto}`).join("\n")}${correcao}\n</questao>`;
}

export const SISTEMA_ESTUDO = `${SISTEMA_TUTOR}

Modo estudo junto: o aluno está lendo um PDF e conversa com você enquanto estuda, muitas vezes por voz.
- Responda como numa conversa: curto e direto (até ~120 palavras), salvo se ele pedir mais detalhes. Evite tabelas e listas longas.
- A fonte marcada como pagina_atual é o que ele está lendo agora; parta dela.
- Se ele pedir para ser testado ("me pergunta", "me testa"), faça UMA pergunta por vez, espere a resposta e corrija com gentileza, citando a página.
- Incentive o aluno a explicar com as próprias palavras e aponte o que ficou faltando.`;

/** Página atual e vizinhas de um material, como fontes prioritárias. */
export async function fontesDaPagina(supabase: SupabaseClient, materialId: string, pagina: number): Promise<FonteTutor[]> {
  const [{ data: material }, { data: paginas }] = await Promise.all([
    supabase.from("materiais").select("titulo").eq("id", materialId).maybeSingle(),
    supabase.from("material_paginas").select("numero, texto").eq("material_id", materialId).gte("numero", pagina - 1).lte("numero", pagina + 1).order("numero"),
  ]);
  if (!material) return [];
  // A página atual primeiro; as vizinhas ajudam quando o assunto atravessa a quebra de página.
  const ordenadas = [...(paginas ?? [])].sort((a, b) => Math.abs(a.numero - pagina) - Math.abs(b.numero - pagina));
  return ordenadas
    .filter((p) => (p.texto ?? "").trim().length > 40)
    .map((p, i) => ({ indice: i + 1, materialId, titulo: material.titulo, pagina: p.numero, secao: p.numero === pagina ? "pagina_atual" : null, trecho: recortar(p.texto, p.numero === pagina ? 5000 : 2000) }));
}
