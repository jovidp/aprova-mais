import { describe, expect, it } from "vitest";
import { dataLocal, horaParaMinutos, instanteLocal, partesLocais } from "@/lib/estudo/tempo";
import {
  distribuirPorPeso, gerarCronograma, montarBlocos, PARAMETROS_PADRAO, pesoEfetivo, proporRealocacao, sobrepoe,
  type EntradaCronograma,
} from "@/lib/estudo/cronograma";

const FUSO = "America/Sao_Paulo";

function base(parcial: Partial<EntradaCronograma> = {}): EntradaCronograma {
  return {
    dataInicio: "2026-10-19", // segunda-feira
    dias: 7,
    fuso: FUSO,
    agora: new Date("2026-10-18T12:00:00Z"),
    janelas: [1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, inicioMin: 19 * 60, fimMin: 22 * 60 })),
    diasDescanso: [],
    bloqueios: [],
    ocupados: [],
    disciplinas: [
      { id: "dc", nome: "Direito Constitucional", peso: 2, dificuldade: 3, prioridade: 3, taxaAcerto: null },
      { id: "pt", nome: "Português", peso: 1, dificuldade: 3, prioridade: 3, taxaAcerto: null },
    ],
    conteudo: [],
    revisoes: [],
    ...parcial,
  };
}

describe("fuso horário", () => {
  it("converte horário local de São Paulo (UTC−3) para UTC e de volta", () => {
    const t = instanteLocal("2026-10-19", 19 * 60, FUSO);
    expect(t.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    expect(dataLocal(t, FUSO)).toBe("2026-10-19");
    expect(partesLocais(t, FUSO)).toMatchObject({ hora: 19, minuto: 0, diaSemana: 1 });
  });

  it("lê horários", () => {
    expect(horaParaMinutos("19:30")).toBe(1170);
    expect(horaParaMinutos("24:00")).toBe(1440);
    expect(horaParaMinutos("25:00")).toBeNaN();
  });
});

describe("blocos de estudo", () => {
  it("divide 19h–22h em blocos de 50 min com 10 min de pausa", () => {
    const blocos = montarBlocos(base({ dias: 1 }), PARAMETROS_PADRAO);
    expect(blocos.map((b) => [b.inicio.toISOString(), b.fim.toISOString()])).toEqual([
      ["2026-10-19T22:00:00.000Z", "2026-10-19T22:50:00.000Z"],
      ["2026-10-19T23:00:00.000Z", "2026-10-19T23:50:00.000Z"],
      ["2026-10-20T00:00:00.000Z", "2026-10-20T00:50:00.000Z"],
    ]);
  });

  it("respeita descanso, bloqueios, atividades existentes, data da prova e o passado", () => {
    const ocupado = { inicio: new Date("2026-10-20T22:00:00Z"), fim: new Date("2026-10-20T23:00:00Z") };
    const blocos = montarBlocos(
      base({
        diasDescanso: [3],
        bloqueios: [{ inicio: new Date("2026-10-22T00:00:00Z"), fim: new Date("2026-10-23T03:00:00Z") }],
        ocupados: [ocupado],
        agora: new Date("2026-10-19T23:30:00Z"),
        dataProva: "2026-10-24",
      }),
      PARAMETROS_PADRAO,
    );
    const porDia = blocos.reduce<Record<string, number>>((acc, b) => {
      const d = dataLocal(b.inicio, FUSO);
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {});
    // seg: só o último bloco (os dois primeiros já passaram); ter: 2 (um conflita);
    // qua: descanso; qui: bloqueado; sex: 3; sáb/dom: sem janela; prova no sábado.
    expect(porDia).toEqual({ "2026-10-19": 1, "2026-10-20": 2, "2026-10-23": 3 });
    expect(blocos.some((b) => sobrepoe(b, ocupado))).toBe(false);
  });
});

describe("distribuição por peso", () => {
  it("é proporcional e intercalada", () => {
    const itens = [{ id: "a" }, { id: "b" }];
    const r = distribuirPorPeso(itens, [2, 1], 6).map((i) => i.id);
    expect(r.filter((x) => x === "a")).toHaveLength(4);
    expect(r.filter((x) => x === "b")).toHaveLength(2);
    expect(r.join("")).not.toContain("aaa");
  });

  it("dá mais peso a disciplinas com desempenho baixo e alta dificuldade", () => {
    const fraca = pesoEfetivo({ id: "x", nome: "x", peso: 1, dificuldade: 5, prioridade: 3, taxaAcerto: 0.4 });
    const forte = pesoEfetivo({ id: "y", nome: "y", peso: 1, dificuldade: 2, prioridade: 3, taxaAcerto: 0.9 });
    expect(fraca).toBeGreaterThan(forte);
  });
});

describe("gerar cronograma", () => {
  it("não gera atividades sobrepostas e respeita a proporção dos pesos", () => {
    const atividades = gerarCronograma(base());
    expect(atividades).toHaveLength(15); // 5 dias × 3 blocos
    for (let i = 1; i < atividades.length; i++) expect(atividades[i].inicio >= atividades[i - 1].fim).toBe(true);
    const dc = atividades.filter((a) => a.disciplinaId === "dc").length;
    expect(dc).toBe(10);
  });

  it("lê o material em sequência por páginas e intercala questões do que já foi lido", () => {
    const atividades = gerarCronograma(
      base({
        dias: 1,
        disciplinas: [{ id: "dc", nome: "DC", peso: 1, dificuldade: 3, prioridade: 3, taxaAcerto: null }],
        conteudo: [{ disciplinaId: "dc", materialId: "m1", assuntoId: "a1", titulo: "Aula 05 — Nacionalidade", paginaInicio: 3, paginaFim: 16 }],
      }),
    );
    expect(atividades.map((a) => [a.tipo, a.paginaInicio, a.paginaFim])).toEqual([
      ["leitura", 3, 12],
      ["questoes", null, null],
      ["leitura", 13, 16],
    ]);
    expect(atividades[1].quantidadeQuestoes).toBe(16);
    expect(atividades[1].assuntoId).toBe("a1");
  });

  it("reserva um bloco por dia para revisões vencidas", () => {
    const atividades = gerarCronograma(
      base({ dias: 2, revisoes: [{ id: "r1", titulo: "Nacionalidade", disciplinaId: "dc", assuntoId: "a1" }] }),
    );
    expect(atividades.filter((a) => a.tipo === "revisao")).toHaveLength(1);
    expect(atividades[0].tipo).toBe("revisao");
  });
});

describe("replanejamento", () => {
  it("propõe o primeiro horário livre que comporta a atividade, sem conflitos", () => {
    const pendente = { inicio: new Date("2026-10-19T22:00:00Z"), fim: new Date("2026-10-19T22:50:00Z") };
    const proposta = proporRealocacao(pendente, {
      ...base(),
      agora: new Date("2026-10-20T01:00:00Z"),
      ocupados: [{ inicio: new Date("2026-10-20T22:00:00Z"), fim: new Date("2026-10-21T00:50:00Z") }],
    });
    expect(proposta?.inicio.toISOString()).toBe("2026-10-21T22:00:00.000Z");
    expect(proposta && proposta.fim.getTime() - proposta.inicio.getTime()).toBe(50 * 60000);
  });

  it("devolve nulo quando não há horário disponível", () => {
    const proposta = proporRealocacao(
      { inicio: new Date("2026-10-19T22:00:00Z"), fim: new Date("2026-10-20T02:00:00Z") },
      base(),
    );
    expect(proposta).toBeNull();
  });
});
