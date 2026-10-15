import { describe, expect, it } from "vitest";
import { horasSemanaisNecessarias, projetar, type EntradaProjecao } from "@/lib/estudo/projecao";

const base: EntradaProjecao = {
  hoje: "2026-10-15", dataInicio: "2026-10-01", dataProva: "2027-01-07", paginasTotais: 1300, paginasLidas: 100,
  horasSemanais: 15, paginasPorHora: 12, questoesAlvoRestantes: 1200, minutosPorQuestao: 3, reservaRevisao: 0.2,
};

describe("projeção até a prova", () => {
  it("calcula horas disponíveis, necessárias e ritmo", () => {
    const p = projetar(base);
    expect(p.semanasRestantes).toBeCloseTo(12, 5); // 84 dias
    expect(p.horasDisponiveis).toBeCloseTo(180, 5);
    // (1200/12 + 1200*3/60) / 0,8 = (100 + 60) / 0,8 = 200
    expect(p.horasNecessarias).toBeCloseTo(200, 5);
    expect(p.ritmoPaginasSemana).toBeCloseTo(100, 5);
    expect(p.situacao).toBe("insuficiente");
    expect(horasSemanaisNecessarias(p)).toBeCloseTo(16.67, 1);
    expect(p.progressoEsperado).toBeCloseTo(14 / 98, 5);
  });

  it("com mais horas o cenário fica folgado", () => {
    expect(projetar({ ...base, horasSemanais: 25 }).situacao).toBe("folgado");
  });

  it("sem data de prova não projeta prazo; prova passada é sinalizada", () => {
    expect(projetar({ ...base, dataProva: null }).situacao).toBe("sem_data");
    expect(projetar({ ...base, dataProva: "2026-10-01" }).situacao).toBe("prova_passou");
  });
});
