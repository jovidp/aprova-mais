import { describe, expect, it } from "vitest";
import { ESTADO_INICIAL, dataProxima, proximaRevisao, type EstadoSrs } from "@/lib/estudo/srs";
import { calcularDominio, wilsonInferior, type EvidenciaAssunto } from "@/lib/estudo/dominio";

describe("revisão espaçada", () => {
  it("segue a escada configurada com respostas 'bom' e depois multiplica pela facilidade", () => {
    let e: EstadoSrs = ESTADO_INICIAL;
    const intervalos: number[] = [];
    for (let i = 0; i < 6; i++) {
      e = proximaRevisao(e, "bom", [1, 7, 15, 30]);
      intervalos.push(e.intervaloDias);
    }
    expect(intervalos).toEqual([1, 7, 15, 30, 75, 188]);
  });

  it("'não lembrei' volta ao início, registra lapso e reduz a facilidade", () => {
    const depois = proximaRevisao({ facilidade: 2.5, intervaloDias: 30, repeticoes: 4, lapsos: 0 }, "nao_lembrei");
    expect(depois).toEqual({ facilidade: 2.3, intervaloDias: 1, repeticoes: 0, lapsos: 1 });
  });

  it("'fácil' pula um degrau; 'difícil' cresce pouco", () => {
    expect(proximaRevisao(ESTADO_INICIAL, "facil").intervaloDias).toBe(7);
    expect(proximaRevisao({ facilidade: 2.5, intervaloDias: 10, repeticoes: 3, lapsos: 0 }, "dificil").intervaloDias).toBe(12);
  });

  it("respeita limites de facilidade e intervalo máximo", () => {
    let e: EstadoSrs = { facilidade: 1.35, intervaloDias: 1, repeticoes: 0, lapsos: 0 };
    e = proximaRevisao(e, "nao_lembrei");
    expect(e.facilidade).toBe(1.3);
    const longo = proximaRevisao({ facilidade: 3.5, intervaloDias: 300, repeticoes: 10, lapsos: 0 }, "facil");
    expect(longo.intervaloDias).toBe(365);
  });

  it("calcula a data seguinte", () => {
    expect(dataProxima("2026-12-30", 7)).toBe("2027-01-06");
  });
});

function evidencia(parcial: Partial<EvidenciaAssunto>): EvidenciaAssunto {
  return {
    respondidas: 0, acertos: 0, respondidasFacil: 0, acertosFacil: 0, respondidasMedio: 0, acertosMedio: 0,
    respondidasDificil: 0, acertosDificil: 0, respondidas30d: 0, acertos30d: 0, revisoesRegistradas: 0, revisoesBoas: 0,
    ...parcial,
  };
}

describe("índice de domínio", () => {
  it("limite inferior de Wilson em casos conhecidos", () => {
    expect(wilsonInferior(0, 0)).toBe(0);
    expect(wilsonInferior(8, 10)).toBeCloseTo(0.4902, 3);
    expect(wilsonInferior(80, 100)).toBeCloseTo(0.7112, 3);
  });

  it("sem respostas: não iniciado", () => {
    expect(calcularDominio(evidencia({})).nivel).toBe("nao_iniciado");
  });

  it("100% de acerto em 5 questões não é domínio (pouca evidência)", () => {
    const r = calcularDominio(evidencia({ respondidas: 5, acertos: 5, respondidasMedio: 5, acertosMedio: 5 }));
    expect(r.nivel).toBe("em_aprendizado");
    expect(r.evidenciaSuficiente).toBe(false);
  });

  it("taxa baixa com evidência: necessita reforço", () => {
    const r = calcularDominio(evidencia({ respondidas: 20, acertos: 9, respondidasMedio: 20, acertosMedio: 9 }));
    expect(r.nivel).toBe("necessita_reforco");
  });

  it("domínio consistente exige volume e taxa alta sustentada", () => {
    const alto = calcularDominio(evidencia({ respondidas: 40, acertos: 37, respondidasDificil: 40, acertosDificil: 37, respondidas30d: 10, acertos30d: 9 }));
    expect(alto.nivel).toBe("dominio_consistente");
    const poucos = calcularDominio(evidencia({ respondidas: 20, acertos: 19, respondidasMedio: 20, acertosMedio: 19 }));
    expect(poucos.nivel).toBe("bom_desempenho");
  });

  it("queda recente rebaixa para reforço mesmo com histórico bom", () => {
    const r = calcularDominio(evidencia({ respondidas: 50, acertos: 40, respondidasMedio: 50, acertosMedio: 40, respondidas30d: 10, acertos30d: 4 }));
    expect(r.nivel).toBe("necessita_reforco");
  });
});
