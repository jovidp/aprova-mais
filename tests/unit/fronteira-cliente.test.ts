/**
 * Fronteira servidor/cliente: valores exportados por arquivos "use client"
 * viram referências de cliente quando importados no servidor. Componentes
 * (PascalCase) podem cruzar a fronteira; funções e constantes não.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const RAIZ = resolve("src");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

function ehCliente(conteudo: string) {
  return /^\s*["']use client["']/.test(conteudo);
}

function resolverImport(origem: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = join(RAIZ, especificador.slice(2));
  else if (especificador.startsWith(".")) base = resolve(dirname(origem), especificador);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

describe("fronteira servidor/cliente", () => {
  it("módulos de servidor só importam componentes (ou tipos) de arquivos 'use client'", () => {
    const todos = arquivos(RAIZ);
    const clientes = new Set(todos.filter((f) => ehCliente(readFileSync(f, "utf8"))));
    const violacoes: string[] = [];
    for (const f of todos) {
      const conteudo = readFileSync(f, "utf8");
      if (ehCliente(conteudo)) continue;
      for (const m of conteudo.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const alvo = resolverImport(f, m[3]);
        if (!alvo || !clientes.has(alvo)) continue;
        const nomes = m[2].split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "));
        for (const nome of nomes) {
          const local = nome.split(/\s+as\s+/)[0].trim();
          if (!/^[A-Z][a-z]/.test(local)) violacoes.push(`${f.replace(RAIZ, "src")} importa "${local}" de ${m[3]}`);
        }
      }
    }
    expect(violacoes).toEqual([]);
  });
});

describe("arquivos 'use server'", () => {
  it("exportam somente funções assíncronas (e tipos)", () => {
    const violacoes: string[] = [];
    for (const f of arquivos(RAIZ)) {
      const conteudo = readFileSync(f, "utf8");
      if (!/^\s*["']use server["']/.test(conteudo)) continue;
      for (const m of conteudo.matchAll(/^export\s+(const|let|var|class|function(?!\s*\*)|enum)\s+(\w+)/gm)) {
        violacoes.push(`${f.replace(RAIZ, "src")}: export ${m[1]} ${m[2]}`);
      }
      for (const m of conteudo.matchAll(/^export\s+\{/gm)) violacoes.push(`${f.replace(RAIZ, "src")}: reexportação ${m[0]}`);
    }
    expect(violacoes).toEqual([]);
  });
});
