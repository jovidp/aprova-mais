/**
 * Aplica as migrations de supabase/migrations no banco indicado por DATABASE_URL,
 * cada uma em sua própria transação, registrando-as na mesma tabela usada pela
 * Supabase CLI (compatível com `supabase db push`).
 *
 * Uso:  DATABASE_URL="postgresql://postgres.<ref>:<senha>@<host>:5432/postgres" npm run db:migrar
 *       npm run db:migrar -- --listar   (só mostra o estado)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Sem .env.local: usa as variáveis já definidas no ambiente.
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Defina DATABASE_URL (Supabase → Connect → Session pooler).");
  const apenasListar = process.argv.includes("--listar");

  const cliente = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await cliente.connect();
  try {
    await cliente.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key, statements text[], name text
      );`);
    const aplicadas = new Set(
      (await cliente.query<{ version: string }>("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version),
    );

    const pasta = join(process.cwd(), "supabase", "migrations");
    const arquivos = readdirSync(pasta).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const arquivo of arquivos) {
      const [versao, ...resto] = arquivo.replace(/\.sql$/, "").split("_");
      const nome = resto.join("_");
      if (aplicadas.has(versao)) {
        console.log(`✓ ${arquivo} (já aplicada)`);
        continue;
      }
      if (apenasListar) {
        console.log(`· ${arquivo} (pendente)`);
        continue;
      }
      const sql = readFileSync(join(pasta, arquivo), "utf8");
      process.stdout.write(`→ ${arquivo} ... `);
      try {
        await cliente.query("begin");
        await cliente.query(sql);
        await cliente.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [
          versao,
          nome,
          [sql],
        ]);
        await cliente.query("commit");
        console.log("ok");
      } catch (erro) {
        await cliente.query("rollback");
        console.log("FALHOU");
        throw new Error(`${arquivo}: ${(erro as Error).message}`);
      }
    }
    // Recarrega o cache de esquema da API REST (PostgREST).
    if (!apenasListar) await cliente.query("notify pgrst, 'reload schema'");
  } finally {
    await cliente.end();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
