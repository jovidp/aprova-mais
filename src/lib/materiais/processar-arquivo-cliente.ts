"use client";

import type { ResultadoAnalise } from "./tipos";
import type { TipoArquivo } from "./zip-seguranca";
import { analisarPaginas } from "./analisador";
import { lerDocumento, type DocumentoPdfJs } from "./extracao-pdf";
import { analisarTextoSimples } from "./texto-simples";
import { carregarPdfjs } from "./pdfjs-cliente";

/** Converte o HTML do mammoth em texto com títulos em Markdown ("# "). */
function htmlParaTexto(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const partes: string[] = [];
  doc.body.querySelectorAll("h1, h2, h3, h4, p, li, td").forEach((el) => {
    const texto = el.textContent?.replace(/\s+/g, " ").trim();
    if (!texto) return;
    const nivel = /^H([1-3])$/.exec(el.tagName)?.[1];
    partes.push(nivel ? `${"#".repeat(Number(nivel))} ${texto}` : el.tagName === "LI" ? `• ${texto}` : texto);
  });
  return partes.join("\n\n");
}

/** Lê e classifica o arquivo no navegador, com o mesmo pipeline usado no servidor. */
export async function analisarArquivo(
  tipo: TipoArquivo,
  dados: Uint8Array,
  caminho: string,
  aoProgredir?: (lidas: number, total: number) => void,
): Promise<ResultadoAnalise> {
  if (tipo === "pdf") {
    const pdfjs = await carregarPdfjs();
    // O PDF.js transfere o buffer para o worker; passamos uma cópia.
    const tarefa = pdfjs.getDocument({ data: dados.slice(), disableFontFace: true });
    try {
      const documento = await tarefa.promise;
      const paginas = await lerDocumento(documento as unknown as DocumentoPdfJs, aoProgredir);
      return analisarPaginas(paginas, caminho);
    } finally {
      await tarefa.destroy();
    }
  }
  if (tipo === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: dados.slice().buffer as ArrayBuffer });
    return analisarTextoSimples(htmlParaTexto(value), caminho);
  }
  return analisarTextoSimples(new TextDecoder("utf-8").decode(dados), caminho);
}
