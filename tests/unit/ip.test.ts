import { describe, expect, it } from "vitest";
import { ipDoCliente, ipValido, normalizarIp } from "@/lib/rede/ip";

describe("ipDoCliente", () => {
  it("usa o primeiro IP de x-forwarded-for", () => {
    expect(ipDoCliente(new Headers({ "x-forwarded-for": "177.129.211.58, 34.237.75.142" }))).toBe("177.129.211.58");
  });
  it("usa x-real-ip como alternativa e normaliza IPv4 mapeado", () => {
    expect(ipDoCliente(new Headers({ "x-real-ip": "::ffff:10.0.0.1" }))).toBe("10.0.0.1");
  });
  it("ignora valores inválidos", () => {
    expect(ipDoCliente(new Headers({ "x-forwarded-for": "não-é-ip" }))).toBeNull();
    expect(ipDoCliente(new Headers())).toBeNull();
  });
});

describe("ipValido", () => {
  it("aceita IPv4, IPv6 e faixas", () => {
    for (const ip of ["1.2.3.4", "177.129.211.0/24", "2001:db8::1", "2001:db8::/32", "::1"]) expect(ipValido(ip), ip).toBe(true);
  });
  it("rejeita formatos errados", () => {
    for (const ip of ["256.1.1.1", "1.2.3", "1.2.3.4/33", "abc", "1.2.3.4/x", "2001::db8::1"]) expect(ipValido(ip), ip).toBe(false);
  });
  it("normaliza", () => {
    expect(normalizarIp("::FFFF:1.2.3.4")).toBe("1.2.3.4");
    expect(normalizarIp("2001:DB8::1")).toBe("2001:db8::1");
  });
});
