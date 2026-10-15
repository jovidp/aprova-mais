/**
 * Sequência de dias estudados (gamificação opcional e leve).
 * Dias de descanso configurados não quebram a sequência, e há uma tolerância
 * de 1 dia perdido por semana, para não punir pausas normais.
 */
import { diaSemanaDe, somarDias } from "./tempo";

export function sequenciaDeEstudo(diasComEstudo: Set<string>, hoje: string, diasDescanso: number[], tolerancia = 1): { atual: number; recorde: number } {
  // Recorde: maior sequência no histórico informado.
  const ordenados = [...diasComEstudo].sort();
  let recorde = 0;
  if (ordenados.length) {
    const inicio = ordenados[0];
    const fimHistorico = ordenados[ordenados.length - 1];
    let seq = 0;
    let perdidosSemana = 0;
    for (let d = inicio; d <= fimHistorico; d = somarDias(d, 1)) {
      if (diaSemanaDe(d) === 1) perdidosSemana = 0;
      if (diasComEstudo.has(d)) { seq++; recorde = Math.max(recorde, seq); }
      else if (diasDescanso.includes(diaSemanaDe(d))) continue;
      else if (perdidosSemana < tolerancia) perdidosSemana++;
      else { seq = 0; perdidosSemana = 0; }
    }
  }

  // Atual: conta para trás a partir de hoje (hoje ainda pode ser estudado).
  let atual = 0;
  let perdidos = 0;
  let d = diasComEstudo.has(hoje) ? hoje : somarDias(hoje, -1);
  for (let i = 0; i < 3650; i++, d = somarDias(d, -1)) {
    if (diasComEstudo.has(d)) atual++;
    else if (diasDescanso.includes(diaSemanaDe(d))) continue;
    else if (perdidos < tolerancia) perdidos++;
    else break;
    if (diaSemanaDe(d) === 1) perdidos = 0;
  }
  return { atual, recorde: Math.max(recorde, atual) };
}
