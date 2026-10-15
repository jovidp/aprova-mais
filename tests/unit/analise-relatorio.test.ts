import { describe, expect, it } from "vitest";
import { analisarRelatorio, type DadosRelatorio } from "@/lib/relatorios/analise";

function base(): DadosRelatorio {
  return {
    periodo: { inicio: "2026-10-05", fim: "2026-10-11", tipo: "semanal" },
    totais: { respondidas: 0, acertos: 0, tempo_estudo_seg: 0, tempo_questoes_seg: 0, simulados_concluidos: 0, revisoes_concluidas: 0, flashcards_revisados: 0, paginas_lidas: 0, disciplinas_trabalhadas: 0 },
    anterior: null,
    planejado_seg: 0,
    atividades: { total: 0, concluidas: 0 },
    por_dia: Array.from({ length: 7 }, (_, i) => ({ data: `2026-10-0${5 + i}`.replace("0-1", "1-1"), respondidas: 0, acertos: 0, estudo_seg: 0 })),
    por_disciplina: [], por_assunto: [], simulados: [], erros_por_causa: [], revisoes_pendentes: 0,
  };
}

describe("analisarRelatorio", () => {
  it("sem atividade: uma única observação de atenção", () => {
    const obs = analisarRelatorio(base());
    expect(obs).toHaveLength(1);
    expect(obs[0].tipo).toBe("atencao");
  });

  it("compara acerto com o período anterior só com amostras suficientes", () => {
    const d = base();
    d.totais = { ...d.totais, respondidas: 40, acertos: 30 };
    d.por_dia[0] = { ...d.por_dia[0], respondidas: 40, acertos: 30 };
    d.anterior = { respondidas: 20, acertos: 10, tempo_estudo_seg: 0 };
    expect(analisarRelatorio(d).some((o) => o.tipo === "positivo" && o.texto.includes("subiu de 50% para 75%"))).toBe(true);

    d.anterior = { respondidas: 5, acertos: 1, tempo_estudo_seg: 0 };
    const textos = analisarRelatorio(d).map((o) => o.texto).join(" ");
    expect(textos).not.toContain("subiu");
    expect(textos).toContain("75% em 40 questões");
  });

  it("aponta assuntos fracos apenas com 10+ respostas", () => {
    const d = base();
    d.totais = { ...d.totais, respondidas: 30, acertos: 15 };
    d.por_assunto = [
      { id: "a", nome: "Controle de constitucionalidade", respondidas: 12, acertos: 4 },
      { id: "b", nome: "Remédios constitucionais", respondidas: 5, acertos: 0 },
      { id: "c", nome: "Direitos sociais", respondidas: 13, acertos: 11 },
    ];
    const obs = analisarRelatorio(d);
    const fraco = obs.find((o) => o.texto.startsWith("Assuntos com acerto abaixo"));
    expect(fraco?.texto).toContain("Controle de constitucionalidade");
    expect(fraco?.texto).not.toContain("Remédios");
    expect(obs.find((o) => o.texto.startsWith("Assuntos com acerto de 80%"))?.texto).toContain("Direitos sociais");
  });

  it("compara registrado com planejado", () => {
    const d = base();
    d.totais = { ...d.totais, tempo_estudo_seg: 3600 * 3 };
    d.planejado_seg = 3600 * 10;
    const o = analisarRelatorio(d).find((x) => x.texto.includes("do planejado"));
    expect(o?.tipo).toBe("atencao");
    expect(o?.texto).toContain("30%");
  });
});
