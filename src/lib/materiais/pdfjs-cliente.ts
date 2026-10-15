"use client";

/** PDF.js no navegador, com o worker servido de /public (mesma versão do react-pdf). */
export async function carregarPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

export async function sha256Hex(dados: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", dados as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
