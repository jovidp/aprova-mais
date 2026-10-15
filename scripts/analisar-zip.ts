/**
 * Analisa um ZIP de materiais localmente, com o mesmo pipeline usado pela
 * plataforma (regras de segurança, leitura, limpeza, índice e classificação).
 *
 * Uso: npm run analisar-zip -- "<arquivo.zip>" [pasta-de-saida]
 * Gera inventario.json (metadados e seções, sem o texto das páginas) e inventario.md.
 */
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { getDocumentProxy } from "unpdf";
import { LIMITES_ZIP, avaliarEntrada, conteudoCompativel } from "../src/lib/materiais/zip-seguranca";
import { lerDocumento } from "../src/lib/materiais/extracao-pdf";
import { analisarPaginas } from "../src/lib/materiais/analisador";
import type { ResultadoAnalise } from "../src/lib/materiais/tipos";

interface Extraido {
  caminho: string;
  dados: Uint8Array;
}

async function extrair(zipPath: string) {
  const tamanho = statSync(zipPath).size;
  if (tamanho > LIMITES_ZIP.tamanhoZipMax) throw new Error("ZIP acima do limite permitido");

  const aceitos: Extraido[] = [];
  const ignorados: { caminho: string; motivo: string }[] = [];
  let entradas = 0;
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip((arquivo: UnzipFile) => {
      entradas++;
      if (entradas > LIMITES_ZIP.entradasMax) return reject(new Error("ZIP com entradas demais"));
      const decisao = avaliarEntrada(arquivo.name, arquivo.size, arquivo.originalSize);
      if (!decisao.aceita) {
        if (decisao.motivo !== "Pasta") ignorados.push({ caminho: decisao.caminho, motivo: decisao.motivo! });
        return;
      }
      const partes: Uint8Array[] = [];
      let lidos = 0;
      arquivo.ondata = (erro, chunk, fim) => {
        if (erro) return reject(erro);
        lidos += chunk.length;
        total += chunk.length;
        if (lidos > LIMITES_ZIP.arquivoMax || total > LIMITES_ZIP.totalDescompactadoMax) {
          arquivo.terminate();
          return reject(new Error(`Limite de descompactação excedido em ${decisao.caminho}`));
        }
        partes.push(chunk);
        if (fim) {
          const dados = new Uint8Array(lidos);
          let pos = 0;
          for (const p of partes) {
            dados.set(p, pos);
            pos += p.length;
          }
          if (conteudoCompativel(decisao.tipo!, dados.subarray(0, 64 * 1024))) aceitos.push({ caminho: decisao.caminho, dados });
          else ignorados.push({ caminho: decisao.caminho, motivo: "Conteúdo não corresponde à extensão" });
        }
      };
      arquivo.start();
    });
    unzip.register(UnzipInflate);
    const stream = createReadStream(zipPath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => unzip.push(new Uint8Array(chunk as Buffer)));
    stream.on("end", () => {
      unzip.push(new Uint8Array(0), true);
      resolve();
    });
    stream.on("error", reject);
  });

  return { aceitos, ignorados, entradas };
}

async function main() {
  const [zipPath, saida = "relatorios"] = process.argv.slice(2);
  if (!zipPath) throw new Error('Informe o caminho do ZIP: npm run analisar-zip -- "arquivo.zip"');
  mkdirSync(saida, { recursive: true });

  const inicio = Date.now();
  const { aceitos, ignorados, entradas } = await extrair(zipPath);
  console.error(`Extraídos ${aceitos.length} arquivos (${ignorados.length} ignorados) de ${entradas} entradas.`);

  const porHash = new Map<string, string>();
  const materiais: (Omit<ResultadoAnalise, "paginas"> & {
    caminho: string;
    sha256: string;
    tamanho: number;
    duplicadoDe: string | null;
    caracteresTotais: number;
    amostra: string;
  })[] = [];

  for (const { caminho, dados } of aceitos) {
    const sha256 = createHash("sha256").update(dados).digest("hex");
    const duplicadoDe = porHash.get(sha256) ?? null;
    if (!duplicadoDe) porHash.set(sha256, caminho);
    if (!caminho.toLowerCase().endsWith(".pdf")) continue;

    const documento = await getDocumentProxy(new Uint8Array(dados));
    const brutas = await lerDocumento(documento);
    const { paginas, ...resto } = analisarPaginas(brutas, caminho);
    const amostra = paginas.find((p) => p.numero === Math.min(3, paginas.length))?.texto.slice(0, 600) ?? "";
    materiais.push({
      ...resto,
      caminho,
      sha256,
      tamanho: dados.length,
      duplicadoDe,
      caracteresTotais: paginas.reduce((s, p) => s + p.caracteres, 0),
      amostra,
    });
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  writeFileSync(join(saida, "inventario.json"), JSON.stringify({ geradoEm: new Date().toISOString(), ignorados, materiais }, null, 2));

  const porDisciplina = new Map<string, typeof materiais>();
  for (const m of materiais) {
    const chave = m.metadados.disciplina ?? "(não identificada)";
    porDisciplina.set(chave, [...(porDisciplina.get(chave) ?? []), m]);
  }

  const linhas: string[] = [];
  linhas.push(`# Inventário de materiais`, "");
  linhas.push(`- PDFs analisados: ${materiais.length}`);
  linhas.push(`- Duplicados (mesmo SHA-256): ${materiais.filter((m) => m.duplicadoDe).length}`);
  linhas.push(`- Ignorados: ${ignorados.length}`);
  linhas.push(`- Páginas: ${materiais.reduce((s, m) => s + m.totalPaginas, 0)}`);
  linhas.push(`- Precisam de OCR: ${materiais.filter((m) => m.requerOcr).length}`);
  linhas.push(`- Tempo de análise: ${Math.round((Date.now() - inicio) / 1000)} s`, "");

  for (const [disciplina, lista] of [...porDisciplina].sort()) {
    lista.sort((a, b) => (a.metadados.aulaNumero ?? 999) - (b.metadados.aulaNumero ?? 999));
    linhas.push(`## ${disciplina}`, "");
    const aulas = lista.filter((m) => !m.duplicadoDe).map((m) => m.metadados.aulaNumero).filter((n): n is number => n !== null);
    if (aulas.length) {
      const faltando: number[] = [];
      for (let n = Math.min(...aulas); n <= Math.max(...aulas); n++) if (!aulas.includes(n)) faltando.push(n);
      if (faltando.length) linhas.push(`> Aulas ausentes na sequência: ${faltando.join(", ")}`, "");
    }
    for (const m of lista) {
      const dup = m.duplicadoDe ? ` — **duplicado de** \`${m.duplicadoDe}\`` : "";
      linhas.push(`### Aula ${m.metadados.aulaNumero ?? "?"} — \`${m.caminho}\`${dup}`);
      linhas.push(`${m.totalPaginas} páginas · ${m.metadados.dataMaterial ?? "sem data"} · ${m.metadados.autor ?? "autor não identificado"}`, "");
      for (const s of m.secoes) {
        const assunto = s.assunto ? ` → **${s.assunto}**${s.subassunto ? ` / ${s.subassunto}` : ""}` : "";
        linhas.push(`- p. ${s.paginaInicio}–${s.paginaFim} [${s.tipo}] ${s.titulo}${assunto}`);
      }
      for (const a of m.avisos) linhas.push(`- ⚠ ${a}`);
      linhas.push("");
    }
  }
  if (ignorados.length) {
    linhas.push(`## Arquivos ignorados`, "");
    for (const i of ignorados) linhas.push(`- \`${i.caminho}\`: ${i.motivo}`);
  }
  writeFileSync(join(saida, "inventario.md"), linhas.join("\n"));
  console.error(`Relatório salvo em ${saida}/inventario.md`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
