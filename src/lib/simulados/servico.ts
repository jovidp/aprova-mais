import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroApp } from "@/lib/erros";
import { pesosAdaptativos, selecionarQuestoes, type Candidata, type ConfigSelecao } from "./selecao";
import { TIPOS_SIMULADO, type ConfigSimulado } from "./config";

export interface DeficitNomeado {
  grupoId: string;
  nome: string;
  faltam: number;
  /** Para gerar com IA: filtro de disciplina/assunto correspondente. */
  disciplinaId: string | null;
  assuntoId: string | null;
}

export interface PlanoSimulado {
  ids: string[];
  pedido: number;
  disponiveis: number;
  deficits: DeficitNomeado[];
  distribuicao: { nome: string; quantidade: number }[];
  observacoes: string[];
}

/**
 * Funções que dependem do usuário são passadas explicitamente, para que o
 * mesmo planejamento sirva ao aluno (cliente com sessão) e às rotinas
 * agendadas (cliente administrativo).
 */
export interface FonteDados {
  supabase: SupabaseClient;
  userId: string;
  candidatas: (filtros: Record<string, unknown>) => Promise<Candidata[]>;
}

async function assuntosEstudadosDesde(f: FonteDados, desde: Date, ate?: Date): Promise<string[]> {
  let q1 = f.supabase.from("respostas_usuario").select("assunto_id").eq("user_id", f.userId).gte("created_at", desde.toISOString()).not("assunto_id", "is", null).limit(5000);
  let q2 = f.supabase.from("sessoes_estudo").select("assunto_id").eq("user_id", f.userId).gte("inicio", desde.toISOString()).not("assunto_id", "is", null).limit(5000);
  let q3 = f.supabase.from("atividades_planejadas").select("assunto_id").eq("user_id", f.userId).in("status", ["concluida", "parcial"]).gte("inicio", desde.toISOString()).not("assunto_id", "is", null).limit(5000);
  if (ate) {
    q1 = q1.lt("created_at", ate.toISOString());
    q2 = q2.lt("inicio", ate.toISOString());
    q3 = q3.lt("inicio", ate.toISOString());
  }
  const [r1, r2, r3] = await Promise.all([q1, q2, q3]);
  return [...new Set([...(r1.data ?? []), ...(r2.data ?? []), ...(r3.data ?? [])].map((r) => r.assunto_id as string))];
}

async function taxasPorAssunto(f: FonteDados, assuntos: string[]): Promise<Record<string, number | null>> {
  const { data } = await f.supabase.from("historico_desempenho").select("assunto_id, respondidas, acertos").eq("user_id", f.userId).in("assunto_id", assuntos);
  const soma = new Map<string, { r: number; a: number }>();
  for (const l of data ?? []) {
    const atual = soma.get(l.assunto_id) ?? { r: 0, a: 0 };
    soma.set(l.assunto_id, { r: atual.r + l.respondidas, a: atual.a + l.acertos });
  }
  // Taxa só com pelo menos 5 respostas; abaixo disso, neutro.
  return Object.fromEntries(assuntos.map((a) => {
    const s = soma.get(a);
    return [a, s && s.r >= 5 ? s.a / s.r : null];
  }));
}

export async function planejarSimulado(f: FonteDados, c: ConfigSimulado): Promise<PlanoSimulado> {
  const observacoes: string[] = [];
  const filtros: Record<string, unknown> = { tipos: c.tipos };
  let agruparPor: ConfigSelecao["agruparPor"] = "assunto";
  let pesos: Record<string, number> = {};
  let modo: ConfigSelecao["modo"] = c.somenteIneditas || !c.incluirRespondidas ? "ineditas" : "todas";
  let dificuldades = c.dificuldades;

  const disciplinasAtivas = async () => {
    const { data } = await f.supabase.from("usuario_disciplinas").select("disciplina_id, peso, prioridade").eq("user_id", f.userId).eq("ativa", true);
    return data ?? [];
  };

  switch (c.tipo) {
    case "geral": {
      const ativas = await disciplinasAtivas();
      const escolhidas = c.disciplinaIds.length ? ativas.filter((d) => c.disciplinaIds.includes(d.disciplina_id)) : ativas;
      const ids = c.disciplinaIds.length ? c.disciplinaIds : escolhidas.map((d) => d.disciplina_id);
      filtros.disciplina_ids = ids;
      agruparPor = "disciplina";
      pesos = Object.fromEntries(ids.map((id) => [id, Number(escolhidas.find((d) => d.disciplina_id === id)?.peso ?? 1)]));
      break;
    }
    case "disciplina":
      if (!c.disciplinaIds.length) throw new ErroApp("Escolha a disciplina do simulado.");
      filtros.disciplina_ids = c.disciplinaIds;
      if (c.assuntoIds.length) filtros.assunto_ids = c.assuntoIds;
      break;
    case "assunto":
      if (!c.assuntoIds.length) throw new ErroApp("Escolha ao menos um assunto.");
      filtros.assunto_ids = c.assuntoIds;
      pesos = Object.fromEntries(c.assuntoIds.map((a) => [a, 1]));
      break;
    case "erros":
      modo = "erros";
      if (c.disciplinaIds.length) filtros.disciplina_ids = c.disciplinaIds;
      if (c.assuntoIds.length) filtros.assunto_ids = c.assuntoIds;
      break;
    case "adaptativo": {
      if (c.disciplinaIds.length) filtros.disciplina_ids = c.disciplinaIds;
      const candidatas = await f.candidatas(filtros);
      const assuntos = [...new Set(candidatas.map((q) => q.assunto_id).filter((a): a is string => Boolean(a)))];
      pesos = pesosAdaptativos(await taxasPorAssunto(f, assuntos));
      observacoes.push("Distribuição ponderada pelo seu desempenho: assuntos com menor acerto recebem mais questões.");
      break;
    }
    case "banca":
      if (!c.bancaId) throw new ErroApp("Escolha a banca.");
      filtros.banca_id = c.bancaId;
      if (c.disciplinaIds.length) filtros.disciplina_ids = c.disciplinaIds;
      agruparPor = "disciplina";
      observacoes.push("Questões autorais no estilo da banca; nenhuma é apresentada como questão oficial.");
      break;
    case "concurso": {
      agruparPor = "disciplina";
      if (c.editalId) {
        const { data: ed } = await f.supabase.from("edital_disciplinas").select("disciplina_id, peso, quantidade_questoes").eq("edital_id", c.editalId);
        if (!ed?.length) throw new ErroApp("O edital escolhido não tem disciplinas cadastradas. Configure a distribuição em Disciplinas.");
        filtros.disciplina_ids = ed.map((d) => d.disciplina_id);
        // Quantidade definida no edital prevalece; senão, o peso.
        pesos = Object.fromEntries(ed.map((d) => [d.disciplina_id, d.quantidade_questoes ?? Number(d.peso)]));
        observacoes.push("Distribuição conforme o edital cadastrado.");
      } else {
        const ativas = await disciplinasAtivas();
        filtros.disciplina_ids = ativas.map((d) => d.disciplina_id);
        pesos = Object.fromEntries(ativas.map((d) => [d.disciplina_id, Number(d.peso)]));
        observacoes.push("Sem edital cadastrado: distribuição pelos pesos das suas disciplinas. Duração e pontuação são as que você configurou.");
      }
      break;
    }
    case "diagnostico": {
      const ativas = await disciplinasAtivas();
      filtros.disciplina_ids = c.disciplinaIds.length ? c.disciplinaIds : ativas.map((d) => d.disciplina_id);
      agruparPor = "disciplina";
      pesos = Object.fromEntries((filtros.disciplina_ids as string[]).map((d) => [d, 1]));
      dificuldades = { facil: 3, medio: 4, dificil: 3 };
      modo = "todas";
      break;
    }
    case "semanal": {
      const assuntos = await assuntosEstudadosDesde(f, new Date(Date.now() - 7 * 86400000));
      if (!assuntos.length) throw new ErroApp("Nenhum assunto estudado nos últimos 7 dias (respostas, sessões ou atividades concluídas).");
      filtros.assunto_ids = assuntos;
      pesos = Object.fromEntries(assuntos.map((a) => [a, 1]));
      break;
    }
    case "revisao_acumulada": {
      const recentes = await assuntosEstudadosDesde(f, new Date(Date.now() - 14 * 86400000));
      const antigos = (await assuntosEstudadosDesde(f, new Date(Date.now() - 365 * 86400000), new Date(Date.now() - 14 * 86400000))).filter((a) => !recentes.includes(a));
      if (!recentes.length && !antigos.length) throw new ErroApp("Ainda não há histórico de estudo suficiente para uma revisão acumulada.");
      filtros.assunto_ids = [...recentes, ...antigos];
      const pr = recentes.length ? 0.6 / recentes.length : 0;
      const pa = antigos.length ? 0.4 / antigos.length : 0;
      pesos = Object.fromEntries([...recentes.map((a) => [a, pr || 1]), ...antigos.map((a) => [a, pa || 1])]);
      break;
    }
  }

  const candidatas = await f.candidatas(filtros);
  const selecao = selecionarQuestoes(candidatas, {
    quantidade: c.quantidade, agruparPor, pesos, dificuldades, modo, ordem: c.ordem,
    semente: Math.floor(Math.random() * 2 ** 31),
  });

  // Nomes legíveis para distribuição e déficits.
  const idsGrupos = [...new Set([...Object.keys(selecao.porGrupo), ...selecao.deficits.map((d) => d.grupo)])].filter((g) => g !== "geral" && g !== "sem-assunto");
  const tabela = agruparPor === "disciplina" ? "disciplinas" : "assuntos";
  const { data: nomes } = idsGrupos.length
    ? await f.supabase.from(tabela).select(agruparPor === "disciplina" ? "id, nome" : "id, nome, disciplina_id").in("id", idsGrupos)
    : { data: [] as { id: string; nome: string; disciplina_id?: string }[] };
  const porId = new Map(((nomes ?? []) as unknown as { id: string; nome: string; disciplina_id?: string }[]).map((n) => [n.id, n]));
  const nome = (g: string) => (g === "sem-assunto" ? "Sem assunto" : g === "geral" ? "Geral" : porId.get(g)?.nome ?? "—");

  return {
    ids: selecao.ids,
    pedido: c.quantidade,
    disponiveis: selecao.disponiveis,
    distribuicao: Object.entries(selecao.porGrupo).filter(([, n]) => n > 0).map(([g, n]) => ({ nome: nome(g), quantidade: n })).sort((a, b) => b.quantidade - a.quantidade),
    deficits: selecao.deficits.map((d) => ({
      grupoId: d.grupo, nome: nome(d.grupo), faltam: d.faltam,
      disciplinaId: agruparPor === "disciplina" && d.grupo !== "geral" ? d.grupo : porId.get(d.grupo)?.disciplina_id ?? (c.disciplinaIds[0] ?? null),
      assuntoId: agruparPor === "assunto" && d.grupo !== "sem-assunto" && d.grupo !== "geral" ? d.grupo : null,
    })),
    observacoes,
  };
}

export function dadosCriacao(c: ConfigSimulado, plano: PlanoSimulado, agendamentoId?: string | null) {
  const data = new Date().toLocaleDateString("pt-BR");
  return {
    nome: c.nome || `${TIPOS_SIMULADO[c.tipo].rotulo} · ${data}`,
    tipo: c.tipo,
    concurso_id: c.concursoId,
    banca_estilo_id: c.tipo === "banca" ? c.bancaId : null,
    edital_id: c.editalId,
    config: c,
    tempo_limite_seg: c.tempoLimiteMin ? c.tempoLimiteMin * 60 : null,
    permite_pausa: c.permitePausa,
    ordem: c.ordem,
    mostrar_gabarito_durante: c.mostrarGabaritoDurante,
    finalizar_ao_esgotar: c.finalizarAoEsgotar,
    regra_pontuacao_id: c.regraPontuacaoId,
    pontos_acerto: c.pontosAcerto,
    pontos_erro: c.pontosErro,
    pontos_branco: c.pontosBranco,
    nota_nao_negativa: c.notaNaoNegativa,
    agendamento_id: agendamentoId ?? null,
    observacoes_geracao: [
      ...plano.observacoes,
      ...(plano.ids.length < plano.pedido ? [`Montado com ${plano.ids.length} de ${plano.pedido} questões pedidas: não havia conteúdo suficiente.`] : []),
    ],
  };
}
