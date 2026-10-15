/**
 * Leitor de ZIP por acesso aleatório (Blob.slice): lê o diretório central e
 * extrai uma entrada por vez, sem carregar o arquivo inteiro na memória.
 * Funciona no navegador (File) e no Node (fs.openAsBlob).
 *
 * Segurança: limites de entradas e tamanhos (zip-seguranca), descompactação em
 * fluxo interrompida ao exceder o tamanho declarado e verificação de CRC32.
 */
import { Inflate } from "fflate";
import { LIMITES_ZIP, avaliarEntrada, conteudoCompativel, decodificarNomeZip, type DecisaoEntrada } from "./zip-seguranca";

export interface EntradaZip {
  nome: string;
  utf8: boolean;
  metodo: number;
  crc32: number;
  tamanhoCompactado: number;
  tamanhoOriginal: number;
  deslocamentoCabecalho: number;
  diretorio: boolean;
}

export class ErroZip extends Error {}

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_EOCD64 = 0x06064b50;
const ASSINATURA_LOCALIZADOR64 = 0x07064b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

async function lerFaixa(blob: Blob, inicio: number, fim: number): Promise<DataView> {
  const buffer = await blob.slice(inicio, fim).arrayBuffer();
  return new DataView(buffer);
}

function u64(v: DataView, pos: number) {
  const baixo = v.getUint32(pos, true);
  const alto = v.getUint32(pos + 4, true);
  if (alto > 0x1fffff) throw new ErroZip("Tamanho fora do limite suportado");
  return alto * 0x100000000 + baixo;
}

/** Lê o diretório central (suporta ZIP64). */
export async function listarEntradas(blob: Blob): Promise<EntradaZip[]> {
  if (blob.size < 22) throw new ErroZip("Arquivo ZIP inválido");
  if (blob.size > LIMITES_ZIP.tamanhoZipMax) throw new ErroZip("ZIP maior que o limite permitido");

  const tamanhoBusca = Math.min(blob.size, 22 + 0xffff);
  const fim = await lerFaixa(blob, blob.size - tamanhoBusca, blob.size);
  let eocd = -1;
  for (let i = fim.byteLength - 22; i >= 0; i--) {
    if (fim.getUint32(i, true) === ASSINATURA_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErroZip("Fim do diretório central não encontrado (ZIP corrompido?)");

  let total = fim.getUint16(eocd + 10, true);
  let tamanhoDiretorio = fim.getUint32(eocd + 12, true);
  let inicioDiretorio = fim.getUint32(eocd + 16, true);

  if (total === 0xffff || tamanhoDiretorio === 0xffffffff || inicioDiretorio === 0xffffffff) {
    const posLocalizador = eocd - 20;
    if (posLocalizador < 0 || fim.getUint32(posLocalizador, true) !== ASSINATURA_LOCALIZADOR64) throw new ErroZip("ZIP64 sem localizador");
    const posEocd64 = u64(fim, posLocalizador + 8);
    const e64 = await lerFaixa(blob, posEocd64, posEocd64 + 56);
    if (e64.getUint32(0, true) !== ASSINATURA_EOCD64) throw new ErroZip("Registro ZIP64 inválido");
    total = u64(e64, 32);
    tamanhoDiretorio = u64(e64, 40);
    inicioDiretorio = u64(e64, 48);
  }
  if (total > LIMITES_ZIP.entradasMax) throw new ErroZip(`ZIP com mais de ${LIMITES_ZIP.entradasMax} arquivos`);
  if (inicioDiretorio + tamanhoDiretorio > blob.size) throw new ErroZip("Diretório central fora do arquivo");

  const dir = await lerFaixa(blob, inicioDiretorio, inicioDiretorio + tamanhoDiretorio);
  const entradas: EntradaZip[] = [];
  let pos = 0;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > dir.byteLength || dir.getUint32(pos, true) !== ASSINATURA_CENTRAL) throw new ErroZip("Diretório central corrompido");
    const flags = dir.getUint16(pos + 8, true);
    const metodo = dir.getUint16(pos + 10, true);
    const crc32 = dir.getUint32(pos + 16, true);
    let tamanhoCompactado = dir.getUint32(pos + 20, true);
    let tamanhoOriginal = dir.getUint32(pos + 24, true);
    const tamNome = dir.getUint16(pos + 28, true);
    const tamExtra = dir.getUint16(pos + 30, true);
    const tamComentario = dir.getUint16(pos + 32, true);
    let deslocamento = dir.getUint32(pos + 42, true);
    const bytesNome = new Uint8Array(dir.buffer, dir.byteOffset + pos + 46, tamNome);
    const utf8 = (flags & 0x800) !== 0;

    // Campo extra ZIP64 (id 0x0001) com tamanhos/deslocamento de 64 bits.
    let p = pos + 46 + tamNome;
    const fimExtra = p + tamExtra;
    while (p + 4 <= fimExtra) {
      const id = dir.getUint16(p, true);
      const tam = dir.getUint16(p + 2, true);
      if (id === 0x0001) {
        let q = p + 4;
        if (tamanhoOriginal === 0xffffffff) { tamanhoOriginal = u64(dir, q); q += 8; }
        if (tamanhoCompactado === 0xffffffff) { tamanhoCompactado = u64(dir, q); q += 8; }
        if (deslocamento === 0xffffffff) { deslocamento = u64(dir, q); }
      }
      p += 4 + tam;
    }

    const nome = decodificarNomeZip(bytesNome, utf8);
    entradas.push({
      nome, utf8, metodo, crc32, tamanhoCompactado, tamanhoOriginal, deslocamentoCabecalho: deslocamento,
      diretorio: nome.endsWith("/") || nome.endsWith("\\"),
    });
    pos += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array, inicial = 0): number {
  let c = (inicial ^ 0xffffffff) >>> 0;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Extrai uma entrada, conferindo tamanho e CRC32. */
export async function extrairEntrada(blob: Blob, entrada: EntradaZip): Promise<Uint8Array> {
  if (entrada.tamanhoOriginal > LIMITES_ZIP.arquivoMax) throw new ErroZip("Arquivo maior que o limite");
  const cab = await lerFaixa(blob, entrada.deslocamentoCabecalho, entrada.deslocamentoCabecalho + 30);
  if (cab.getUint32(0, true) !== ASSINATURA_LOCAL) throw new ErroZip("Cabeçalho local inválido");
  if (cab.getUint16(6, true) & 0x1) throw new ErroZip("Arquivos criptografados não são suportados");
  const inicioDados = entrada.deslocamentoCabecalho + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
  if (inicioDados + entrada.tamanhoCompactado > blob.size) throw new ErroZip("Dados fora do arquivo");

  const saida = new Uint8Array(entrada.tamanhoOriginal);
  let escrito = 0;

  if (entrada.metodo === 0) {
    if (entrada.tamanhoCompactado !== entrada.tamanhoOriginal) throw new ErroZip("Tamanho inconsistente");
    saida.set(new Uint8Array(await blob.slice(inicioDados, inicioDados + entrada.tamanhoCompactado).arrayBuffer()));
    escrito = saida.length;
  } else if (entrada.metodo === 8) {
    const inflador = new Inflate((pedaco) => {
      if (escrito + pedaco.length > saida.length) throw new ErroZip("Conteúdo maior que o declarado (possível ZIP bomb)");
      saida.set(pedaco, escrito);
      escrito += pedaco.length;
    });
    const PASSO = 4 * 1024 * 1024;
    for (let p = 0; p < entrada.tamanhoCompactado; p += PASSO) {
      const fimPedaco = Math.min(entrada.tamanhoCompactado, p + PASSO);
      const pedaco = new Uint8Array(await blob.slice(inicioDados + p, inicioDados + fimPedaco).arrayBuffer());
      inflador.push(pedaco, fimPedaco >= entrada.tamanhoCompactado);
    }
  } else {
    throw new ErroZip(`Método de compressão ${entrada.metodo} não suportado`);
  }

  if (escrito !== entrada.tamanhoOriginal) throw new ErroZip("Conteúdo menor que o declarado");
  if (crc32(saida) !== entrada.crc32) throw new ErroZip("Falha de integridade (CRC32)");
  return saida;
}

export interface PlanoExtracao {
  aceitas: (EntradaZip & DecisaoEntrada)[];
  ignoradas: { caminho: string; motivo: string }[];
  totalDescompactado: number;
}

/** Decide o que extrair antes de descompactar qualquer byte. */
export function planejarExtracao(entradas: EntradaZip[]): PlanoExtracao {
  const aceitas: PlanoExtracao["aceitas"] = [];
  const ignoradas: PlanoExtracao["ignoradas"] = [];
  let total = 0;
  for (const e of entradas) {
    if (e.diretorio) continue;
    const decisao = avaliarEntrada(e.nome, e.tamanhoCompactado, e.tamanhoOriginal, true);
    if (!decisao.aceita) {
      ignoradas.push({ caminho: decisao.caminho, motivo: decisao.motivo ?? "Ignorado" });
      continue;
    }
    total += e.tamanhoOriginal;
    if (total > LIMITES_ZIP.totalDescompactadoMax) throw new ErroZip("Conteúdo descompactado acima do limite total");
    aceitas.push({ ...e, ...decisao });
  }
  return { aceitas, ignoradas, totalDescompactado: total };
}

export { conteudoCompativel };
