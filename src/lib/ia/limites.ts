/**
 * Tempo de espera sugerido pelo provedor num 429, em ms. O Gemini informa
 * "Please retry in 7h7m57.3s" na mensagem e/ou RetryInfo.retryDelay ("42s").
 */
export function esperaSugerida(corpo: string): number | null {
  const atraso = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(corpo);
  if (atraso) return Math.ceil(Number(atraso[1]) * 1000);
  const m = /retry in ((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?)/i.exec(corpo);
  if (!m || !m[1]) return null;
  const h = Number(/(\d+)h/.exec(m[1])?.[1] ?? 0);
  const min = Number(/(\d+)m(?!s)/.exec(m[1])?.[1] ?? 0);
  const s = Number(/(\d+(?:\.\d+)?)s/.exec(m[1])?.[1] ?? 0);
  return Math.ceil((h * 3600 + min * 60 + s) * 1000);
}
