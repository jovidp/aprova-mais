import { describe, expect, it } from "vitest";
import { proximaExecucao } from "@/lib/simulados/agendamento";

const FUSO = "America/Sao_Paulo";
// 2026-10-15 é quinta-feira; 10:00 em São Paulo = 13:00 UTC.
const agora = new Date("2026-10-15T13:00:00Z");

describe("agendamento de simulados", () => {
  it("semanal: próximo domingo às 08:00 locais", () => {
    expect(proximaExecucao({ frequencia: "semanal", diaSemana: 0, diaMes: null, dataUnica: null, hora: "08:00" }, agora, FUSO)?.toISOString())
      .toBe("2026-10-18T11:00:00.000Z");
  });

  it("semanal no mesmo dia, mas horário já passado, vai para a semana seguinte", () => {
    expect(proximaExecucao({ frequencia: "semanal", diaSemana: 4, diaMes: null, dataUnica: null, hora: "08:00" }, agora, FUSO)?.toISOString())
      .toBe("2026-10-22T11:00:00.000Z");
  });

  it("quinzenal conta 14 dias desde a última execução", () => {
    const ultima = new Date("2026-10-11T11:00:00Z");
    expect(proximaExecucao({ frequencia: "quinzenal", diaSemana: 0, diaMes: null, dataUnica: null, hora: "08:00" }, agora, FUSO, ultima)?.toISOString())
      .toBe("2026-10-25T11:00:00.000Z");
  });

  it("mensal e data única", () => {
    expect(proximaExecucao({ frequencia: "mensal", diaSemana: null, diaMes: 5, dataUnica: null, hora: "07:30" }, agora, FUSO)?.toISOString())
      .toBe("2026-11-05T10:30:00.000Z");
    expect(proximaExecucao({ frequencia: "data_unica", diaSemana: null, diaMes: null, dataUnica: "2026-10-10", hora: "07:30" }, agora, FUSO)).toBeNull();
  });
});
