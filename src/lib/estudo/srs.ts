/**
 * Revisão espaçada (SM-2 adaptado, com intervalos iniciais configuráveis).
 *
 * - "Não lembrei": volta ao primeiro intervalo, conta lapso, reduz a facilidade em 0,2.
 * - "Difícil": cresce pouco (×1,2), reduz a facilidade em 0,15.
 * - "Bom": segue a escada inicial (ex.: 1, 7, 15, 30 dias) e depois multiplica pela facilidade.
 * - "Fácil": pula um degrau da escada e depois multiplica por facilidade × 1,3; facilidade +0,15.
 * A facilidade fica entre 1,3 e 3,5. O intervalo máximo é de 365 dias.
 */

export type Avaliacao = "nao_lembrei" | "dificil" | "bom" | "facil";

export interface EstadoSrs {
  facilidade: number;
  intervaloDias: number;
  repeticoes: number;
  lapsos: number;
}

export const INTERVALOS_PADRAO = [1, 7, 15, 30];
const FACILIDADE_MIN = 1.3;
const FACILIDADE_MAX = 3.5;
const INTERVALO_MAX = 365;

export const ESTADO_INICIAL: EstadoSrs = { facilidade: 2.5, intervaloDias: 0, repeticoes: 0, lapsos: 0 };

function limitar(valor: number, min: number, max: number) {
  return Math.min(max, Math.max(min, valor));
}

export function proximaRevisao(estado: EstadoSrs, avaliacao: Avaliacao, escada: number[] = INTERVALOS_PADRAO): EstadoSrs {
  const degraus = escada.length > 0 ? [...escada].sort((a, b) => a - b) : INTERVALOS_PADRAO;
  const { facilidade, intervaloDias, repeticoes, lapsos } = estado;

  if (avaliacao === "nao_lembrei") {
    return {
      facilidade: limitar(facilidade - 0.2, FACILIDADE_MIN, FACILIDADE_MAX),
      intervaloDias: degraus[0],
      repeticoes: 0,
      lapsos: lapsos + 1,
    };
  }
  if (avaliacao === "dificil") {
    return {
      facilidade: limitar(facilidade - 0.15, FACILIDADE_MIN, FACILIDADE_MAX),
      intervaloDias: limitar(Math.max(degraus[0], Math.round(intervaloDias * 1.2)), 1, INTERVALO_MAX),
      repeticoes: repeticoes + 1,
      lapsos,
    };
  }
  const salto = avaliacao === "facil" ? 2 : 1;
  const novasRepeticoes = repeticoes + salto;
  const novaFacilidade = limitar(facilidade + (avaliacao === "facil" ? 0.15 : 0), FACILIDADE_MIN, FACILIDADE_MAX);
  let intervalo: number;
  if (novasRepeticoes <= degraus.length) {
    intervalo = degraus[novasRepeticoes - 1];
  } else {
    intervalo = Math.round(Math.max(intervaloDias, degraus[degraus.length - 1]) * novaFacilidade * (avaliacao === "facil" ? 1.3 : 1));
  }
  return {
    facilidade: novaFacilidade,
    intervaloDias: limitar(intervalo, 1, INTERVALO_MAX),
    repeticoes: novasRepeticoes,
    lapsos,
  };
}

/** Data (AAAA-MM-DD) da próxima revisão a partir de uma data local. */
export function dataProxima(hoje: string, intervaloDias: number): string {
  const [a, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + intervaloDias)).toISOString().slice(0, 10);
}

export const ROTULO_AVALIACAO: Record<Avaliacao, string> = {
  nao_lembrei: "Não lembrei",
  dificil: "Difícil",
  bom: "Bom",
  facil: "Fácil",
};
