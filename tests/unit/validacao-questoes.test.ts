import { describe, expect, it } from "vitest";
import type { QuestaoIA } from "@/lib/questoes/esquemas";
import {
  decidir, detectarCopia, maiorSequenciaComum, similaridadeEnunciados, sinalDesatualizacao, validarEstrutura,
  verificarDuplicidade, verificarReferencia,
} from "@/lib/questoes/validacao";

const PAGINA_5 = `A nacionalidade é o vínculo jurídico-político que liga o indivíduo a um Estado soberano.
São brasileiros natos os nascidos na República Federativa do Brasil, ainda que de pais estrangeiros,
desde que estes não estejam a serviço de seu país.`;

function questao(parcial: Partial<QuestaoIA> = {}): QuestaoIA {
  return {
    tipo: "multipla_escolha", estilo: "conceitual", dificuldade: "medio",
    enunciado: "Sobre a aquisição da nacionalidade brasileira originária, assinale a alternativa correta.",
    texto_apoio: null,
    alternativas: [
      { letra: "A", texto: "Filho de estrangeiros a serviço de seu país, nascido no Brasil, é brasileiro nato.", correta: false, justificativa: "Exceção expressa." },
      { letra: "B", texto: "Nascido no território brasileiro de pais estrangeiros que não estejam a serviço de seu país é brasileiro nato.", correta: true, justificativa: "Regra do jus soli." },
      { letra: "C", texto: "A nacionalidade é vínculo exclusivamente econômico.", correta: false, justificativa: "É jurídico-político." },
      { letra: "D", texto: "Somente filhos de brasileiros podem ser natos.", correta: false, justificativa: "Ignora o critério territorial." },
      { letra: "E", texto: "Naturalizados e natos nunca se distinguem.", correta: false, justificativa: "Há distinções constitucionais." },
    ],
    explicacao: "Pelo critério territorial, nasce brasileiro nato quem nasce no Brasil, salvo se os pais estrangeiros estiverem a serviço de seu país (p. 5).",
    pagina_referencia: 5,
    trecho_apoio: "São brasileiros natos os nascidos na República Federativa do Brasil, ainda que de pais estrangeiros",
    subassunto: null,
    depende_de_legislacao_recente: false,
    ...parcial,
  };
}

describe("estrutura", () => {
  it("aceita questão bem formada", () => {
    expect(validarEstrutura(questao())).toEqual([]);
  });

  it("bloqueia duas corretas, alternativas repetidas e letras fora de ordem", () => {
    const q = questao();
    const duas = { ...q, alternativas: q.alternativas.map((a, i) => ({ ...a, correta: i < 2 })) };
    expect(decidir(validarEstrutura(duas))).toBe("descartada");
    const repetidas = { ...q, alternativas: q.alternativas.map((a) => ({ ...a, texto: "Igual" })) };
    expect(validarEstrutura(repetidas).map((p) => p.mensagem)).toContain("Alternativas repetidas.");
    const ordem = { ...q, alternativas: [...q.alternativas].reverse() };
    expect(decidir(validarEstrutura(ordem))).toBe("descartada");
  });

  it("certo/errado exige afirmação e alternativas C/E", () => {
    const q = questao({
      tipo: "certo_errado", enunciado: "É brasileiro nato o nascido no Brasil de pais estrangeiros a serviço de seu país?",
      alternativas: [{ letra: "C", texto: "Certo", correta: false, justificativa: "x" }, { letra: "E", texto: "Errado", correta: true, justificativa: "x" }],
    });
    expect(validarEstrutura(q).some((p) => p.mensagem.includes("afirmação"))).toBe(true);
  });

  it("'nenhuma das anteriores' vai para revisão", () => {
    const q = questao();
    q.alternativas[4] = { letra: "E", texto: "Nenhuma das anteriores", correta: false, justificativa: "x" };
    expect(decidir(validarEstrutura(q))).toBe("pendente_revisao");
  });
});

describe("referência ao material", () => {
  const paginas = new Map([[5, PAGINA_5]]);

  it("encontra o trecho mesmo com quebra de linha e acentos diferentes", () => {
    expect(verificarReferencia(questao({ trecho_apoio: "sao brasileiros natos os nascidos na Republica Federativa do Brasil" }), paginas)).toEqual([]);
  });

  it("bloqueia página inexistente e alerta trecho inventado", () => {
    expect(decidir(verificarReferencia(questao({ pagina_referencia: 9 }), paginas))).toBe("descartada");
    expect(decidir(verificarReferencia(questao({ trecho_apoio: "A extradição de brasileiro nato é sempre permitida pela Constituição" }), paginas))).toBe("pendente_revisao");
  });
});

describe("cópia e duplicidade", () => {
  it("mede a maior sequência comum de palavras", () => {
    expect(maiorSequenciaComum("a b c d e".split(" "), "x a b c y".split(" "))).toBe(3);
  });

  it("bloqueia cópia literal longa do material", () => {
    const longa = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(" ");
    const q = questao({ enunciado: `Considere: ${longa}. Julgue.` });
    expect(decidir(detectarCopia(q, [`Texto inicial ${longa} final`]))).toBe("descartada");
    expect(detectarCopia(questao(), [PAGINA_5])).toEqual([]);
  });

  it("detecta enunciados quase iguais", () => {
    const a = "Sobre a aquisição da nacionalidade brasileira originária, assinale a alternativa correta.";
    expect(similaridadeEnunciados(a, `${a} `)).toBe(1);
    expect(similaridadeEnunciados(a, "Quanto aos direitos políticos, marque a opção incorreta.")).toBeLessThan(0.2);
    expect(decidir(verificarDuplicidade(questao(), [a]))).toBe("descartada");
  });
});

describe("atualização jurídica", () => {
  it("sinaliza norma citada em material antigo, sem bloquear", () => {
    const q = questao({ explicacao: "Conforme a EC nº 131/2023, a perda da nacionalidade mudou." });
    const problemas = sinalDesatualizacao(q, "2022-01-10", new Date("2026-10-15"));
    expect(problemas).toHaveLength(1);
    expect(decidir(problemas)).toBe("aprovada");
    expect(sinalDesatualizacao(q, "2026-09-01", new Date("2026-10-15"))).toEqual([]);
  });
});
