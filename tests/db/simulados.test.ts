import { beforeAll, describe, expect, it } from "vitest";
import { comoSistema, comoUsuario, criarBanco, criarUsuario, umValor, type Db } from "./harness";
import { criarAssunto, criarDisciplina, criarQuestao, criarQuestoes } from "./fabrica";

let db: Db;
let aluno: string;
let disciplina: string;
let assuntoA: string;
let assuntoB: string;

beforeAll(async () => {
  db = await criarBanco();
  aluno = await criarUsuario(db, "Aluno");
  disciplina = await criarDisciplina(db, aluno);
  assuntoA = await criarAssunto(db, aluno, disciplina, "Nacionalidade");
  assuntoB = await criarAssunto(db, aluno, disciplina, "Direitos Políticos");
});

async function montar(opcoes: Record<string, unknown>, questoes: string[]) {
  await comoUsuario(db, aluno);
  const id = await umValor<string>(db, "select public.criar_simulado($1::jsonb, $2::uuid[])", [JSON.stringify(opcoes), questoes]);
  const tentativa = await umValor<string>(db, "select public.iniciar_tentativa($1)", [id]);
  return { id, tentativa };
}

async function responder(tentativa: string, questao: string, alternativa: string | null, tempo = 30) {
  return umValor<Record<string, unknown>>(db, "select public.salvar_resposta_simulado($1, $2, $3, false, $4)", [
    tentativa, questao, alternativa, tempo,
  ]);
}

describe("pontuação com casos conhecidos", () => {
  it("+1/−1/0: 2 acertos, 1 erro e 1 branco resultam em nota 1 e denominadores corretos", async () => {
    const qa = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina, assuntoId: assuntoA, dificuldade: "facil" });
    const qb = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina, assuntoId: assuntoB, dificuldade: "dificil" });
    const qs = [...qa, ...qb];
    const { tentativa } = await montar(
      { nome: "Penalização", tipo: "disciplina", pontos_acerto: 1, pontos_erro: -1, pontos_branco: 0, nota_nao_negativa: false },
      qs.map((q) => q.id),
    );

    await responder(tentativa, qa[0].id, qa[0].corretaId, 40);
    await responder(tentativa, qa[1].id, qa[1].corretaId, 50);
    await responder(tentativa, qb[0].id, qb[0].alternativas.find((a) => a !== qb[0].corretaId)!, 60);
    // qb[1] fica em branco

    const r = await umValor<Record<string, unknown>>(db, "select public.finalizar_tentativa($1)", [tentativa]);
    expect(r).toMatchObject({
      total: 4, respondidas: 3, acertos: 2, erros: 1, brancos: 1,
      percentual_acerto: 66.67, percentual_acerto_total: 50, nota: 1, nota_maxima: 4,
    });
    const porAssunto = (r.por_assunto as { nome: string; acertos: number; erros: number; brancos: number }[])
      .map(({ nome, acertos, erros, brancos }) => ({ nome, acertos, erros, brancos }));
    expect(porAssunto).toEqual([
      { nome: "Direitos Políticos", acertos: 0, erros: 1, brancos: 1 },
      { nome: "Nacionalidade", acertos: 2, erros: 0, brancos: 0 },
    ]);
    expect(r.regra).toEqual({ pontos_acerto: 1, pontos_erro: -1, pontos_branco: 0, nota_nao_negativa: false });
  });

  it("nota não negativa é limitada a zero", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    const { tentativa } = await montar(
      { nome: "Tudo errado", pontos_acerto: 1, pontos_erro: -1, pontos_branco: 0, nota_nao_negativa: true },
      qs.map((q) => q.id),
    );
    for (const q of qs) await responder(tentativa, q.id, q.alternativas.find((a) => a !== q.corretaId)!);
    const r = await umValor<Record<string, unknown>>(db, "select public.finalizar_tentativa($1)", [tentativa]);
    expect(r.nota).toBe(0);
    expect(r.percentual_acerto).toBe(0);
  });

  it("sem nenhuma resposta, percentual sobre respondidas é nulo (não divide por zero)", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Em branco" }, qs.map((q) => q.id));
    const r = await umValor<Record<string, unknown>>(db, "select public.finalizar_tentativa($1)", [tentativa]);
    expect(r).toMatchObject({ respondidas: 0, brancos: 2, percentual_acerto: null, percentual_acerto_total: 0, nota: 0 });
  });
});

describe("integridade da prova", () => {
  it("a prova não traz gabarito nem explicação", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Sigilo" }, qs.map((q) => q.id));
    const prova = await umValor<{ questoes: Record<string, unknown>[] }>(db, "select public.obter_prova($1)", [tentativa]);
    const texto = JSON.stringify(prova.questoes);
    expect(texto).not.toContain("gabarito");
    expect(texto).not.toContain("explicacao");
    expect(texto).not.toContain("alternativa_correta_id");
    expect(prova.questoes).toHaveLength(2);
    // Tabela de gabaritos do simulado é inacessível.
    expect((await db.query("select * from public.simulados_gabaritos")).rows).toHaveLength(0);
  });

  it("correção só depois da entrega; entrega é idempotente; respostas viram histórico", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Entrega" }, qs.map((q) => q.id));
    await responder(tentativa, qs[0].id, qs[0].corretaId);
    await expect(db.query("select public.obter_correcao_simulado($1)", [tentativa])).rejects.toThrow(/após a entrega/);

    const r1 = await umValor<Record<string, unknown>>(db, "select public.finalizar_tentativa($1)", [tentativa]);
    const r2 = await umValor<Record<string, unknown>>(db, "select public.finalizar_tentativa($1)", [tentativa]);
    expect(r2).toEqual(r1);
    expect(await umValor(db, "select count(*)::int from public.simulados_resultados where tentativa_id = $1", [tentativa])).toBe(1);
    expect(await umValor(db, "select count(*)::int from public.respostas_usuario where simulado_tentativa_id = $1 and contexto = 'simulado'", [tentativa])).toBe(1);

    const salvar = await db.query("select public.salvar_resposta_simulado($1, $2, $3)", [tentativa, qs[1].id, qs[1].corretaId]).catch((e) => e);
    expect(String(salvar)).toMatch(/não está em andamento/);

    const correcao = await umValor<{ questoes: { resultado: string; gabarito: { alternativa_correta_id: string } }[] }>(
      db, "select public.obter_correcao_simulado($1)", [tentativa]);
    expect(correcao.questoes.map((q) => q.resultado)).toEqual(["acerto", "branco"]);
    expect(correcao.questoes[0].gabarito.alternativa_correta_id).toBe(qs[0].corretaId);
  });

  it("rejeita alternativa que não pertence à questão", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Alternativa trocada" }, qs.map((q) => q.id));
    await expect(responder(tentativa, qs[0].id, qs[1].alternativas[0])).rejects.toThrow(/Alternativa inválida/);
  });

  it("outro usuário não acessa a prova nem a correção", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const { id, tentativa } = await montar({ nome: "Privado" }, qs.map((q) => q.id));
    const intruso = await criarUsuario(db, "Intruso");
    await comoUsuario(db, intruso);
    await expect(db.query("select public.obter_prova($1)", [tentativa])).rejects.toThrow(/não encontrada/);
    await expect(db.query("select public.iniciar_tentativa($1)", [id])).rejects.toThrow(/não encontrado/);
    await expect(db.query("select public.finalizar_tentativa($1)", [tentativa])).rejects.toThrow(/não encontrada/);
    expect((await db.query("select * from public.simulados where id = $1", [id])).rows).toHaveLength(0);
  });

  it("não aceita questões pendentes de revisão nem repetidas", async () => {
    const pendente = await criarQuestao(db, aluno, { disciplinaId: disciplina, status: "pendente_revisao" });
    const ok = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await expect(db.query("select public.criar_simulado('{}'::jsonb, $1::uuid[])", [[pendente.id]])).rejects.toThrow(/indisponíveis/);
    await expect(db.query("select public.criar_simulado('{}'::jsonb, $1::uuid[])", [[ok.id, ok.id]])).rejects.toThrow(/repetidas/);
  });

  it("aluno não altera a regra de pontuação gravada no simulado", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const { id } = await montar({ nome: "Regra" }, qs.map((q) => q.id));
    await expect(db.query("update public.simulados set pontos_acerto = 100 where id = $1", [id])).rejects.toThrow(/permission denied/);
    await db.query("update public.simulados set nome = 'Renomeado' where id = $1", [id]);
  });

  it("preserva a cópia da questão mesmo após arquivá-la", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Snapshot" }, qs.map((q) => q.id));
    await responder(tentativa, qs[0].id, qs[0].corretaId);
    await db.query("select public.finalizar_tentativa($1)", [tentativa]);
    await db.query("select public.definir_status_questao($1, 'arquivada')", [qs[0].id]);
    const correcao = await umValor<{ questoes: { enunciado: string; resultado: string }[] }>(
      db, "select public.obter_correcao_simulado($1)", [tentativa]);
    expect(correcao.questoes[0].resultado).toBe("acerto");
    expect(correcao.questoes[0].enunciado).toMatch(/Enunciado de teste/);
  });
});

describe("tempo, pausa e retomada", () => {
  it("tempo esgotado entrega a prova automaticamente e a entrega persiste", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Cronometrado", tempo_limite_seg: 600, finalizar_ao_esgotar: true }, qs.map((q) => q.id));
    await responder(tentativa, qs[0].id, qs[0].corretaId);

    await comoSistema(db);
    await db.query("update public.simulados_tentativas set iniciada_em = now() - interval '20 minutes', prazo_em = now() - interval '10 minutes' where id = $1", [tentativa]);
    await comoUsuario(db, aluno);

    const resposta = await responder(tentativa, qs[1].id, qs[1].corretaId);
    expect(resposta).toMatchObject({ salvo: false, expirado: true });
    const t = (await db.query<{ status: string; finalizacao: string }>(
      "select status, finalizacao from public.simulados_tentativas where id = $1", [tentativa])).rows[0];
    expect(t).toEqual({ status: "concluida", finalizacao: "tempo_esgotado" });
    const r = (await db.query<{ acertos: number; brancos: number; tempo_total_seg: number }>(
      "select acertos, brancos, tempo_total_seg from public.simulados_resultados where tentativa_id = $1", [tentativa])).rows[0];
    // A resposta enviada depois do prazo não conta; o tempo é limitado ao configurado.
    expect(r).toEqual({ acertos: 1, brancos: 1, tempo_total_seg: 600 });
  });

  it("pausa estende o prazo; sem permissão de pausa, recusa", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const comPausa = await montar({ nome: "Pausável", tempo_limite_seg: 600, permite_pausa: true }, qs.map((q) => q.id));
    const prazoAntes = await umValor<string>(db, "select prazo_em from public.simulados_tentativas where id = $1", [comPausa.tentativa]);
    expect(await umValor(db, "select public.pausar_tentativa($1)", [comPausa.tentativa])).toEqual({ pausada: true, expirado: false });
    await expect(responder(comPausa.tentativa, qs[0].id, qs[0].corretaId)).rejects.toThrow(/não está em andamento/);

    await comoSistema(db);
    await db.query("update public.simulados_tentativas set pausada_em = now() - interval '5 minutes' where id = $1", [comPausa.tentativa]);
    await comoUsuario(db, aluno);
    await db.query("select public.retomar_tentativa($1)", [comPausa.tentativa]);
    const prazoDepois = await umValor<string>(db, "select prazo_em from public.simulados_tentativas where id = $1", [comPausa.tentativa]);
    const diferenca = (new Date(prazoDepois).getTime() - new Date(prazoAntes).getTime()) / 1000;
    expect(diferenca).toBeGreaterThanOrEqual(299);
    expect(diferenca).toBeLessThanOrEqual(302);

    const qs2 = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const semPausa = await montar({ nome: "Sem pausa", tempo_limite_seg: 600, permite_pausa: false }, qs2.map((q) => q.id));
    await expect(db.query("select public.pausar_tentativa($1)", [semPausa.tentativa])).rejects.toThrow(/não permite pausa/);
  });

  it("retomar uma prova interrompida devolve a mesma tentativa", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const { id, tentativa } = await montar({ nome: "Retomada" }, qs.map((q) => q.id));
    const denovo = await umValor<string>(db, "select public.iniciar_tentativa($1)", [id]);
    expect(denovo).toBe(tentativa);
  });

  it("com gabarito durante a prova, a resposta corrigida não pode ser trocada", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    const { tentativa } = await montar({ nome: "Modo estudo", mostrar_gabarito_durante: true }, qs.map((q) => q.id));
    const errada = qs[0].alternativas.find((a) => a !== qs[0].corretaId)!;
    const r = await responder(tentativa, qs[0].id, errada);
    expect((r.gabarito as { alternativa_correta_id: string }).alternativa_correta_id).toBe(qs[0].corretaId);
    await expect(responder(tentativa, qs[0].id, qs[0].corretaId)).rejects.toThrow(/não pode ser alterada/);
  });
});

describe("funções auxiliares de simulado", () => {
  it("o aluno não acessa as versões internas (somente servidor)", async () => {
    const qs = await criarQuestoes(db, aluno, 1, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await expect(db.query("select public.criar_simulado_interno($1, '{}'::jsonb, $2::uuid[])", [aluno, [qs[0].id]])).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.candidatas_simulado_usuario($1)", [aluno])).rejects.toThrow(/permission denied/);
    const proprias = await db.query<{ id: string }>("select id from public.candidatas_simulado('{}'::jsonb)");
    expect(proprias.rows.some((r) => r.id === qs[0].id)).toBe(true);
  });

  it("adicionar ao caderno exige ter respondido ou feito o simulado; questão em branco entra com zero erros", async () => {
    const qs = await criarQuestoes(db, aluno, 2, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await expect(db.query("select public.adicionar_ao_caderno($1)", [qs[0].id])).rejects.toThrow(/Responda/);
    const { tentativa } = await montar({ nome: "Caderno" }, qs.map((q) => q.id));
    await db.query("select public.finalizar_tentativa($1)", [tentativa]);
    await db.query("select public.adicionar_ao_caderno($1, 'deixei em branco')", [qs[0].id]);
    const linha = (await db.query<{ total_erros: number; observacoes: string }>("select total_erros, observacoes from public.caderno_erros where questao_id = $1", [qs[0].id])).rows[0];
    expect(linha).toEqual({ total_erros: 0, observacoes: "deixei em branco" });
  });

  it("agendar revisão do assunto não duplica e antecipa a data", async () => {
    await comoUsuario(db, aluno);
    const a = await umValor<string>(db, "select public.agendar_revisao_assunto($1, 'Nacionalidade', '2026-12-10')", [assuntoA]);
    const b = await umValor<string>(db, "select public.agendar_revisao_assunto($1, 'Nacionalidade', '2026-11-01')", [assuntoA]);
    expect(b).toBe(a);
    expect(await umValor(db, "select proxima_em::text from public.revisoes where id = $1", [a])).toBe("2026-11-01");
  });
});
