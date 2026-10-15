/**
 * Banco PostgreSQL real (PGlite/WASM) para testar migrations, RLS e funções.
 * Reproduz o que o Supabase fornece: esquemas auth e storage, papéis
 * anon/authenticated/service_role e privilégios padrão do esquema public.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const STUB_SUPABASE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;

create schema if not exists extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant all on auth.users to supabase_auth_admin;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Db = PGlite;

export async function criarBanco(): Promise<Db> {
  const db = await PGlite.create({ extensions: { pg_trgm, unaccent, btree_gist } });
  await db.exec(STUB_SUPABASE);
  const pasta = join(process.cwd(), "supabase", "migrations");
  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(pasta, arquivo), "utf8"));
    } catch (erro) {
      throw new Error(`Falha ao aplicar ${arquivo}: ${(erro as Error).message}`);
    }
  }
  // Extensões instaladas depois do stub também precisam ser utilizáveis.
  await db.exec("grant usage on schema extensions to anon, authenticated; grant execute on all functions in schema extensions to anon, authenticated;");
  return db;
}

/** Executa como superusuário (equivale ao service role / migrations). */
export async function comoSistema(db: Db) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
}

/** Executa como um usuário autenticado, sujeito a RLS. */
export async function comoUsuario(db: Db, userId: string) {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated;");
}

export async function comoAnonimo(db: Db) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
}

export async function criarUsuario(db: Db, nome = "Aluno", admin = false) {
  const id = randomUUID();
  await comoSistema(db);
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${id}@teste.local`,
    JSON.stringify({ nome }),
  ]);
  if (admin) await db.query("update public.profiles set papel = 'admin' where id = $1", [id]);
  return id;
}

export async function umValor<T = unknown>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, params);
  const linha = r.rows[0];
  return linha ? (Object.values(linha)[0] as T) : (undefined as T);
}
