import { describe, expect, it } from "vitest";
import { sequenciaDeEstudo } from "@/lib/estudo/sequencia";

describe("sequência de estudo", () => {
  it("conta dias consecutivos até hoje", () => {
    const dias = new Set(["2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(sequenciaDeEstudo(dias, "2026-10-15", [], 0).atual).toBe(3);
  });

  it("hoje ainda não estudado não zera a sequência", () => {
    const dias = new Set(["2026-10-13", "2026-10-14"]);
    expect(sequenciaDeEstudo(dias, "2026-10-15", [], 0).atual).toBe(2);
  });

  it("dia de descanso configurado não quebra a sequência", () => {
    // 2026-10-11 é domingo
    const dias = new Set(["2026-10-10", "2026-10-12", "2026-10-13"]);
    expect(sequenciaDeEstudo(dias, "2026-10-13", [0], 0).atual).toBe(3);
    expect(sequenciaDeEstudo(dias, "2026-10-13", [], 0).atual).toBe(2);
  });

  it("tolera um dia perdido por semana", () => {
    const dias = new Set(["2026-10-12", "2026-10-14", "2026-10-15"]);
    expect(sequenciaDeEstudo(dias, "2026-10-15", [], 1).atual).toBe(3);
  });
});
