import { describe, expect, it } from "vitest";
import { pesosAdaptativos, repartir, selecionarQuestoes, type Candidata, type ConfigSelecao } from "@/lib/simulados/selecao";

function gerar(disciplina: string, assunto: string, n: number, dificuldade: Candidata["dificuldade"] = "medio", extra: Partial<Candidata> = {}): Candidata[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${disciplina}-${assunto}-${dificuldade}-${i}`, disciplina_id: disciplina, assunto_id: assunto, dificuldade, tipo: "multipla_escolha",
    vezes_respondida: 0, ultima_correta: null, ...extra,
  }));
}

const base: ConfigSelecao = { quantidade: 10, agruparPor: "disciplina", pesos: {}, dificuldades: {}, modo: "todas", ordem: "aleatoria", semente: 42 };

describe("repartir (maiores restos)", () => {
  it("divide proporcionalmente e respeita limites, redistribuindo a sobra", () => {
    expect(repartir(10, { a: 1, b: 1 }, { a: 10, b: 10 })).toEqual({ a: 5, b: 5 });
    expect(repartir(10, { a: 3, b: 1 }, { a: 100, b: 100 })).toEqual({ a: 8, b: 2 });
    expect(repartir(10, { a: 1, b: 1 }, { a: 2, b: 100 })).toEqual({ a: 2, b: 8 });
    expect(repartir(10, { a: 1 }, { a: 4 })).toEqual({ a: 4 });
  });
});

describe("seleção de questões", () => {
  it("não repete questões e entrega a quantidade quando há estoque", () => {
    const r = selecionarQuestoes([...gerar("dc", "nac", 20), ...gerar("pt", "crase", 20)], { ...base, quantidade: 30 });
    expect(r.ids).toHaveLength(30);
    expect(new Set(r.ids).size).toBe(30);
    expect(r.deficits).toEqual([]);
    expect(r.porGrupo).toEqual({ dc: 15, pt: 15 });
  });

  it("respeita pesos do edital (2:1)", () => {
    const r = selecionarQuestoes([...gerar("dc", "a", 50), ...gerar("pt", "b", 50)], { ...base, quantidade: 30, pesos: { dc: 2, pt: 1 } });
    expect(r.porGrupo).toEqual({ dc: 20, pt: 10 });
  });

  it("respeita a distribuição de dificuldade", () => {
    const qs = [...gerar("dc", "a", 20, "facil"), ...gerar("dc", "a", 20, "medio"), ...gerar("dc", "a", 20, "dificil")];
    const r = selecionarQuestoes(qs, { ...base, quantidade: 10, dificuldades: { medio: 1, dificil: 1 } });
    const difs = r.ids.map((id) => id.split("-")[2]);
    expect(difs.filter((d) => d === "medio")).toHaveLength(5);
    expect(difs.filter((d) => d === "dificil")).toHaveLength(5);
    expect(difs).not.toContain("facil");
  });

  it("completa com outra dificuldade permitida quando uma acaba", () => {
    const qs = [...gerar("dc", "a", 2, "dificil"), ...gerar("dc", "a", 20, "medio")];
    const r = selecionarQuestoes(qs, { ...base, quantidade: 10, dificuldades: { medio: 1, dificil: 1 } });
    expect(r.ids).toHaveLength(10);
    expect(r.deficits).toEqual([]);
  });

  it("informa o déficit sem inventar questões", () => {
    const r = selecionarQuestoes(gerar("dc", "a", 7), { ...base, quantidade: 10, pesos: { dc: 1, pt: 1 } });
    expect(r.ids).toHaveLength(7);
    expect(r.deficits.reduce((s, d) => s + d.faltam, 0)).toBe(3);
    expect(r.deficits.map((d) => d.grupo)).toContain("pt");
  });

  it("modo erros e inéditas filtram corretamente", () => {
    const qs = [...gerar("dc", "a", 5, "medio", { vezes_respondida: 2, ultima_correta: false }), ...gerar("dc", "b", 5, "medio", { vezes_respondida: 1, ultima_correta: true }), ...gerar("dc", "c", 5)];
    expect(selecionarQuestoes(qs, { ...base, modo: "erros" }).ids.every((id) => id.includes("-a-"))).toBe(true);
    expect(selecionarQuestoes(qs, { ...base, modo: "ineditas" }).ids.every((id) => id.includes("-c-"))).toBe(true);
  });

  it("prioriza as menos respondidas", () => {
    const qs = [...gerar("dc", "a", 5, "medio", { vezes_respondida: 3 }), ...gerar("dc", "b", 5)];
    const r = selecionarQuestoes(qs, { ...base, quantidade: 5 });
    expect(r.ids.every((id) => id.includes("-b-"))).toBe(true);
  });

  it("é determinística com a mesma semente e ordena quando pedido", () => {
    const qs = [...gerar("pt", "z", 10), ...gerar("dc", "a", 10)];
    expect(selecionarQuestoes(qs, base).ids).toEqual(selecionarQuestoes(qs, base).ids);
    const org = selecionarQuestoes(qs, { ...base, ordem: "organizada" }).ids;
    expect(org.slice(0, 5).every((id) => id.startsWith("dc"))).toBe(true);
  });
});

describe("pesos adaptativos", () => {
  it("dá mais peso ao assunto fraco sem zerar os fortes", () => {
    const p = pesosAdaptativos({ fraco: 0.3, forte: 0.95, novo: null });
    expect(p.fraco).toBeGreaterThan(p.novo);
    expect(p.novo).toBeGreaterThan(p.forte);
    expect(p.forte).toBeCloseTo(0.6, 10);
  });
});
