import { chaveNome } from "./normalizacao";

/**
 * Catálogo de nomes canônicos. Serve apenas para unificar grafias
 * (pastas abreviadas, erros de digitação); disciplinas fora do catálogo
 * são aceitas com o nome encontrado.
 */
const CATALOGO: { nome: string; apelidos: string[] }[] = [
  { nome: "Direito Constitucional", apelidos: ["direito constitucional", "constitucional", "dir constitucional"] },
  {
    nome: "Direito Administrativo",
    apelidos: ["direito administrativo", "nocoes de direito administrativo", "direito adm", "dir adm", "dir administrativo"],
  },
  { nome: "Português", apelidos: ["portugues", "lingua portuguesa", "lingua portugues"] },
  {
    nome: "Raciocínio Lógico-Matemático",
    apelidos: ["raciocinio logico-matematica", "raciocinio logico-matematico", "raciocinio logico matematico", "raciocinio logico", "rlm"],
  },
  { nome: "Informática", apelidos: ["informatica", "nocoes de informatica"] },
  { nome: "Ética e Conduta Pública", apelidos: ["etica e conduta publica", "etica", "etica no servico publico"] },
  { nome: "Arquivologia", apelidos: ["arquivologia", "nocoes de arquivologia"] },
  { nome: "Noções de Administração", apelidos: ["nocoes de administracao", "nocoes adm", "administracao geral", "administracao"] },
  {
    nome: "Legislação Relativa à PRF",
    apelidos: ["legislacao relativa a policia rodoviaria federal", "legislacao prf", "legislacao  prf", "lei prf"],
  },
];

function distancia(a: string, b: string) {
  const m = a.length;
  const n = b.length;
  const linha = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let anterior = linha[0];
    linha[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = linha[j];
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return linha[n];
}

function tituloCapitalizado(texto: string) {
  const minusculas = new Set(["de", "da", "do", "das", "dos", "e", "a", "à", "o", "em", "no", "na"]);
  return texto
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

export function normalizarNomeDisciplina(nome: string): string {
  const chave = chaveNome(nome);
  if (!chave) return nome.trim();
  for (const item of CATALOGO) {
    if (item.apelidos.some((a) => chaveNome(a) === chave)) return item.nome;
  }
  // Tolerância a erros de digitação (ex.: "DIREITO CONSTITUCIOANL").
  for (const item of CATALOGO) {
    for (const apelido of item.apelidos) {
      const alvo = chaveNome(apelido);
      if (alvo.length >= 8 && distancia(chave, alvo) <= 2) return item.nome;
    }
  }
  const limpo = nome.replace(/\s+/g, " ").trim();
  return limpo === limpo.toUpperCase() ? tituloCapitalizado(limpo) : limpo;
}
