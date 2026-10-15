/**
 * Análise de resultado de simulado (função pura). Todo texto é derivado dos
 * números da prova; nada é estimado ou inventado.
 */

export interface Agregado {
  id: string | null;
  nome: string;
  total: number;
  acertos: number;
  erros: number;
  brancos: number;
  disciplina_id?: string | null;
}

export interface ResultadoProva {
  total: number;
  acertos: number;
  erros: number;
  brancos: number;
  percentual_acerto: number | null;
  percentual_acerto_total: number;
  nota: number;
  nota_maxima: number;
  tempo_total_seg: number;
  tempo_medio_seg: number;
  por_disciplina: Agregado[];
  por_assunto: Agregado[];
  por_dificuldade: (Omit<Agregado, "id" | "nome"> & { dificuldade: string })[];
}

export interface AssuntoCritico {
  id: string;
  nome: string;
  disciplinaId: string | null;
  acertos: number;
  total: number;
  percentual: number;
  questoesRecomendadas: number;
}

export interface Analise {
  paragrafos: string[];
  pontosFortes: string[];
  pontosFracos: string[];
  criticos: AssuntoCritico[];
}

const pct = (a: number, t: number) => (t > 0 ? (100 * a) / t : 0);
const fmt = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Assunto crítico: ao menos 2 questões e menos de 60% de acerto. */
export const LIMITE_CRITICO = 60;
/** Ponto forte: ao menos 2 questões e 80% ou mais. */
export const LIMITE_FORTE = 80;

export function quantidadeRecomendada(erros: number) {
  return Math.min(30, Math.max(10, 10 + 5 * erros));
}

export function analisarResultado(r: ResultadoProva): Analise {
  const paragrafos: string[] = [];
  const respondidas = r.acertos + r.erros;
  paragrafos.push(
    `Você acertou ${r.acertos} de ${r.total} questões (${fmt(r.percentual_acerto_total)} do total` +
      (respondidas < r.total ? `; ${fmt(r.percentual_acerto ?? 0)} das ${respondidas} respondidas` : "") +
      `), com nota ${r.nota.toLocaleString("pt-BR")} de ${r.nota_maxima.toLocaleString("pt-BR")}.`,
  );

  for (const d of [...r.por_disciplina].sort((a, b) => b.total - a.total)) {
    if (r.por_disciplina.length > 1 || d.total > 0) {
      paragrafos.push(`Em ${d.nome}: ${fmt(pct(d.acertos, d.total))} de acertos (${d.acertos} de ${d.total}).`);
    }
  }

  const avaliaveis = r.por_assunto.filter((a) => a.id && a.total >= 2);
  const criticos: AssuntoCritico[] = avaliaveis
    .map((a) => ({ id: a.id!, nome: a.nome, disciplinaId: a.disciplina_id ?? null, acertos: a.acertos, total: a.total, percentual: pct(a.acertos, a.total), questoesRecomendadas: quantidadeRecomendada(a.erros + a.brancos) }))
    .filter((a) => a.percentual < LIMITE_CRITICO)
    .sort((a, b) => a.percentual - b.percentual || b.total - a.total);

  if (criticos.length) {
    const pior = criticos[0];
    paragrafos.push(
      `Seu menor desempenho ocorreu em ${pior.nome} (${pior.acertos} de ${pior.total}, ${fmt(pior.percentual)}). ` +
        `Recomenda-se revisar os materiais correspondentes e realizar mais ${pior.questoesRecomendadas} questões sobre o assunto.`,
    );
  } else if (avaliaveis.length) {
    paragrafos.push("Nenhum assunto ficou abaixo de 60% de acertos entre os que tiveram ao menos duas questões.");
  }

  const fortes = avaliaveis.filter((a) => pct(a.acertos, a.total) >= LIMITE_FORTE).sort((a, b) => pct(b.acertos, b.total) - pct(a.acertos, a.total));
  const dificil = r.por_dificuldade.find((d) => d.dificuldade === "dificil");
  if (dificil && dificil.total >= 2) paragrafos.push(`Nas questões difíceis você acertou ${dificil.acertos} de ${dificil.total} (${fmt(pct(dificil.acertos, dificil.total))}).`);
  if (r.brancos > 0) paragrafos.push(`${r.brancos} questão(ões) ficaram em branco.`);
  paragrafos.push(`Tempo total de ${Math.round(r.tempo_total_seg / 60)} min, média de ${Math.round(r.tempo_medio_seg)} s por questão.`);

  const poucasQuestoes = avaliaveis.length === 0 && r.por_assunto.length > 0;
  if (poucasQuestoes) paragrafos.push("Cada assunto teve menos de duas questões; o resultado por assunto ainda não permite conclusões.");

  return {
    paragrafos,
    pontosFortes: fortes.map((a) => `${a.nome} (${a.acertos}/${a.total})`),
    pontosFracos: criticos.map((a) => `${a.nome} (${a.acertos}/${a.total})`),
    criticos,
  };
}
