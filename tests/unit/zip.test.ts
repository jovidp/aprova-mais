import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { crc32, extrairEntrada, listarEntradas, planejarExtracao, ErroZip } from "@/lib/materiais/leitor-zip";
import { avaliarEntrada, caminhoSeguro, conteudoCompativel, corrigirNomeZip, decodificarNomeZip } from "@/lib/materiais/zip-seguranca";

const PDF_FALSO = strToU8("%PDF-1.7\n% conteúdo de teste\n");

function blobDe(arquivos: Record<string, Uint8Array>, nivel: 0 | 9 = 9) {
  const zip = zipSync(Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, [v, { level: nivel }]])));
  return new Blob([zip as BlobPart]);
}

describe("segurança de entradas", () => {
  it("rejeita caminhos maliciosos", () => {
    expect(caminhoSeguro("../../etc/passwd")).toBeNull();
    expect(caminhoSeguro("/abs/arquivo.pdf")).toBeNull();
    expect(caminhoSeguro("C:\\Windows\\x.pdf")).toBeNull();
    expect(caminhoSeguro("pasta/./x.pdf")).toBeNull();
    expect(caminhoSeguro("DIREITO/aula 01.pdf")).toBe("DIREITO/aula 01.pdf");
  });

  it("ignora ocultos, sistema, formatos não suportados e ZIPs aninhados", () => {
    expect(avaliarEntrada(".docs/x.pdf", 10, 10).motivo).toMatch(/oculta/);
    expect(avaliarEntrada("__MACOSX/x.pdf", 10, 10).motivo).toMatch(/oculta/);
    expect(avaliarEntrada("a/Thumbs.db", 10, 10).motivo).toMatch(/sistema/);
    expect(avaliarEntrada("a/foto.png", 10, 10).motivo).toMatch(/não suportado/);
    expect(avaliarEntrada("a/outro.zip", 10, 10).motivo).toMatch(/compactados/);
    expect(avaliarEntrada("a/aula.PDF", 10, 10)).toMatchObject({ aceita: true, tipo: "pdf" });
  });

  it("detecta razão de compressão suspeita e arquivos grandes demais", () => {
    expect(avaliarEntrada("a.pdf", 10_000, 50 * 1024 * 1024).motivo).toMatch(/ZIP bomb/);
    expect(avaliarEntrada("a.pdf", 60 * 1024 ** 2, 60 * 1024 ** 2).motivo).toMatch(/maior que/);
  });

  it("confere o conteúdo real pelos bytes iniciais", () => {
    expect(conteudoCompativel("pdf", PDF_FALSO)).toBe(true);
    expect(conteudoCompativel("pdf", strToU8("MZ executável"))).toBe(false);
    expect(conteudoCompativel("txt", new Uint8Array([65, 0, 66]))).toBe(false);
  });

  it("decodifica nomes em UTF-8 e CP850", () => {
    expect(decodificarNomeZip(new Uint8Array([0x4e, 0x4f, 0x80, 0xe5, 0x45, 0x53]), false)).toBe("NOÇÕES");
    expect(decodificarNomeZip(strToU8("NOÇÕES"), true)).toBe("NOÇÕES");
    // Nome já correto não é "consertado" de novo.
    expect(corrigirNomeZip("NOÇÕES ADM/ADM 01.pdf")).toBe("NOÇÕES ADM/ADM 01.pdf");
  });
});

describe("leitor de ZIP por acesso aleatório", () => {
  it("lista e extrai entradas com CRC correto", async () => {
    const blob = blobDe({ "DIREITO CONSTITUCIONAL/aula 05.pdf": PDF_FALSO, "notas/leia.txt": strToU8("olá") });
    const entradas = await listarEntradas(blob);
    expect(entradas.map((e) => e.nome).sort()).toEqual(["DIREITO CONSTITUCIONAL/aula 05.pdf", "notas/leia.txt"]);
    const pdf = entradas.find((e) => e.nome.endsWith(".pdf"))!;
    const dados = await extrairEntrada(blob, pdf);
    expect(new TextDecoder().decode(dados)).toBe(new TextDecoder().decode(PDF_FALSO));
    expect(crc32(dados)).toBe(pdf.crc32);
  });

  it("extrai entradas armazenadas sem compressão", async () => {
    const blob = blobDe({ "a.txt": strToU8("texto simples") }, 0);
    const [e] = await listarEntradas(blob);
    expect(e.metodo).toBe(0);
    expect(new TextDecoder().decode(await extrairEntrada(blob, e))).toBe("texto simples");
  });

  it("detecta conteúdo maior que o declarado (ZIP adulterado)", async () => {
    const blob = blobDe({ "a.txt": strToU8("x".repeat(10_000)) });
    const [e] = await listarEntradas(blob);
    await expect(extrairEntrada(blob, { ...e, tamanhoOriginal: 100 })).rejects.toThrow(ErroZip);
  });

  it("detecta corrupção pelo CRC32", async () => {
    const blob = blobDe({ "a.txt": strToU8("conteúdo íntegro") });
    const [e] = await listarEntradas(blob);
    await expect(extrairEntrada(blob, { ...e, crc32: (e.crc32 + 1) >>> 0 })).rejects.toThrow(/CRC32/);
  });

  it("rejeita arquivo que não é ZIP", async () => {
    await expect(listarEntradas(new Blob([strToU8("não sou um zip, apenas texto qualquer")]))).rejects.toThrow(ErroZip);
  });

  it("planeja a extração ignorando o que não deve ser lido", async () => {
    const blob = blobDe({ "RLM/RLM 01.pdf": PDF_FALSO, ".docs/x.pdf": PDF_FALSO, "img/x.png": strToU8("png") });
    const plano = planejarExtracao(await listarEntradas(blob));
    expect(plano.aceitas.map((a) => a.caminho)).toEqual(["RLM/RLM 01.pdf"]);
    expect(plano.ignoradas).toHaveLength(2);
  });
});
