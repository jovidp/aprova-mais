import type { ItemTexto, PaginaBruta } from "./tipos";

/**
 * Subconjunto da API do PDF.js usado aqui. Tanto `pdfjs-dist` (navegador)
 * quanto `unpdf` (servidor) devolvem objetos compatíveis.
 */
interface ItemPdfJs {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}
interface PaginaPdfJs {
  getViewport(opcoes: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?: () => void;
}
export interface DocumentoPdfJs {
  numPages: number;
  getPage(numero: number): Promise<PaginaPdfJs>;
}

export async function lerPagina(documento: DocumentoPdfJs, numero: number): Promise<PaginaBruta> {
  const pagina = await documento.getPage(numero);
  const viewport = pagina.getViewport({ scale: 1 });
  const conteudo = await pagina.getTextContent();
  const itens: ItemTexto[] = [];
  for (const bruto of conteudo.items as ItemPdfJs[]) {
    if (typeof bruto.str !== "string" || !bruto.transform) continue;
    itens.push({
      str: bruto.str,
      x: bruto.transform[4],
      y: bruto.transform[5],
      largura: bruto.width ?? 0,
      altura: bruto.height || Math.abs(bruto.transform[3]) || 10,
    });
  }
  pagina.cleanup?.();
  return { numero, largura: viewport.width, altura: viewport.height, itens };
}

/** Lê todas as páginas, informando o progresso a cada página. */
export async function lerDocumento(
  documento: DocumentoPdfJs,
  aoProgredir?: (lidas: number, total: number) => void,
): Promise<PaginaBruta[]> {
  const paginas: PaginaBruta[] = [];
  for (let n = 1; n <= documento.numPages; n++) {
    paginas.push(await lerPagina(documento, n));
    aoProgredir?.(n, documento.numPages);
  }
  return paginas;
}
