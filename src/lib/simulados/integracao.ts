import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analisarResultado, type ResultadoProva } from "./analise";
import { dataLocal, somarDias } from "@/lib/estudo/tempo";

export interface Recomendacao {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  material_id: string | null;
  pagina_inicio: number | null;
  pagina_fim: number | null;
  assunto_id: string | null;
  status: string;
}

/**
 * Integra o resultado do simulado ao restante da plataforma (uma única vez por tentativa):
 * - desempenho, mapa de conhecimento e caderno de erros já são atualizados pelo banco;
 * - agenda revisões para os assuntos críticos (sem duplicar);
 * - recomenda as páginas dos PDFs que tratam desses assuntos;
 * - recomenda exercícios complementares;
 * - sugere ajuste no cronograma (aplicado só quando o aluno aceitar).
 */
export async function integrarResultado(supabase: SupabaseClient, userId: string, tentativaId: string): Promise<Recomendacao[]> {
  const existentes = await supabase.from("recomendacoes").select("*").eq("user_id", userId).eq("origem_tipo", "simulado").eq("origem_id", tentativaId);
  if ((existentes.data ?? []).length > 0) return existentes.data as Recomendacao[];

  const { data: resultado } = await supabase.from("simulados_resultados").select("*").eq("tentativa_id", tentativaId).eq("user_id", userId).maybeSingle();
  if (!resultado) return [];
  const analise = analisarResultado(resultado as unknown as ResultadoProva);
  const { data: pref } = await supabase.from("preferencias_usuario").select("fuso_horario").eq("user_id", userId).maybeSingle();
  const amanha = somarDias(dataLocal(new Date(), pref?.fuso_horario ?? "America/Sao_Paulo"), 1);

  const linhas: Record<string, unknown>[] = [];
  for (const c of analise.criticos.slice(0, 5)) {
    await supabase.rpc("agendar_revisao_assunto", { p_assunto_id: c.id, p_titulo: c.nome, p_data: amanha, p_origem: "simulado" });
    const evidencias = { acertos: c.acertos, total: c.total, percentual: Math.round(c.percentual * 10) / 10 };

    const { data: secoes } = await supabase.from("material_secoes")
      .select("material_id, pagina_inicio, pagina_fim, titulo, materiais!inner(titulo, aula_numero)")
      .eq("user_id", userId).eq("assunto_id", c.id).in("tipo", ["teoria", "resumo"]).order("pagina_inicio").limit(3);
    for (const s of (secoes ?? []) as unknown as { material_id: string; pagina_inicio: number; pagina_fim: number; titulo: string; materiais: { titulo: string } }[]) {
      linhas.push({
        user_id: userId, tipo: "revisar_material", prioridade: 5, assunto_id: c.id, disciplina_id: c.disciplinaId,
        titulo: `Revisar: ${s.titulo}`, descricao: `${s.materiais.titulo}, páginas ${s.pagina_inicio}–${s.pagina_fim}. Você acertou ${c.acertos} de ${c.total} questões de ${c.nome} neste simulado.`,
        material_id: s.material_id, pagina_inicio: s.pagina_inicio, pagina_fim: s.pagina_fim,
        origem_tipo: "simulado", origem_id: tentativaId, evidencias,
      });
    }
    linhas.push({
      user_id: userId, tipo: "resolver_questoes", prioridade: 4, assunto_id: c.id, disciplina_id: c.disciplinaId,
      titulo: `Resolver ${c.questoesRecomendadas} questões de ${c.nome}`,
      descricao: `Acerto de ${evidencias.percentual}% (${c.acertos}/${c.total}) neste simulado. Uma revisão foi agendada para amanhã.`,
      origem_tipo: "simulado", origem_id: tentativaId, evidencias: { ...evidencias, quantidade: c.questoesRecomendadas },
    });
  }
  if (analise.criticos.length > 0) {
    linhas.push({
      user_id: userId, tipo: "ajuste_cronograma", prioridade: 3,
      titulo: "Reorganizar o cronograma com base neste simulado",
      descricao: `Dar mais tempo a: ${analise.criticos.slice(0, 3).map((c) => c.nome).join(", ")}. As atividades futuras são recalculadas respeitando sua disponibilidade; estudos concluídos não mudam.`,
      origem_tipo: "simulado", origem_id: tentativaId, evidencias: { criticos: analise.criticos.map((c) => c.id) },
    });
  }
  if (linhas.length === 0) {
    linhas.push({
      user_id: userId, tipo: "fazer_simulado", prioridade: 2, titulo: "Manter o ritmo com um novo simulado",
      descricao: "Nenhum assunto ficou abaixo de 60% (com ao menos duas questões). Um simulado adaptativo ajuda a confirmar o domínio.",
      origem_tipo: "simulado", origem_id: tentativaId, evidencias: { percentual: resultado.percentual_acerto_total },
    });
  }
  const { data: criadas } = await supabase.from("recomendacoes").insert(linhas).select("*");
  await supabase.from("notificacoes").insert({
    user_id: userId, tipo: "simulado", titulo: "Simulado corrigido",
    mensagem: `Você acertou ${resultado.acertos} de ${resultado.total}. ${analise.criticos.length ? `${analise.criticos.length} assunto(s) para reforçar.` : "Bom resultado!"}`,
    link: `/simulados/resultado/${tentativaId}`,
  });
  return (criadas ?? []) as Recomendacao[];
}
