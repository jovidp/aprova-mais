import { describe, expect, it } from "vitest";
import { resumirSessao } from "@/lib/estudo/estatisticas";

describe("resumo da sessão", () => {
  it("diferencia percentual por tentativas e por questões únicas", () => {
    // Questão A: errou e depois acertou; B: acertou; C: errou.
    const r = resumirSessao([
      { questaoId: "A", correta: false, tempoSeg: 60, assunto: "Nacionalidade", ordem: 1 },
      { questaoId: "B", correta: true, tempoSeg: 30, assunto: "Direitos Políticos", ordem: 2 },
      { questaoId: "C", correta: false, tempoSeg: 90, assunto: "Nacionalidade", ordem: 3 },
      { questaoId: "A", correta: true, tempoSeg: 20, assunto: "Nacionalidade", ordem: 4 },
    ]);
    expect(r).toMatchObject({ respondidas: 4, acertos: 2, erros: 2, questoesUnicas: 3, acertosUnicos: 2, tempoTotalSeg: 200, tempoMedioSeg: 50 });
    expect(r.percentualTentativas).toBe(50);
    expect(r.percentualUnicas).toBeCloseTo(66.667, 2);
    expect(r.assuntosComMaisErros).toEqual([{ assunto: "Nacionalidade", erros: 2, total: 3 }]);
  });

  it("sem respostas não divide por zero", () => {
    const r = resumirSessao([]);
    expect(r.percentualTentativas).toBeNull();
    expect(r.percentualUnicas).toBeNull();
    expect(r.tempoMedioSeg).toBeNull();
  });
});
