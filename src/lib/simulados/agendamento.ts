import { dataLocal, diaSemanaDe, horaParaMinutos, instanteLocal, somarDias } from "@/lib/estudo/tempo";

export interface RegraAgendamento {
  frequencia: "semanal" | "quinzenal" | "mensal" | "data_unica";
  diaSemana: number | null;
  diaMes: number | null;
  dataUnica: string | null;
  hora: string;
}

/**
 * Próxima execução após `depois` (exclusivo), no fuso do usuário.
 * Quinzenal = a cada 14 dias contados a partir da última execução (ou do
 * primeiro dia da semana escolhido).
 */
export function proximaExecucao(r: RegraAgendamento, depois: Date, fuso: string, ultima?: Date | null): Date | null {
  const minutos = horaParaMinutos(r.hora);
  const hoje = dataLocal(depois, fuso);
  const em = (data: string) => instanteLocal(data, minutos, fuso);

  if (r.frequencia === "data_unica") {
    if (!r.dataUnica) return null;
    const t = em(r.dataUnica);
    return t > depois ? t : null;
  }
  if (r.frequencia === "mensal") {
    const dia = Math.min(28, Math.max(1, r.diaMes ?? 1));
    const [a, m] = hoje.split("-").map(Number);
    for (let k = 0; k < 3; k++) {
      const data = new Date(Date.UTC(a, m - 1 + k, dia)).toISOString().slice(0, 10);
      if (em(data) > depois) return em(data);
    }
    return null;
  }
  const passo = r.frequencia === "quinzenal" ? 14 : 7;
  if (r.frequencia === "quinzenal" && ultima) {
    let data = somarDias(dataLocal(ultima, fuso), passo);
    while (em(data) <= depois) data = somarDias(data, passo);
    return em(data);
  }
  const alvo = r.diaSemana ?? 0;
  for (let k = 0; k <= 7; k++) {
    const data = somarDias(hoje, k);
    if (diaSemanaDe(data) === alvo && em(data) > depois) return em(data);
  }
  return em(somarDias(hoje, 7));
}
