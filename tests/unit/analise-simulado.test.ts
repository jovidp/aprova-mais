import { describe, expect, it } from "vitest";
import { analisarResultado, quantidadeRecomendada, type ResultadoProva } from "@/lib/simulados/analise";

function resultado(parcial: Partial<ResultadoProva> = {}): ResultadoProva {
  return {
    total: 12, acertos: 7, erros: 4, brancos: 1, percentual_acerto: 63.64, percentual_acerto_total: 58.33, nota: 7, nota_maxima: 12,
    tempo_total_seg: 1800, tempo_medio_seg: 150,
    por_disciplina: [{ id: "dc", nome: "Direito Constitucional", total: 12, acertos: 7, erros: 4, brancos: 1 }],
    por_assunto: [
      { id: "dgf", nome: "Direitos e Garantias Fundamentais", disciplina_id: "dc", total: 6, acertos: 2, erros: 3, brancos: 1 },
      { id: "nac", nome: "Nacionalidade", disciplina_id: "dc", total: 5, acertos: 5, erros: 0, brancos: 0 },
      { id: "pol", nome: "Direitos Políticos", disciplina_id: "dc", total: 1, acertos: 0, erros: 1, brancos: 0 },
    ],
    por_dificuldade: [{ dificuldade: "dificil", total: 4, acertos: 1, erros: 3, brancos: 0 }],
    ...parcial,
  };
}

describe("análise do simulado", () => {
  it("usa apenas os números da prova e aponta o assunto mais fraco", () => {
    const a = analisarResultado(resultado());
    expect(a.paragrafos[0]).toBe("Você acertou 7 de 12 questões (58,3% do total; 63,6% das 11 respondidas), com nota 7 de 12.");
    expect(a.paragrafos).toContain("Em Direito Constitucional: 58,3% de acertos (7 de 12).");
    expect(a.paragrafos.join(" ")).toContain("Seu menor desempenho ocorreu em Direitos e Garantias Fundamentais (2 de 6, 33,3%). Recomenda-se revisar os materiais correspondentes e realizar mais 30 questões sobre o assunto.");
    expect(a.criticos.map((c) => c.id)).toEqual(["dgf"]);
    expect(a.pontosFortes).toEqual(["Nacionalidade (5/5)"]);
  });

  it("não tira conclusão de assunto com uma única questão", () => {
    const a = analisarResultado(resultado());
    expect(a.criticos.some((c) => c.id === "pol")).toBe(false);
  });

  it("recomenda quantidade proporcional aos erros, entre 10 e 30", () => {
    expect(quantidadeRecomendada(0)).toBe(10);
    expect(quantidadeRecomendada(2)).toBe(20);
    expect(quantidadeRecomendada(10)).toBe(30);
  });
});
