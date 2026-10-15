import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  gerarCronograma, proporRealocacao, type AtividadeGerada, type DisciplinaPlano, type Intervalo,
  type JanelaDisponibilidade, type RevisaoPendente, type TrechoConteudo,
} from "@/lib/estudo/cronograma";
import { dataLocal, somarDias } from "@/lib/estudo/tempo";

export interface ContextoAgenda {
  fuso: string;
  janelas: JanelaDisponibilidade[];
  diasDescanso: number[];
  bloqueios: Intervalo[];
}

export async function carregarContextoAgenda(supabase: SupabaseClient, userId: string): Promise<ContextoAgenda> {
  const [pref, disp, bloq] = await Promise.all([
    supabase.from("preferencias_usuario").select("fuso_horario, dias_descanso").eq("user_id", userId).maybeSingle(),
    supabase.from("disponibilidade_semanal").select("dia_semana, inicio_min, fim_min").eq("user_id", userId),
    supabase.from("bloqueios_agenda").select("inicio, fim").eq("user_id", userId).gte("fim", new Date().toISOString()),
  ]);
  if (disp.error) throw disp.error;
  return {
    fuso: pref.data?.fuso_horario ?? "America/Sao_Paulo",
    diasDescanso: pref.data?.dias_descanso ?? [],
    janelas: (disp.data ?? []).map((j) => ({ diaSemana: j.dia_semana, inicioMin: j.inicio_min, fimMin: j.fim_min })),
    bloqueios: (bloq.data ?? []).map((b) => ({ inicio: new Date(b.inicio), fim: new Date(b.fim) })),
  };
}

/** Próximos trechos não lidos das seções de teoria, na ordem das aulas. */
async function filaDeConteudo(supabase: SupabaseClient, userId: string): Promise<TrechoConteudo[]> {
  const [{ data: secoes, error }, { data: progresso }] = await Promise.all([
    supabase
      .from("material_secoes")
      .select("material_id, assunto_id, titulo, pagina_inicio, pagina_fim, ordem, tipo, materiais!inner(disciplina_id, aula_numero, titulo, status)")
      .eq("user_id", userId)
      .in("tipo", ["teoria", "resumo"])
      .limit(3000),
    supabase.from("progresso_leitura").select("material_id, paginas_lidas").eq("user_id", userId),
  ]);
  if (error) throw error;
  const lidas = new Map((progresso ?? []).map((p) => [p.material_id as string, new Set<number>(p.paginas_lidas as number[])]));

  type Linha = { material_id: string; assunto_id: string | null; titulo: string; pagina_inicio: number; pagina_fim: number; ordem: number;
    materiais: { disciplina_id: string | null; aula_numero: number | null; titulo: string; status: string } };
  return ((secoes ?? []) as unknown as Linha[])
    .filter((s) => s.materiais.disciplina_id && s.materiais.status === "processado")
    .sort((a, b) => (a.materiais.aula_numero ?? 999) - (b.materiais.aula_numero ?? 999) || a.ordem - b.ordem)
    .flatMap((s) => {
      const conjunto = lidas.get(s.material_id);
      let inicio = s.pagina_inicio;
      while (inicio <= s.pagina_fim && conjunto?.has(inicio)) inicio++;
      if (inicio > s.pagina_fim) return [];
      const aula = s.materiais.aula_numero !== null ? `Aula ${String(s.materiais.aula_numero).padStart(2, "0")} — ` : "";
      return [{
        disciplinaId: s.materiais.disciplina_id!, materialId: s.material_id, assuntoId: s.assunto_id,
        titulo: `${aula}${s.titulo}`, paginaInicio: inicio, paginaFim: s.pagina_fim,
      }];
    });
}

async function disciplinasDoPlano(supabase: SupabaseClient, userId: string): Promise<DisciplinaPlano[]> {
  const [{ data: ud, error }, { data: dominio }] = await Promise.all([
    supabase.from("usuario_disciplinas").select("disciplina_id, dificuldade, prioridade, peso, ativa, disciplinas(nome)").eq("user_id", userId).eq("ativa", true),
    supabase.rpc("dados_dominio"),
  ]);
  if (error) throw error;
  const porDisciplina = new Map<string, { r: number; a: number }>();
  for (const l of (dominio ?? []) as { disciplina_id: string | null; respondidas: number; acertos: number }[]) {
    if (!l.disciplina_id) continue;
    const atual = porDisciplina.get(l.disciplina_id) ?? { r: 0, a: 0 };
    porDisciplina.set(l.disciplina_id, { r: atual.r + Number(l.respondidas), a: atual.a + Number(l.acertos) });
  }
  return ((ud ?? []) as unknown as { disciplina_id: string; dificuldade: number; prioridade: number; peso: number; disciplinas: { nome: string } }[])
    .map((d) => {
      const ev = porDisciplina.get(d.disciplina_id);
      return {
        id: d.disciplina_id, nome: d.disciplinas?.nome ?? "Disciplina", peso: Number(d.peso),
        dificuldade: d.dificuldade, prioridade: d.prioridade,
        // Só usa a taxa com evidência mínima (10 respostas).
        taxaAcerto: ev && ev.r >= 10 ? ev.a / ev.r : null,
      };
    });
}

export interface ResultadoRegeneracao {
  criadas: number;
  removidas: number;
  semDisponibilidade: boolean;
}

/**
 * Regera as atividades futuras do gerador. Preserva atividades concluídas,
 * em andamento e manuais (que viram horários ocupados).
 */
export async function regenerarCronograma(supabase: SupabaseClient, userId: string, dias = 14): Promise<ResultadoRegeneracao> {
  const agora = new Date();
  const ctx = await carregarContextoAgenda(supabase, userId);
  if (ctx.janelas.length === 0) return { criadas: 0, removidas: 0, semDisponibilidade: true };

  let { data: cronograma } = await supabase.from("cronogramas").select("id, data_fim, concurso_id").eq("user_id", userId).eq("ativo", true).maybeSingle();
  if (!cronograma) {
    const novo = await supabase.from("cronogramas").insert({ user_id: userId, nome: "Meu cronograma" }).select("id, data_fim, concurso_id").single();
    if (novo.error) throw novo.error;
    cronograma = novo.data;
  }
  const { data: perfil } = await supabase.from("profiles").select("data_prova").eq("id", userId).maybeSingle();

  const removidas = await supabase
    .from("atividades_planejadas")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("origem", "gerador")
    .eq("status", "planejada")
    .gt("inicio", agora.toISOString());
  if (removidas.error) throw removidas.error;

  const hoje = dataLocal(agora, ctx.fuso);
  const limite = somarDias(hoje, dias);
  const [ocupadas, revisoes, disciplinas, conteudo] = await Promise.all([
    supabase.from("atividades_planejadas").select("inicio, fim").eq("user_id", userId)
      .in("status", ["planejada", "em_andamento"]).gte("fim", agora.toISOString()),
    supabase.from("revisoes").select("id, titulo, assunto_id, assuntos(disciplina_id)").eq("user_id", userId)
      .eq("status", "ativa").lte("proxima_em", limite).order("proxima_em").limit(200),
    disciplinasDoPlano(supabase, userId),
    filaDeConteudo(supabase, userId),
  ]);
  if (ocupadas.error) throw ocupadas.error;

  const pendentes: RevisaoPendente[] = ((revisoes.data ?? []) as unknown as { id: string; titulo: string; assunto_id: string | null; assuntos: { disciplina_id: string } | null }[])
    .map((r) => ({ id: r.id, titulo: r.titulo, assuntoId: r.assunto_id, disciplinaId: r.assuntos?.disciplina_id ?? null }));

  const atividades = gerarCronograma({
    dataInicio: hoje, dias, fuso: ctx.fuso, agora, janelas: ctx.janelas, diasDescanso: ctx.diasDescanso,
    bloqueios: ctx.bloqueios,
    ocupados: (ocupadas.data ?? []).map((o) => ({ inicio: new Date(o.inicio), fim: new Date(o.fim) })),
    disciplinas, conteudo, revisoes: pendentes, dataProva: perfil?.data_prova ?? null,
  });

  if (atividades.length > 0) {
    const { error } = await supabase.from("atividades_planejadas").insert(atividades.map((a) => linhaAtividade(a, userId, cronograma!.id)));
    if (error) throw error;
  }
  return { criadas: atividades.length, removidas: removidas.count ?? 0, semDisponibilidade: false };
}

export function linhaAtividade(a: AtividadeGerada, userId: string, cronogramaId: string | null, origem = "gerador") {
  return {
    user_id: userId, cronograma_id: cronogramaId, tipo: a.tipo, titulo: a.titulo.slice(0, 200), descricao: a.descricao ?? null,
    disciplina_id: a.disciplinaId, assunto_id: a.assuntoId, material_id: a.materialId,
    pagina_inicio: a.paginaInicio, pagina_fim: a.paginaFim, quantidade_questoes: a.quantidadeQuestoes,
    inicio: a.inicio.toISOString(), fim: a.fim.toISOString(), prioridade: a.prioridade, origem,
  };
}

/** Marca atividades vencidas como não realizadas e cria propostas de realocação. */
export async function processarPendencias(supabase: SupabaseClient, userId: string): Promise<number> {
  const agora = new Date();
  const { data: vencidas, error } = await supabase
    .from("atividades_planejadas").select("id, inicio, fim, titulo, prioridade")
    .eq("user_id", userId).eq("status", "planejada").lt("fim", agora.toISOString()).limit(50);
  if (error) throw error;
  if (!vencidas?.length) return 0;

  const ctx = await carregarContextoAgenda(supabase, userId);
  const { data: ocupadas } = await supabase.from("atividades_planejadas").select("inicio, fim").eq("user_id", userId)
    .in("status", ["planejada", "em_andamento"]).gte("fim", agora.toISOString());
  const { data: propostasAbertas } = await supabase.from("replanejamentos").select("proposta_inicio, proposta_fim").eq("user_id", userId).eq("status", "pendente");
  const ocupados: Intervalo[] = [...(ocupadas ?? []), ...(propostasAbertas ?? []).map((p) => ({ inicio: p.proposta_inicio, fim: p.proposta_fim }))]
    .map((o) => ({ inicio: new Date(o.inicio), fim: new Date(o.fim) }));

  let criadas = 0;
  // Mais prioritárias primeiro ficam com os horários mais próximos.
  for (const v of [...vencidas].sort((a, b) => b.prioridade - a.prioridade)) {
    await supabase.from("atividades_planejadas").update({ status: "nao_realizada" }).eq("id", v.id);
    const proposta = proporRealocacao(
      { inicio: new Date(v.inicio), fim: new Date(v.fim) },
      { dataInicio: dataLocal(agora, ctx.fuso), dias: 14, fuso: ctx.fuso, agora, janelas: ctx.janelas, diasDescanso: ctx.diasDescanso, bloqueios: ctx.bloqueios, ocupados },
    );
    if (!proposta) continue;
    ocupados.push(proposta);
    const { error: e } = await supabase.from("replanejamentos").insert({
      user_id: userId, atividade_id: v.id, motivo: "Atividade não realizada no horário planejado",
      proposta_inicio: proposta.inicio.toISOString(), proposta_fim: proposta.fim.toISOString(),
    });
    if (!e) criadas++;
  }
  return criadas;
}
