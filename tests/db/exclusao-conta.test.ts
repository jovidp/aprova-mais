import { beforeAll, describe, expect, it } from "vitest";
import { comoSistema, comoUsuario, criarBanco, criarUsuario, umValor, type Db } from "./harness";
import { criarAssunto, criarDisciplina, criarQuestoes } from "./fabrica";

let db: Db;

beforeAll(async () => {
  db = await criarBanco();
});

describe("exclusão de conta", () => {
  it("remove o usuário com questões, respostas, simulados e caderno, sem afetar outros usuários", async () => {
    const aluno = await criarUsuario(db, "Vai sair");
    const outro = await criarUsuario(db, "Fica");
    const disc = await criarDisciplina(db, aluno);
    const ass = await criarAssunto(db, aluno, disc, "Nacionalidade");
    const qs = await criarQuestoes(db, aluno, 3, { disciplinaId: disc, assuntoId: ass });
    const discOutro = await criarDisciplina(db, outro, "Português");
    const [qOutro] = await criarQuestoes(db, outro, 1, { disciplinaId: discOutro });

    await comoUsuario(db, aluno);
    await db.query("select public.responder_questao($1, $2)", [qs[0].id, qs[0].alternativas.find((a) => a !== qs[0].corretaId)]);
    const sim = await umValor<string>(db, "select public.criar_simulado('{\"nome\":\"S\"}'::jsonb, $1::uuid[])", [qs.map((q) => q.id)]);
    const t = await umValor<string>(db, "select public.iniciar_tentativa($1)", [sim]);
    await db.query("select public.salvar_resposta_simulado($1, $2, $3)", [t, qs[1].id, qs[1].corretaId]);
    await db.query("select public.finalizar_tentativa($1)", [t]);
    await comoUsuario(db, outro);
    await db.query("select public.responder_questao($1, $2)", [qOutro.id, qOutro.corretaId]);

    await comoSistema(db);
    await db.exec("set role supabase_auth_admin;");
    await db.query("delete from auth.users where id = $1", [aluno]);
    await comoSistema(db);

    for (const tabela of ["profiles", "questoes", "respostas_usuario", "simulados", "caderno_erros", "disciplinas"]) {
      const coluna = tabela === "profiles" ? "id" : ["questoes", "disciplinas"].includes(tabela) ? "owner_id" : "user_id";
      expect(await umValor(db, `select count(*)::int from public.${tabela} where ${coluna} = $1`, [aluno])).toBe(0);
    }
    expect(await umValor(db, "select count(*)::int from public.respostas_usuario where user_id = $1", [outro])).toBe(1);
  });

  it("continua proibido apagar avulsamente questão já respondida", async () => {
    const aluno = await criarUsuario(db);
    const disc = await criarDisciplina(db, aluno, "Ética");
    const [q] = await criarQuestoes(db, aluno, 1, { disciplinaId: disc });
    await comoUsuario(db, aluno);
    await db.query("select public.responder_questao($1, $2)", [q.id, q.corretaId]);
    await comoSistema(db);
    await expect(db.query("delete from public.questoes where id = $1", [q.id])).rejects.toThrow(/foreign key/);
  });
});
