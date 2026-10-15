export function semAcentos(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Chave de comparação: sem acentos, minúscula, só letras e números separados por espaço. */
export function chaveNome(texto: string) {
  return semAcentos(texto).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Separa "A - B", "A- B" e "A -B", sem quebrar palavras compostas ("Político-Administrativa"). */
export const SEPARADOR_TITULO = /\s+[-–]\s*|\s*[-–]\s+/;

export function slugificar(texto: string) {
  return chaveNome(texto).replace(/\s+/g, "-").slice(0, 80);
}
