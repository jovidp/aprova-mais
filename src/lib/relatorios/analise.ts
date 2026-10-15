/**
 * Análise determinística de um relatório: só afirma o que os números
 * sustentam (amostras mínimas explícitas). Sem IA.
 */

export interface DadosRelatorio {
  periodo: { inicio: string; fim: string; tipo: "semanal" | "mensal" | "personalizado" };
  totais: {
    respondidas: number; acertos: number; tempo_estudo_seg: number; tempo_questoes_seg: number; simulados_concluidos: number;
    revisoes_concluidas: number; flashcards_revisados: number; paginas_lidas: number; disciplinas_trabalhadas: number;
  };
  anterior: { respondidas: number; acertos: number; tempo_estudo_seg: number } | null;
  planejado_seg: number;
  atividades: { total: number; concluidas: number };
  por_dia: { data: string; respondidas: number; acertos: number; estudo_seg: number }[];
  por_disciplina: { id: string | null; nome: string; respondidas: number; acertos: number }[];
  por_assunto: { id: string | null; nome: string; respondidas: number; acertos: number }[];
  simulados: { nome: string; data: string; percentual_acerto_total: number; nota: number; nota_maxima: number }[];
  erros_por_causa: { causa: string; total: number }[];
  revisoes_pendentes: number;
}

export interface Observacao {
  tipo: "positivo" | "atencao" | "neutro";
  texto: string;
}

const MIN_AMOSTRA = 10;
const pct = (a: number, t: number) => (t > 0 ? (a / t) * 100 : 0);
const fmt = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const horas = (s: number) => `${(s / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

export function analisarRelatorio(d: DadosRelatorio): Observacao[] {
  const obs: Observacao[] = [];
  const t = d.totais;
  const diasComEstudo = d.por_dia.filter((x) => x.estudo_seg > 0 || x.respondidas > 0).length;

  if (t.respondidas === 0 && t.tempo_estudo_seg === 0) {
    return [{ tipo: "atencao", texto: "Nenhuma atividade registrada no período (questões ou sessões de estudo)." }];
  }

  obs.push({ tipo: "neutro", texto: `Você estudou em ${diasComEstudo} de ${d.por_dia.length} dia(s) do período.` });

  if (t.respondidas >= MIN_AMOSTRA) {
    const atual = pct(t.acertos, t.respondidas);
    if (d.anterior && d.anterior.respondidas >= MIN_AMOSTRA) {
      const ant = pct(d.anterior.acertos, d.anterior.respondidas);
      const delta = atual - ant;
      if (Math.abs(delta) >= 3) {
        obs.push({ tipo: delta > 0 ? "positivo" : "atencao", texto: `Taxa de acerto ${delta > 0 ? "subiu" : "caiu"} de ${fmt(ant)} para ${fmt(atual)} em relação ao período anterior.` });
      } else {
        obs.push({ tipo: "neutro", texto: `Taxa de acerto estável: ${fmt(atual)} (anterior ${fmt(ant)}).` });
      }
    } else {
      obs.push({ tipo: "neutro", texto: `Taxa de acerto no período: ${fmt(atual)} em ${t.respondidas} questões.` });
    }
  } else if (t.respondidas > 0) {
    obs.push({ tipo: "neutro", texto: `Apenas ${t.respondidas} questão(ões) respondida(s): amostra pequena para conclusões sobre acerto.` });
  }

  if (d.anterior && d.anterior.tempo_estudo_seg > 0 && t.tempo_estudo_seg > 0) {
    const r = t.tempo_estudo_seg / d.anterior.tempo_estudo_seg;
    if (r >= 1.2 || r <= 0.8) {
      obs.push({ tipo: r > 1 ? "positivo" : "atencao", texto: `Tempo de estudo registrado ${r > 1 ? "aumentou" : "diminuiu"} de ${horas(d.anterior.tempo_estudo_seg)} para ${horas(t.tempo_estudo_seg)}.` });
    }
  }

  if (d.planejado_seg > 0) {
    const cumprido = pct(t.tempo_estudo_seg, d.planejado_seg);
    obs.push({
      tipo: cumprido >= 80 ? "positivo" : cumprido < 50 ? "atencao" : "neutro",
      texto: `Tempo registrado corresponde a ${fmt(Math.min(cumprido, 999))} do planejado no cronograma (${horas(t.tempo_estudo_seg)} de ${horas(d.planejado_seg)}).`,
    });
  }
  if (d.atividades.total > 0) {
    obs.push({ tipo: "neutro", texto: `${d.atividades.concluidas} de ${d.atividades.total} atividade(s) do cronograma foram marcadas como concluídas.` });
  }

  const comAmostra = d.por_assunto.filter((a) => a.id && a.respondidas >= MIN_AMOSTRA);
  const fracos = [...comAmostra].sort((a, b) => pct(a.acertos, a.respondidas) - pct(b.acertos, b.respondidas)).filter((a) => pct(a.acertos, a.respondidas) < 60).slice(0, 3);
  const fortes = [...comAmostra].sort((a, b) => pct(b.acertos, b.respondidas) - pct(a.acertos, a.respondidas)).filter((a) => pct(a.acertos, a.respondidas) >= 80).slice(0, 3);
  if (fracos.length) obs.push({ tipo: "atencao", texto: `Assuntos com acerto abaixo de 60%: ${fracos.map((a) => `${a.nome} (${fmt(pct(a.acertos, a.respondidas))})`).join("; ")}.` });
  if (fortes.length) obs.push({ tipo: "positivo", texto: `Assuntos com acerto de 80% ou mais: ${fortes.map((a) => `${a.nome} (${fmt(pct(a.acertos, a.respondidas))})`).join("; ")}.` });
  if (!comAmostra.length && t.respondidas > 0) obs.push({ tipo: "neutro", texto: `Nenhum assunto atingiu ${MIN_AMOSTRA} respostas no período; resolva mais questões por assunto para identificar pontos fracos.` });

  if (d.simulados.length >= 2) {
    const p = d.simulados[0].percentual_acerto_total;
    const u = d.simulados[d.simulados.length - 1].percentual_acerto_total;
    obs.push({ tipo: u > p ? "positivo" : u < p ? "atencao" : "neutro", texto: `Simulados: de ${fmt(p)} no primeiro para ${fmt(u)} no último do período.` });
  } else if (d.simulados.length === 1) {
    obs.push({ tipo: "neutro", texto: `1 simulado concluído, com ${fmt(d.simulados[0].percentual_acerto_total)} de acerto.` });
  }

  const principalCausa = [...d.erros_por_causa].filter((c) => c.causa !== "nao_classificado").sort((a, b) => b.total - a.total)[0];
  if (principalCausa && principalCausa.total >= 3) obs.push({ tipo: "atencao", texto: `Causa de erro mais frequente no caderno: ${principalCausa.causa.replace(/_/g, " ")} (${principalCausa.total}).` });
  if (d.revisoes_pendentes > 0) obs.push({ tipo: "atencao", texto: `${d.revisoes_pendentes} revisão(ões) vencida(s) aguardando.` });

  return obs;
}
