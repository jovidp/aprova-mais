import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoSistema, comoUsuario, criarBanco, criarUsuario, umValor, type Db } from "./harness";

let db: Db;
let master: string;
let aluno: string;

beforeAll(async () => {
  db = await criarBanco();
  master = await criarUsuario(db, "Master", true);
  aluno = await criarUsuario(db, "Aluno");
});

describe("moderação", () => {
  it("registra o IP de acesso do usuário logado, sem escrever a cada página", async () => {
    await comoUsuario(db, aluno);
    await db.query("select public.registrar_acesso('177.129.211.58', 'Chrome')");
    await db.query("select public.registrar_acesso('177.129.211.58', 'Chrome')");
    await db.query("select public.registrar_acesso('não-é-ip', 'x')"); // ignorado
    await comoSistema(db);
    const linhas = (await db.query<{ ip: string; acessos: number }>("select host(ip) ip, acessos from public.acessos_usuario where user_id = $1", [aluno])).rows;
    expect(linhas).toEqual([{ ip: "177.129.211.58", acessos: 1 }]);
  });

  it("anônimo não registra acesso e aluno não lê os acessos nem os bloqueios", async () => {
    await comoAnonimo(db);
    await expect(db.query("select public.registrar_acesso('1.1.1.1')")).rejects.toThrow(/permission denied/);
    await comoUsuario(db, aluno);
    expect((await db.query("select * from public.acessos_usuario")).rows).toHaveLength(0);
    await expect(db.query("insert into public.ips_bloqueados (ip) values ('9.9.9.9')")).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into public.emails_bloqueados (email) values ('x@y.com')")).rejects.toThrow(/row-level security/);
  });

  it("bloqueia IP exato e faixa; a consulta funciona para visitantes", async () => {
    await comoUsuario(db, master);
    await db.query("insert into public.ips_bloqueados (ip, motivo) values ('200.100.50.25', 'spam'), ('10.20.0.0/16', 'faixa')");
    await comoAnonimo(db);
    expect(await umValor(db, "select public.ip_bloqueado('200.100.50.25')")).toBe(true);
    expect(await umValor(db, "select public.ip_bloqueado('10.20.33.4')")).toBe(true);
    expect(await umValor(db, "select public.ip_bloqueado('200.100.50.26')")).toBe(false);
    expect(await umValor(db, "select public.ip_bloqueado('lixo')")).toBe(false);
  });

  it("nunca bloqueia um IP (ou faixa) usado por administrador", async () => {
    await comoUsuario(db, master);
    await db.query("select public.registrar_acesso('189.50.60.70', 'Edge')");
    await expect(db.query("insert into public.ips_bloqueados (ip) values ('189.50.60.70')")).rejects.toThrow(/administrador/);
    await expect(db.query("insert into public.ips_bloqueados (ip) values ('189.50.0.0/16')")).rejects.toThrow(/administrador/);
  });

  it("e-mail banido não consegue criar conta (nem direto no Auth)", async () => {
    await comoUsuario(db, master);
    await db.query("insert into public.emails_bloqueados (email, motivo) values ('banido@exemplo.com', 'abuso')");
    await comoSistema(db);
    await expect(db.query("insert into auth.users (id, email) values ($1, 'Banido@Exemplo.com')", [randomUUID()])).rejects.toThrow(/não permitido/);
    await expect(db.query("insert into auth.users (id, email) values ($1, 'outro@exemplo.com')", [randomUUID()])).resolves.toBeTruthy();
  });
});
