import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestaoExibicao } from "@/lib/questoes/exibicao";

interface LinhaQuestao {
  id: string;
  tipo: "multipla_escolha" | "certo_errado";
  enunciado: string;
  texto_apoio: string | null;
  dificuldade: string;
  origem: string;
  ano: number | null;
  possivelmente_desatualizada: boolean;
  disciplinas: { nome: string } | null;
  assuntos: { nome: string } | null;
  subassuntos: { nome: string } | null;
  banca_estilo: { sigla: string } | null;
  banca_oficial: { sigla: string } | null;
  alternativas: { id: string; letra: string; texto: string; ordem: number }[];
}

/** Questões visíveis (RLS) prontas para exibição, na ordem dos ids pedidos. Nunca inclui gabarito. */
export async function carregarQuestoesExibicao(supabase: SupabaseClient, ids: string[]): Promise<QuestaoExibicao[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("questoes")
    .select("id, tipo, enunciado, texto_apoio, dificuldade, origem, ano, possivelmente_desatualizada, disciplinas(nome), assuntos(nome), subassuntos(nome), banca_estilo:bancas!questoes_banca_estilo_id_fkey(sigla), banca_oficial:bancas!questoes_banca_oficial_id_fkey(sigla), alternativas(id, letra, texto, ordem)")
    .in("id", ids);
  if (error) throw error;
  const porId = new Map(((data ?? []) as unknown as LinhaQuestao[]).map((q) => [q.id, q]));
  return ids.flatMap((id) => {
    const q = porId.get(id);
    if (!q) return [];
    return [{
      id: q.id, tipo: q.tipo, enunciado: q.enunciado, texto_apoio: q.texto_apoio, dificuldade: q.dificuldade, origem: q.origem,
      ano: q.ano, possivelmente_desatualizada: q.possivelmente_desatualizada,
      disciplina: q.disciplinas?.nome ?? null, assunto: q.assuntos?.nome ?? null, subassunto: q.subassuntos?.nome ?? null,
      banca_estilo: q.banca_estilo?.sigla ?? null, banca_oficial: q.banca_oficial?.sigla ?? null,
      alternativas: [...q.alternativas].sort((a, b) => a.ordem - b.ordem).map(({ id: aid, letra, texto }) => ({ id: aid, letra, texto })),
    }];
  });
}
