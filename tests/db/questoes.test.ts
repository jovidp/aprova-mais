import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { comoSistema, comoUsuario, criarBanco, criarUsuario, umValor, type Db } from "./harness";
import { criarAssunto, criarDisciplina, criarQuestao, criarQuestoes } from "./fabrica";

let db: Db;
let aluno: string;
let outro: string;
let disciplina: string;
let assunto: string;

beforeAll(async () => {
  db = await criarBanco();
  aluno = await criarUsuario(db, "Aluno");
  outro = await criarUsuario(db, "Outro");
  disciplina = await criarDisciplina(db, aluno);
  assunto = await criarAssunto(db, aluno, disciplina, "Direitos e Garantias Fundamentais");
});

describe("cadastro de questões", () => {
  it("valida estrutura: exatamente uma correta", async () => {
    await comoUsuario(db, aluno);
    const dados = {
      tipo: "multipla_escolha", enunciado: "Enunciado inválido com duas corretas marcadas.", dificuldade: "facil",
      disciplina_id: disciplina, origem: "manual", status: "aprovada", explicacao: "x",
      alternativas: [
        { letra: "A", texto: "um", correta: true },
        { letra: "B", texto: "dois", correta: true },
      ],
    };
    await expect(db.query("select public.salvar_questao($1::jsonb)", [JSON.stringify(dados)])).rejects.toThrow(/exatamente uma/);
  });

  it("rejeita alternativas repetidas e letras fora de sequência", async () => {
    await comoUsuario(db, aluno);
    const base = { tipo: "multipla_escolha", enunciado: "Enunciado com alternativas problemáticas.", dificuldade: "facil",
      disciplina_id: disciplina, origem: "manual", status: "aprovada", explicacao: "x" };
    await expect(db.query("select public.salvar_questao($1::jsonb)", [JSON.stringify({ ...base,
      alternativas: [{ letra: "A", texto: "Igual", correta: true }, { letra: "B", texto: "igual" }] })])).rejects.toThrow(/repetidas/);
    await expect(db.query("select public.salvar_questao($1::jsonb)", [JSON.stringify({ ...base,
      alternativas: [{ letra: "A", texto: "um", correta: true }, { letra: "C", texto: "dois" }] })])).rejects.toThrow(/sequência/);
  });

  it("detecta questão duplicada (mesmo texto, alternativas em outra ordem)", async () => {
    await comoUsuario(db, aluno);
    const dados = (ordem: string[]) => ({
      tipo: "multipla_escolha", enunciado: "Qual é o fundamento da República previsto no art. 1º?", dificuldade: "facil",
      disciplina_id: disciplina, origem: "manual", status: "aprovada", explicacao: "Art. 1º, III.",
      alternativas: ordem.map((t, i) => ({ letra: "ABCDE"[i], texto: t, correta: t === "Dignidade da pessoa humana" })),
    });
    await db.query("select public.salvar_questao($1::jsonb)", [JSON.stringify(dados(["Dignidade da pessoa humana", "Monarquia"]))]);
    await expect(
      db.query("select public.salvar_questao($1::jsonb)", [JSON.stringify(dados(["Monarquia", "Dignidade da pessoa humana"]))]),
    ).rejects.toThrow(/duplicada/);
  });

  it("questão gerada por IA nunca pode ser marcada como oficial de banca", async () => {
    await comoSistema(db);
    const banca = await umValor<string>(db, "select id from public.bancas where sigla = 'CEBRASPE'");
    await comoUsuario(db, aluno);
    const dados = {
      tipo: "certo_errado", enunciado: "Item autoral gerado por IA no estilo da banca.", dificuldade: "medio",
      disciplina_id: disciplina, origem: "ia", status: "aprovada", explicacao: "x", banca_oficial_id: banca,
      alternativas: [{ letra: "C", texto: "Certo", correta: true }, { letra: "E", texto: "Errado" }],
    };
    await expect(db.query("select public.salvar_questao($1::jsonb)", [JSON.stringify(dados)])).rejects.toThrow(/licenciada/);
  });
});

describe("sigilo do gabarito", () => {
  it("o aluno não lê gabaritos diretamente, nem os próprios", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina, origem: "ia" });
    await comoUsuario(db, aluno);
    const r = await db.query("select * from public.questao_gabaritos where questao_id = $1", [q.id]);
    expect(r.rows).toHaveLength(0);
    await expect(db.query("select public.obter_correcao_questao($1)", [q.id])).rejects.toThrow(/Responda/);
  });

  it("o aluno não consegue gravar respostas nem alterar questões diretamente", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await expect(
      db.query(
        "insert into public.respostas_usuario (user_id, questao_id, alternativa_id, alternativa_correta_id, correta, tentativa_numero) values ($1,$2,$3,$3,true,1)",
        [aluno, q.id, q.alternativas[1]],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("update public.questoes set status = 'aprovada' where id = $1", [q.id])).rejects.toThrow(/permission denied/);
  });

  it("outro usuário não vê questões privadas", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, outro);
    const r = await db.query("select id from public.questoes where id = $1", [q.id]);
    expect(r.rows).toHaveLength(0);
    await expect(db.query("select public.responder_questao($1, $2)", [q.id, q.alternativas[0]])).rejects.toThrow(/indisponível/);
  });
});

describe("responder questões", () => {
  it("corrige no servidor, devolve explicação e mantém o histórico de tentativas", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina, assuntoId: assunto, corretaIndice: 2 });
    await comoUsuario(db, aluno);

    const errada = await umValor<Record<string, unknown>>(db, "select public.responder_questao($1, $2, 30)", [q.id, q.alternativas[0]]);
    expect(errada.correta).toBe(false);
    expect(errada.tentativa_numero).toBe(1);
    expect(errada.alternativa_correta_id).toBe(q.corretaId);
    expect(errada.explicacao).toBe("Explicação de teste.");

    const certa = await umValor<Record<string, unknown>>(db, "select public.responder_questao($1, $2, 20)", [q.id, q.corretaId]);
    expect(certa.correta).toBe(true);
    expect(certa.tentativa_numero).toBe(2);

    const tentativas = await db.query("select tentativa_numero, correta from public.respostas_usuario where questao_id = $1 order by 1", [q.id]);
    expect(tentativas.rows).toEqual([{ tentativa_numero: 1, correta: false }, { tentativa_numero: 2, correta: true }]);

    // Depois de responder, o comentário fica disponível.
    const correcao = await umValor<Record<string, unknown>>(db, "select public.obter_correcao_questao($1)", [q.id]);
    expect(correcao.alternativa_correta_id).toBe(q.corretaId);
  });

  it("é idempotente com a mesma chave (clique duplo não duplica tentativa)", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    const chave = randomUUID();
    const a = await umValor<Record<string, unknown>>(db, "select public.responder_questao($1, $2, 10, null, 'pratica', $3)", [q.id, q.corretaId, chave]);
    const b = await umValor<Record<string, unknown>>(db, "select public.responder_questao($1, $2, 10, null, 'pratica', $3)", [q.id, q.corretaId, chave]);
    expect(b.resposta_id).toBe(a.resposta_id);
    expect(b.repetida).toBe(true);
    expect(await umValor(db, "select count(*)::int from public.respostas_usuario where questao_id = $1", [q.id])).toBe(1);
  });

  it("rejeita alternativa de outra questão", async () => {
    const q1 = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    const q2 = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await expect(db.query("select public.responder_questao($1, $2)", [q1.id, q2.alternativas[0]])).rejects.toThrow(/Alternativa inválida/);
  });

  it("questão pendente de revisão não pode ser resolvida", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina, status: "pendente_revisao" });
    await comoUsuario(db, aluno);
    await expect(db.query("select public.responder_questao($1, $2)", [q.id, q.corretaId])).rejects.toThrow(/indisponível/);
  });

  it("histórico é imutável e questões respondidas não podem ser apagadas", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await db.query("select public.responder_questao($1, $2)", [q.id, q.corretaId]);
    await comoSistema(db);
    await expect(db.query("update public.respostas_usuario set correta = false where questao_id = $1", [q.id])).rejects.toThrow(/imutável/);
    await expect(db.query("delete from public.questoes where id = $1", [q.id])).rejects.toThrow(/foreign key/);
  });
});

describe("caderno de erros e histórico diário", () => {
  it("registra erro, conta reincidência e marca como superado após dois acertos seguidos", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina, assuntoId: assunto });
    const errada = q.alternativas.find((a) => a !== q.corretaId)!;
    await comoUsuario(db, aluno);
    await db.query("select public.responder_questao($1, $2)", [q.id, errada]);
    await db.query("select public.responder_questao($1, $2)", [q.id, errada]);
    let registro = (await db.query<{ total_erros: number; status: string }>(
      "select total_erros, status from public.caderno_erros where questao_id = $1", [q.id])).rows[0];
    expect(registro).toEqual({ total_erros: 2, status: "ativo" });

    await db.query("select public.responder_questao($1, $2)", [q.id, q.corretaId]);
    await db.query("select public.responder_questao($1, $2)", [q.id, q.corretaId]);
    registro = (await db.query<{ total_erros: number; status: string }>(
      "select total_erros, status from public.caderno_erros where questao_id = $1", [q.id])).rows[0];
    expect(registro).toEqual({ total_erros: 2, status: "superado" });
  });

  it("aluno classifica a causa, mas não altera contadores", async () => {
    const q = await criarQuestao(db, aluno, { disciplinaId: disciplina });
    await comoUsuario(db, aluno);
    await db.query("select public.responder_questao($1, $2)", [q.id, q.alternativas.find((a) => a !== q.corretaId)]);
    await db.query("update public.caderno_erros set causa = 'confusao_conceitos' where questao_id = $1", [q.id]);
    await expect(db.query("update public.caderno_erros set total_erros = 0 where questao_id = $1", [q.id])).rejects.toThrow(/permission denied/);
  });

  it("agrega respostas por dia e assunto com denominadores corretos", async () => {
    const usuario = await criarUsuario(db);
    const disc = await criarDisciplina(db, usuario, "Português");
    const ass = await criarAssunto(db, usuario, disc, "Crase");
    const qs = await criarQuestoes(db, usuario, 3, { disciplinaId: disc, assuntoId: ass, dificuldade: "dificil" });
    await comoUsuario(db, usuario);
    await db.query("select public.responder_questao($1, $2, 40)", [qs[0].id, qs[0].corretaId]);
    await db.query("select public.responder_questao($1, $2, 60)", [qs[1].id, qs[1].alternativas[3]]);
    await db.query("select public.responder_questao($1, $2, 20)", [qs[2].id, qs[2].corretaId]);
    const h = (await db.query<Record<string, number>>(
      "select respondidas, acertos, tempo_seg::int, respondidas_dificil, acertos_dificil from public.historico_desempenho where assunto_id = $1", [ass])).rows;
    expect(h).toEqual([{ respondidas: 3, acertos: 2, tempo_seg: 120, respondidas_dificil: 3, acertos_dificil: 2 }]);
  });
});

describe("listagem com filtros", () => {
  it("filtra inéditas, erradas e favoritas", async () => {
    const usuario = await criarUsuario(db);
    const disc = await criarDisciplina(db, usuario, "Informática");
    const [a, b, c] = await criarQuestoes(db, usuario, 3, { disciplinaId: disc });
    await comoUsuario(db, usuario);
    await db.query("select public.responder_questao($1, $2)", [a.id, a.alternativas.find((x) => x !== a.corretaId)]);
    await db.query("select public.responder_questao($1, $2)", [b.id, b.corretaId]);
    await db.query("insert into public.favoritos (user_id, questao_id) values ($1, $2)", [usuario, c.id]);

    const listar = async (situacao: string) =>
      (await umValor<{ total: number; itens: { id: string }[] }>(db, "select public.listar_questoes($1::jsonb)", [
        JSON.stringify({ disciplina_ids: [disc], situacao }),
      ])).itens.map((i) => i.id);

    expect(await listar("ineditas")).toEqual([c.id]);
    expect(await listar("erradas")).toEqual([a.id]);
    expect(await listar("acertadas")).toEqual([b.id]);
    expect(await listar("favoritas")).toEqual([c.id]);
  });
});
