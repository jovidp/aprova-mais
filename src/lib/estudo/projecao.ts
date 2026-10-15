/**
 * Projeção de preparação até a prova (estimativa, não garantia).
 *
 * horasDisponiveis = horas semanais × semanas restantes.
 * horasNecessarias = páginas restantes ÷ páginas por hora + horas de questões
 *                    (questões alvo × min/questão) + reserva de revisão (%).
 * ritmo necessário = páginas restantes ÷ semanas restantes.
 * progresso esperado = fração do tempo decorrido desde o início do plano.
 */

export interface EntradaProjecao {
  hoje: string;
  dataInicio: string;
  dataProva: string | null;
  paginasTotais: number;
  paginasLidas: number;
  horasSemanais: number;
  paginasPorHora: number;
  questoesAlvoRestantes: number;
  minutosPorQuestao: number;
  /** Fração do tempo reservada para revisões (0–1). */
  reservaRevisao: number;
}

export interface Projecao {
  semanasRestantes: number | null;
  horasDisponiveis: number | null;
  horasNecessarias: number;
  paginasRestantes: number;
  ritmoPaginasSemana: number | null;
  progressoRealizado: number;
  progressoEsperado: number | null;
  folgaHoras: number | null;
  situacao: "sem_data" | "folgado" | "no_limite" | "insuficiente" | "prova_passou";
}

function dias(de: string, ate: string) {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
}

export function projetar(e: EntradaProjecao): Projecao {
  const paginasRestantes = Math.max(0, e.paginasTotais - e.paginasLidas);
  const horasLeitura = e.paginasPorHora > 0 ? paginasRestantes / e.paginasPorHora : 0;
  const horasQuestoes = (e.questoesAlvoRestantes * e.minutosPorQuestao) / 60;
  const horasNecessarias = (horasLeitura + horasQuestoes) / Math.max(0.05, 1 - e.reservaRevisao);
  const progressoRealizado = e.paginasTotais > 0 ? e.paginasLidas / e.paginasTotais : 0;

  if (!e.dataProva) {
    return { semanasRestantes: null, horasDisponiveis: null, horasNecessarias, paginasRestantes, ritmoPaginasSemana: null, progressoRealizado, progressoEsperado: null, folgaHoras: null, situacao: "sem_data" };
  }
  const restantesDias = dias(e.hoje, e.dataProva);
  if (restantesDias <= 0) {
    return { semanasRestantes: 0, horasDisponiveis: 0, horasNecessarias, paginasRestantes, ritmoPaginasSemana: null, progressoRealizado, progressoEsperado: 1, folgaHoras: null, situacao: "prova_passou" };
  }
  const semanas = restantesDias / 7;
  const horasDisponiveis = e.horasSemanais * semanas;
  const total = dias(e.dataInicio, e.dataProva);
  const progressoEsperado = total > 0 ? Math.min(1, Math.max(0, dias(e.dataInicio, e.hoje) / total)) : null;
  const folga = horasDisponiveis - horasNecessarias;
  const situacao = folga >= horasNecessarias * 0.15 ? "folgado" : folga >= 0 ? "no_limite" : "insuficiente";
  return {
    semanasRestantes: semanas, horasDisponiveis, horasNecessarias, paginasRestantes,
    ritmoPaginasSemana: paginasRestantes / semanas, progressoRealizado, progressoEsperado, folgaHoras: folga, situacao,
  };
}

/** Horas semanais mínimas para cobrir o necessário até a prova. */
export function horasSemanaisNecessarias(p: Projecao) {
  return p.semanasRestantes && p.semanasRestantes > 0 ? p.horasNecessarias / p.semanasRestantes : null;
}
