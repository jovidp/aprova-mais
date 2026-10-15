import { beforeAll, describe, expect, it } from "vitest";
import { comoSistema, comoUsuario, criarBanco, criarUsuario, umValor, type Db } from "./harness";
import { criarAssunto, criarDisciplina, criarQuestao } from "./fabrica";

let db: Db;
let ana: string;
let bruno: string;

const SHA = "a".repeat(64);

async function criarMaterial(dono: string, sha = SHA) {
  await comoUsuario(db, dono);
  return umValor<string>(
    db,
    `insert into public.materiais (user_id, titulo, nome_arquivo, storage_path, tipo, mime, tamanho_bytes, sha256, total_paginas)
     values ($1, 'Aula 05 - Nacionalidade', 'aula05.pdf', $3, 'pdf', 'application/pdf', 1000, $2, 10) returning id`,
    [dono, sha, `${dono}/${sha}.pdf`],
  );
}

beforeAll(async () => {
  db = await criarBanco();
  ana = await criarUsuario(db, "Ana");
  bruno = await criarUsuario(db, "Bruno");
});

describe("materiais privados", () => {
  it("cada usuário só vê os próprios materiais, páginas e anotações", async () => {
    const material = await criarMaterial(ana);
    await comoUsuario(db, ana);
    await db.query("insert into public.material_paginas (material_id, numero, user_id, texto) values ($1, 1, $2, 'Brasileiros natos e naturalizados')", [material, ana]);
    await db.query("insert into public.anotacoes (material_id, user_id, pagina, texto) values ($1, $2, 1, 'Revisar art. 12')", [material, ana]);

    await comoUsuario(db, bruno);
    expect((await db.query("select * from public.materiais")).rows).toHaveLength(0);
    expect((await db.query("select * from public.material_paginas")).rows).toHaveLength(0);
    expect((await db.query("select * from public.anotacoes")).rows).toHaveLength(0);
    const apagados = await db.query("delete from public.materiais where id = $1", [material]);
    expect(apagados.affectedRows ?? 0).toBe(0);
  });

  it("não é possível anexar páginas ou anotações ao material de outro usuário", async () => {
    const material = await criarMaterial(ana, "b".repeat(64));
    await comoUsuario(db, bruno);
    await expect(
      db.query("insert into public.material_paginas (material_id, numero, user_id, texto) values ($1, 2, $2, 'x')", [material, bruno]),
    ).rejects.toThrow(/não pertence/);
    await expect(
      db.query("insert into public.anotacoes (material_id, user_id, pagina, texto) values ($1, $2, 1, 'x')", [material, bruno]),
    ).rejects.toThrow(/não pertence/);
    // Fingindo ser a dona: barrado pelo gatilho ou pela RLS.
    await expect(
      db.query("insert into public.material_paginas (material_id, numero, user_id, texto) values ($1, 2, $2, 'x')", [material, ana]),
    ).rejects.toThrow(/row-level security|não pertence/);
  });

  it("pontos-chave são privados e só entram em material próprio", async () => {
    const material = await criarMaterial(ana, "9".repeat(64));
    await comoUsuario(db, ana);
    await db.query(
      "insert into public.material_pontos_chave (material_id, pagina, tipo, importancia, titulo, explicacao) values ($1, 3, 'lei', 3, 'Brasileiro nato', 'Art. 12, I')",
      [material],
    );
    await comoUsuario(db, bruno);
    expect((await db.query("select * from public.material_pontos_chave")).rows).toHaveLength(0);
    await expect(
      db.query("insert into public.material_pontos_chave (material_id, pagina, tipo, titulo, explicacao) values ($1, 1, 'conceito', 'x', 'y')", [material]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query("insert into public.material_pontos_chave (material_id, user_id, pagina, tipo, titulo, explicacao) values ($1, $2, 1, 'conceito', 'x', 'y')", [material, ana]),
    ).rejects.toThrow(/row-level security/);
  });

  it("o mesmo arquivo (SHA-256) não é duplicado para o mesmo usuário, mas outro usuário pode tê-lo", async () => {
    await criarMaterial(ana, "c".repeat(64));
    await expect(criarMaterial(ana, "c".repeat(64))).rejects.toThrow(/duplicate key|unique/);
    await expect(criarMaterial(bruno, "c".repeat(64))).resolves.toBeTruthy();
  });

  it("registrar_leitura acumula páginas sem duplicar e conclui o material", async () => {
    const material = await criarMaterial(ana, "d".repeat(64));
    await comoUsuario(db, ana);
    for (const p of [1, 2, 2, 3]) await db.query("select public.registrar_leitura($1, $2, 30)", [material, p]);
    const prog = (await db.query<{ paginas_lidas: number[]; tempo_leitura_seg: number; ultima_pagina: number }>(
      "select paginas_lidas, tempo_leitura_seg::int, ultima_pagina from public.progresso_leitura where material_id = $1", [material])).rows[0];
    expect(prog).toEqual({ paginas_lidas: [1, 2, 3], tempo_leitura_seg: 120, ultima_pagina: 3 });
    await expect(db.query("select public.registrar_leitura($1, 99)", [material])).rejects.toThrow(/fora do documento/);
    await comoUsuario(db, bruno);
    await expect(db.query("select public.registrar_leitura($1, 1)", [material])).rejects.toThrow(/não encontrado/);
  });
});

describe("Storage", () => {
  it("só permite enviar e ler arquivos na pasta do próprio usuário", async () => {
    await comoUsuario(db, ana);
    await db.query("insert into storage.objects (bucket_id, name) values ('materiais', $1)", [`${ana}/x.pdf`]);
    await expect(
      db.query("insert into storage.objects (bucket_id, name) values ('materiais', $1)", [`${bruno}/y.pdf`]),
    ).rejects.toThrow(/row-level security/);
    await comoUsuario(db, bruno);
    expect((await db.query("select * from storage.objects where bucket_id = 'materiais'")).rows).toHaveLength(0);
  });
});

describe("taxonomia", () => {
  it("assunto próprio não pode ser criado sob disciplina privada de outro usuário", async () => {
    const disciplinaAna = await criarDisciplina(db, ana, "Arquivologia");
    await comoUsuario(db, bruno);
    await expect(
      db.query("insert into public.assuntos (owner_id, disciplina_id, nome, slug) values ($1, $2, 'Protocolo', 'protocolo')", [bruno, disciplinaAna]),
    ).rejects.toThrow(/row-level security/);
  });

  it("somente admin cria disciplinas globais", async () => {
    await comoUsuario(db, ana);
    await expect(
      db.query("insert into public.disciplinas (owner_id, nome, slug) values (null, 'Global', 'global')"),
    ).rejects.toThrow(/row-level security/);
    const admin = await criarUsuario(db, "Admin", true);
    await comoUsuario(db, admin);
    await db.query("insert into public.disciplinas (owner_id, nome, slug) values (null, 'Global', 'global')");
    await comoUsuario(db, bruno);
    expect(await umValor(db, "select count(*)::int from public.disciplinas where slug = 'global'")).toBe(1);
  });
});

describe("cronograma", () => {
  it("impede atividades sobrepostas, mas permite sobrepor uma atividade cancelada", async () => {
    await comoUsuario(db, ana);
    const inserir = (inicio: string, fim: string, status = "planejada") =>
      db.query(
        "insert into public.atividades_planejadas (user_id, tipo, titulo, inicio, fim, status) values ($1, 'leitura', 'Estudo', $2, $3, $4) returning id",
        [ana, inicio, fim, status],
      );
    await inserir("2026-10-20T19:00:00-03:00", "2026-10-20T20:00:00-03:00");
    await expect(inserir("2026-10-20T19:30:00-03:00", "2026-10-20T20:30:00-03:00")).rejects.toThrow(/atividades_sem_sobreposicao/);
    await inserir("2026-10-20T20:00:00-03:00", "2026-10-20T21:00:00-03:00"); // encosta, não sobrepõe
    await inserir("2026-10-20T19:15:00-03:00", "2026-10-20T19:45:00-03:00", "cancelada");
  });

  it("disponibilidade semanal não aceita janelas sobrepostas no mesmo dia", async () => {
    await comoUsuario(db, bruno);
    await db.query("insert into public.disponibilidade_semanal (user_id, dia_semana, inicio_min, fim_min) values ($1, 1, 1140, 1320)", [bruno]);
    await expect(
      db.query("insert into public.disponibilidade_semanal (user_id, dia_semana, inicio_min, fim_min) values ($1, 1, 1200, 1260)", [bruno]),
    ).rejects.toThrow(/disponibilidade_sem_sobreposicao/);
    await db.query("insert into public.disponibilidade_semanal (user_id, dia_semana, inicio_min, fim_min) values ($1, 2, 1200, 1260)", [bruno]);
  });

  it("estudos concluídos não podem ser apagados", async () => {
    await comoUsuario(db, ana);
    const id = await umValor<string>(
      db,
      "insert into public.atividades_planejadas (user_id, tipo, titulo, inicio, fim, status) values ($1, 'questoes', 'Feito', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', 'concluida') returning id",
      [ana],
    );
    await expect(db.query("delete from public.atividades_planejadas where id = $1", [id])).rejects.toThrow(/concluídas/);
  });
});

describe("revisões", () => {
  it("não cria revisão ativa duplicada para o mesmo assunto", async () => {
    const disc = await criarDisciplina(db, bruno, "Ética");
    const assunto = await criarAssunto(db, bruno, disc, "Moral");
    await comoUsuario(db, bruno);
    const inserir = () =>
      db.query("insert into public.revisoes (user_id, alvo_tipo, assunto_id, titulo, proxima_em) values ($1, 'assunto', $2, 'Moral', current_date)", [bruno, assunto]);
    await inserir();
    await expect(inserir()).rejects.toThrow(/revisoes_alvo_ativo/);
  });

  it("não cria revisão para questão que o usuário não pode ver", async () => {
    const disc = await criarDisciplina(db, ana, "RLM");
    const q = await criarQuestao(db, ana, { disciplinaId: disc });
    await comoUsuario(db, bruno);
    await expect(
      db.query("insert into public.revisoes (user_id, alvo_tipo, questao_id, titulo, proxima_em) values ($1, 'questao', $2, 'x', current_date)", [bruno, q.id]),
    ).rejects.toThrow(/indisponível/);
  });
});

describe("processamentos de IA", () => {
  it("o aluno lê o próprio consumo, mas não pode registrá-lo nem alterá-lo", async () => {
    await comoSistema(db);
    const id = await umValor<string>(db, "insert into public.processamentos_ia (user_id, tipo, custo_estimado_usd) values ($1, 'tutor', 0.01) returning id", [ana]);
    await comoUsuario(db, ana);
    expect((await db.query("select id from public.processamentos_ia")).rows).toHaveLength(1);
    await expect(db.query("update public.processamentos_ia set custo_estimado_usd = 0 where id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into public.processamentos_ia (user_id, tipo) values ($1, 'tutor')", [ana])).rejects.toThrow(/permission denied/);
  });
});

describe("busca", () => {
  it("encontra páginas por termo sem acento e restringe ao dono", async () => {
    const material = await criarMaterial(bruno, "e".repeat(64));
    await comoUsuario(db, bruno);
    await db.query(
      "insert into public.material_paginas (material_id, numero, user_id, texto) values ($1, 3, $2, 'A nacionalidade é o vínculo jurídico-político entre o Estado e o indivíduo.')",
      [material, bruno],
    );
    const trechos = await db.query<{ pagina: number }>("select pagina from public.buscar_trechos('vinculo juridico nacionalidade')");
    expect(trechos.rows.map((r) => r.pagina)).toEqual([3]);
    const global = await umValor<{ paginas: unknown[] }>(db, "select public.buscar_global('nacionalidade')");
    expect(global.paginas).toHaveLength(1);
    await comoUsuario(db, ana);
    expect((await db.query("select * from public.buscar_trechos('nacionalidade')")).rows).toHaveLength(0);
  });
});
