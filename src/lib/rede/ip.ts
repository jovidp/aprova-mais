/**
 * IP real de quem fez a requisição. Na Vercel, o primeiro item de
 * x-forwarded-for é o cliente (a própria Vercel define o cabeçalho).
 */
export function ipDoCliente(cabecalhos: Headers): string | null {
  const encaminhado = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = normalizarIp(encaminhado || cabecalhos.get("x-real-ip") || "");
  return ipValido(ip) ? ip : null;
}

/** IPv4 ou IPv6, opcionalmente com máscara (/24, /64). */
export function ipValido(valor: string) {
  const [ip, mascara] = valor.trim().split("/");
  if (mascara !== undefined && !/^\d{1,3}$/.test(mascara)) return false;
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
  if (v4) return mascara === undefined || Number(mascara) <= 32;
  const v6 = /^[0-9a-f:]+$/i.test(ip) && ip.includes(":") && ip.split("::").length <= 2;
  return v6 && (mascara === undefined || Number(mascara) <= 128);
}

/** Remove o prefixo IPv4 mapeado em IPv6 (::ffff:1.2.3.4). */
export function normalizarIp(ip: string) {
  return ip.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1").toLowerCase();
}
