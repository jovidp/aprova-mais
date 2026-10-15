import { describe, expect, it } from "vitest";
import { esperaSugerida } from "@/lib/ia/limites";

describe("esperaSugerida", () => {
  it("lê o atraso de RetryInfo", () => {
    expect(esperaSugerida('{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay": "42s"}')).toBe(42_000);
  });
  it("lê o atraso da mensagem (horas, minutos, segundos)", () => {
    expect(esperaSugerida("Quota exceeded ... Please retry in 7h7m57.371704069s.")).toBe(Math.ceil((7 * 3600 + 7 * 60 + 57.371704069) * 1000));
    expect(esperaSugerida("Please retry in 20.5s.")).toBe(20_500);
    expect(esperaSugerida("Please retry in 2m.")).toBe(120_000);
  });
  it("sem informação devolve nulo", () => {
    expect(esperaSugerida("You exceeded your current quota")).toBeNull();
  });
});
