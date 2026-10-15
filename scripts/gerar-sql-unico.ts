/**
 * Junta todas as migrations em um único arquivo para colar no SQL Editor do
 * Supabase (alternativa a `npm run db:migrar` quando não se tem a senha do banco).
 * Também registra as versões em supabase_migrations, mantendo compatibilidade.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pasta = join(process.cwd(), "supabase", "migrations");
const arquivos = readdirSync(pasta).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const partes = [
  "-- Gerado por scripts/gerar-sql-unico.ts. Não edite à mão.",
  "-- Execute uma única vez em um projeto vazio (Supabase → SQL Editor → New query → Run).",
  "begin;",
  "create schema if not exists supabase_migrations;",
  "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);",
];
for (const arquivo of arquivos) {
  const [versao, ...resto] = arquivo.replace(/\.sql$/, "").split("_");
  partes.push(`\n-- >>> ${arquivo}\n`, readFileSync(join(pasta, arquivo), "utf8"));
  partes.push(`insert into supabase_migrations.schema_migrations (version, name) values ('${versao}', '${resto.join("_")}') on conflict do nothing;`);
}
partes.push("commit;", "notify pgrst, 'reload schema';");
writeFileSync(join(process.cwd(), "supabase", "instalacao-completa.sql"), partes.join("\n"));
console.log(`supabase/instalacao-completa.sql gerado com ${arquivos.length} migrations.`);
