/**
 * Estatísticas de uma sessão de questões (funções puras, testadas).
 *
 * - Percentual por tentativas = acertos ÷ tentativas respondidas × 100.
 * - Percentual por questões únicas = questões cuja ÚLTIMA tentativa foi correta
 *   ÷ questões distintas respondidas × 100.
 * Questões não respondidas (em branco) não entram em nenhum denominador.
 */

export interface TentativaSessao {
  questaoId: string;
  correta: boolean;
  tempoSeg: number;
  assunto: string | null;
  ordem: number;
}

export interface ResumoSessao {
  respondidas: number;
  acertos: number;
  erros: number;
  percentualTentativas: number | null;
  questoesUnicas: number;
  acertosUnicos: number;
  percentualUnicas: number | null;
  tempoTotalSeg: number;
  tempoMedioSeg: number | null;
  assuntosComMaisErros: { assunto: string; erros: number; total: number }[];
}

export function resumirSessao(tentativas: TentativaSessao[]): ResumoSessao {
  const respondidas = tentativas.length;
  const acertos = tentativas.filter((t) => t.correta).length;
  const ultima = new Map<string, TentativaSessao>();
  for (const t of [...tentativas].sort((a, b) => a.ordem - b.ordem)) ultima.set(t.questaoId, t);
  const unicas = [...ultima.values()];
  const acertosUnicos = unicas.filter((t) => t.correta).length;
  const tempoTotal = tentativas.reduce((s, t) => s + t.tempoSeg, 0);

  const porAssunto = new Map<string, { erros: number; total: number }>();
  for (const t of tentativas) {
    const chave = t.assunto ?? "Sem assunto";
    const atual = porAssunto.get(chave) ?? { erros: 0, total: 0 };
    porAssunto.set(chave, { erros: atual.erros + (t.correta ? 0 : 1), total: atual.total + 1 });
  }

  return {
    respondidas,
    acertos,
    erros: respondidas - acertos,
    percentualTentativas: respondidas ? (100 * acertos) / respondidas : null,
    questoesUnicas: unicas.length,
    acertosUnicos,
    percentualUnicas: unicas.length ? (100 * acertosUnicos) / unicas.length : null,
    tempoTotalSeg: tempoTotal,
    tempoMedioSeg: respondidas ? tempoTotal / respondidas : null,
    assuntosComMaisErros: [...porAssunto]
      .map(([assunto, v]) => ({ assunto, ...v }))
      .filter((a) => a.erros > 0)
      .sort((a, b) => b.erros - a.erros || b.erros / b.total - a.erros / a.total)
      .slice(0, 5),
  };
}
