import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoSistema, comoUsuario, criarBanco, criarUsuario, umValor, type Db } from "./harness";

let db: Db;

beforeAll(async () => {
  db = await criarBanco();
});

describe("migrations", () => {
  it("aplicam todas e criam perfil e preferências no cadastro", async () => {
    const id = await criarUsuario(db, "Maria");
    await comoSistema(db);
    expect(await umValor(db, "select nome from public.profiles where id = $1", [id])).toBe("Maria");
    expect(await umValor(db, "select count(*)::int from public.preferencias_usuario where user_id = $1", [id])).toBe(1);
  });

  it("todas as tabelas do esquema public têm RLS habilitado", async () => {
    await comoSistema(db);
    const semRls = await db.query<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(semRls.rows.map((r) => r.relname)).toEqual([]);
  });

  it("semeia bancas e regras de pontuação globais", async () => {
    await comoSistema(db);
    expect(await umValor(db, "select count(*)::int from public.bancas")).toBeGreaterThanOrEqual(6);
    expect(await umValor(db, "select count(*)::int from public.simulados_regras_pontuacao where owner_id is null")).toBe(2);
  });

  it("verificar_saude responde para visitantes, mas eles não leem tabelas", async () => {
    await comoAnonimo(db);
    const saude = await umValor<{ ok: boolean }>(db, "select public.verificar_saude()");
    expect(saude.ok).toBe(true);
    await expect(db.query("select * from public.bancas")).rejects.toThrow(/permission denied/);
  });

  it("usuário não consegue se promover a admin", async () => {
    const id = await criarUsuario(db);
    await comoUsuario(db, id);
    await expect(db.query("update public.profiles set papel = 'admin' where id = $1", [id])).rejects.toThrow(/administradores/);
    await db.query("update public.profiles set nome = 'Novo nome' where id = $1", [id]);
    expect(await umValor(db, "select nome from public.profiles where id = $1", [id])).toBe("Novo nome");
  });
});
