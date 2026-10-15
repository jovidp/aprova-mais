/**
 * Regras de segurança para ZIPs de materiais. Compartilhadas entre o importador
 * do navegador e os scripts de linha de comando.
 *
 * Proteções: tamanho do ZIP, quantidade de entradas, tamanho total e por arquivo
 * descompactado, razão de compressão (ZIP bomb), caminhos maliciosos
 * (path traversal, absolutos), arquivos ocultos/sistema, ZIPs aninhados e
 * verificação do conteúdo real pelos bytes iniciais.
 */

export const LIMITES_ZIP = {
  /** Tamanho máximo do .zip enviado. */
  tamanhoZipMax: 2 * 1024 ** 3,
  entradasMax: 5000,
  /** Soma dos arquivos aceitos, descompactados. */
  totalDescompactadoMax: 3 * 1024 ** 3,
  /** Limite por arquivo (o plano gratuito do Supabase Storage aceita até 50 MB por upload). */
  arquivoMax: 50 * 1024 ** 2,
  /** Arquivos acima deste tamanho com compressão maior que a razão abaixo são rejeitados. */
  razaoCompressaoMax: 100,
  razaoMinimoBytes: 1024 * 1024,
} as const;

export type TipoArquivo = "pdf" | "docx" | "txt" | "md";

const EXTENSOES: Record<string, TipoArquivo> = { pdf: "pdf", docx: "docx", txt: "txt", md: "md" };

export interface DecisaoEntrada {
  aceita: boolean;
  tipo?: TipoArquivo;
  motivo?: string;
  caminho: string;
}

const CP850_ALTO =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

const LATIN1_PORTUGUES = /[ÁÂÃÀÇÉÊÍÓÔÕÚÜáâãàçéêíóôõúü]/;
const LATIN1_IMPROVAVEL = /[\u0080-\u009f¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ÆÐ×ØÞßæðøþ÷]/;

/**
 * Nomes de ZIPs criados no Windows sem a flag UTF-8 vêm em CP850, e a biblioteca
 * de descompactação os entrega byte a byte (latin1). Quando a flag existe, o nome
 * já chega correto. Distinção:
 *  - bytes que formam UTF-8 válido → nome UTF-8 lido como latin1 (decodifica);
 *  - caracteres de controle C1 ou símbolos improváveis sem letras acentuadas
 *    do português → CP850;
 *  - caso contrário, o nome já está correto.
 */
export function corrigirNomeZip(nome: string): string {
  const codigos = [...nome].map((c) => c.charCodeAt(0));
  if (!codigos.some((c) => c > 127) || codigos.some((c) => c > 255)) return nome;
  const bytes = Uint8Array.from(codigos);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const pareceCp850 =
      /[\u0080-\u009f]/.test(nome) || (LATIN1_IMPROVAVEL.test(nome) && !LATIN1_PORTUGUES.test(nome));
    if (!pareceCp850) return nome;
    return [...bytes].map((b) => (b < 128 ? String.fromCharCode(b) : CP850_ALTO[b - 128])).join("");
  }
}

/** Decodifica o nome a partir dos bytes crus: UTF-8 com a flag (ou se válido), senão CP850. */
export function decodificarNomeZip(bytes: Uint8Array, utf8: boolean): string {
  if (utf8 || bytes.every((b) => b < 128)) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return [...bytes].map((b) => (b < 128 ? String.fromCharCode(b) : CP850_ALTO[b - 128])).join("");
  }
}

export function caminhoSeguro(caminho: string): string | null {
  const normalizado = caminho.replace(/\\/g, "/");
  if (normalizado.startsWith("/") || /^[a-zA-Z]:/.test(normalizado)) return null;
  const partes = normalizado.split("/").filter((p) => p.length > 0);
  if (partes.some((p) => p === ".." || p === ".")) return null;
  if (partes.some((p) => /[\u0000-\u001f]/.test(p))) return null;
  return partes.join("/");
}

/** Decide se uma entrada do ZIP deve ser extraída, antes de descompactar. */
export function avaliarEntrada(
  nomeBruto: string,
  tamanhoCompactado: number | undefined,
  tamanhoOriginal: number | undefined,
  nomeJaDecodificado = false,
): DecisaoEntrada {
  const nome = nomeJaDecodificado ? nomeBruto : corrigirNomeZip(nomeBruto);
  const caminho = caminhoSeguro(nome);
  if (!caminho) return { aceita: false, caminho: nome, motivo: "Caminho inválido ou inseguro" };
  if (caminho.endsWith("/") || nome.endsWith("/")) return { aceita: false, caminho, motivo: "Pasta" };

  const partes = caminho.split("/");
  const arquivo = partes[partes.length - 1];
  if (partes.some((p) => p.startsWith(".")) || partes.includes("__MACOSX")) {
    return { aceita: false, caminho, motivo: "Arquivo ou pasta oculta" };
  }
  if (/^(thumbs\.db|desktop\.ini)$/i.test(arquivo)) return { aceita: false, caminho, motivo: "Arquivo de sistema" };

  const extensao = arquivo.includes(".") ? arquivo.split(".").pop()!.toLowerCase() : "";
  if (extensao === "zip" || extensao === "rar" || extensao === "7z") {
    return { aceita: false, caminho, motivo: "Arquivos compactados dentro do ZIP não são extraídos" };
  }
  const tipo = EXTENSOES[extensao];
  if (!tipo) return { aceita: false, caminho, motivo: `Formato .${extensao || "sem extensão"} não suportado` };

  if (tamanhoOriginal !== undefined) {
    if (tamanhoOriginal > LIMITES_ZIP.arquivoMax) {
      return { aceita: false, caminho, motivo: `Arquivo maior que ${LIMITES_ZIP.arquivoMax / 1024 ** 2} MB` };
    }
    if (
      tamanhoCompactado !== undefined &&
      tamanhoCompactado > 0 &&
      tamanhoOriginal > LIMITES_ZIP.razaoMinimoBytes &&
      tamanhoOriginal / tamanhoCompactado > LIMITES_ZIP.razaoCompressaoMax
    ) {
      return { aceita: false, caminho, motivo: "Razão de compressão suspeita (possível ZIP bomb)" };
    }
  }
  return { aceita: true, caminho, tipo };
}

/** Confere o conteúdo real do arquivo pelos bytes iniciais. */
export function conteudoCompativel(tipo: TipoArquivo, inicio: Uint8Array): boolean {
  if (tipo === "pdf") {
    const cabecalho = new TextDecoder("latin1").decode(inicio.subarray(0, 1024));
    return cabecalho.includes("%PDF-");
  }
  if (tipo === "docx") {
    return inicio[0] === 0x50 && inicio[1] === 0x4b && inicio[2] === 0x03 && inicio[3] === 0x04;
  }
  // Texto: não pode conter bytes nulos e precisa ser UTF-8 válido.
  if (inicio.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(inicio.subarray(0, Math.min(inicio.length, 64 * 1024)));
    return true;
  } catch {
    // O corte pode ter partido um caractere multibyte no fim; aceita se o restante é válido.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(inicio.subarray(0, Math.max(0, Math.min(inicio.length, 64 * 1024) - 3)));
      return true;
    } catch {
      return false;
    }
  }
}

export const MIME_POR_TIPO: Record<TipoArquivo, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};
