import { describe, expect, it } from "vitest";
import { dividirEmPartes, itemFazParteDeTrecho, normalizarTrecho, quantidadePontos, trechoNaPagina } from "@/lib/materiais/pontos-chave";

describe("dividirEmPartes", () => {
  it("mantém faixas pequenas inteiras", () => {
    expect(dividirEmPartes(5, 9)).toEqual([[5, 9]]);
  });
  it("divide de forma equilibrada", () => {
    expect(dividirEmPartes(1, 21, 10)).toEqual([[1, 7], [8, 14], [15, 21]]);
    const partes = dividirEmPartes(10, 70, 10);
    expect(partes[0][0]).toBe(10);
    expect(partes.at(-1)![1]).toBe(70);
    expect(partes.every(([a, b]) => b - a + 1 <= 10)).toBe(true);
    // Contíguas e sem sobreposição.
    for (let i = 1; i < partes.length; i++) expect(partes[i][0]).toBe(partes[i - 1][1] + 1);
  });
  it("faixa inválida não gera partes", () => {
    expect(dividirEmPartes(9, 3)).toEqual([]);
  });
});

describe("quantidadePontos", () => {
  it("fica entre 3 e 10", () => {
    expect(quantidadePontos(1)).toBe(3);
    expect(quantidadePontos(6)).toBe(4);
    expect(quantidadePontos(30)).toBe(10);
  });
});

describe("trechoNaPagina", () => {
  const pagina = "Art. 5º Todos são iguais perante a lei, sem distin-\nção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País";
  it("aceita diferenças de espaço, acento, aspas e hifenização", () => {
    expect(trechoNaPagina("todos sao iguais perante a lei, sem distinção de qualquer natureza", pagina)).toBe(true);
    expect(trechoNaPagina("“Todos são iguais perante a lei”", pagina)).toBe(true);
  });
  it("rejeita trechos inventados ou curtos", () => {
    expect(trechoNaPagina("todos são iguais perante o Estado", pagina)).toBe(false);
    expect(trechoNaPagina("Art. 5º", pagina)).toBe(false);
  });
});

describe("itemFazParteDeTrecho", () => {
  const trechos = [normalizarTrecho("são brasileiros natos os nascidos na República Federativa do Brasil, ainda que de pais estrangeiros")];
  it("realça linhas contidas no trecho e linhas de borda", () => {
    expect(itemFazParteDeTrecho("os nascidos na República Federativa do Brasil,", trechos)).toBe(true);
    expect(itemFazParteDeTrecho("Art. 12. São brasileiros natos os nascidos na", trechos)).toBe(true);
    expect(itemFazParteDeTrecho("ainda que de pais estrangeiros, desde que estes", trechos)).toBe(true);
  });
  it("não realça linhas curtas ou sem relação", () => {
    expect(itemFazParteDeTrecho("Brasil", trechos)).toBe(false);
    expect(itemFazParteDeTrecho("Os direitos políticos são suspensos em caso de", trechos)).toBe(false);
  });
});
