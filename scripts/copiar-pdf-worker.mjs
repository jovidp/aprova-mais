// Copia o worker do PDF.js (mesma versão usada pelo react-pdf) para /public,
// servido como arquivo estático pelo leitor e pelo importador.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
try {
  const raiz = dirname(require.resolve("pdfjs-dist/package.json", { paths: [require.resolve("react-pdf")] }));
  const origem = join(raiz, "build", "pdf.worker.min.mjs");
  if (!existsSync("public")) mkdirSync("public");
  copyFileSync(origem, join("public", "pdf.worker.min.mjs"));
} catch (erro) {
  console.warn("[pdf-worker] não foi possível copiar o worker:", erro.message);
}
