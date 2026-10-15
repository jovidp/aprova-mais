/**
 * Seleção de questões para simulados (funções puras, determinísticas com semente).
 *
 * 1. Filtra as candidatas pelo modo (inéditas, erros, excluir respondidas).
 * 2. Divide a quantidade entre grupos (disciplina ou assunto) pelo método dos
 *    maiores restos, conforme os pesos; o que um grupo não consegue suprir é
 *    redistribuído entre os que têm sobra.
 * 3. Dentro de cada grupo respeita a distribuição de dificuldade pedida,
 *    preferindo questões menos respondidas.
 * 4. Informa o déficit (grupo × dificuldade) quando não há questões suficientes,
 *    para gerar com IA ou oferecer alternativas. Nunca inventa questões.
 */

export type Dificuldade = "facil" | "medio" | "dificil";

export interface Candidata {
  id: string;
  disciplina_id: string;
  assunto_id: string | null;
  dificuldade: Dificuldade;
  tipo: string;
  vezes_respondida: number;
  ultima_correta: boolean | null;
}

export interface ConfigSelecao {
  quantidade: number;
  agruparPor: "disciplina" | "assunto";
  /** Peso de cada grupo (id da disciplina ou assunto). Grupos ausentes têm peso 0. Vazio = pesos iguais entre os disponíveis. */
  pesos: Record<string, number>;
  /** Proporção desejada por dificuldade (soma qualquer; é normalizada). */
  dificuldades: Partial<Record<Dificuldade, number>>;
  modo: "todas" | "ineditas" | "erros";
  ordem: "aleatoria" | "organizada";
  semente?: number;
}

export interface Deficit {
  grupo: string;
  faltam: number;
}

export interface ResultadoSelecao {
  ids: string[];
  porGrupo: Record<string, number>;
  deficits: Deficit[];
  disponiveis: number;
}

/** Gerador pseudoaleatório determinístico (mulberry32). */
export function aleatorio(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function embaralhar<T>(lista: T[], rnd: () => number): T[] {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Maiores restos: divide `total` proporcionalmente aos pesos, respeitando limites. */
export function repartir(total: number, pesos: Record<string, number>, limites: Record<string, number>): Record<string, number> {
  const chaves = Object.keys(pesos).filter((k) => pesos[k] > 0 && (limites[k] ?? 0) > 0);
  const resultado: Record<string, number> = Object.fromEntries(chaves.map((k) => [k, 0]));
  let restante = total;
  let ativos = chaves;
  while (restante > 0 && ativos.length > 0) {
    const soma = ativos.reduce((s, k) => s + pesos[k], 0);
    const cotas = ativos.map((k) => ({ k, exato: (restante * pesos[k]) / soma }));
    const atribuido = cotas.map((c) => ({ ...c, n: Math.min(Math.floor(c.exato), limites[c.k] - resultado[c.k]) }));
    let distribuido = 0;
    for (const a of atribuido) { resultado[a.k] += a.n; distribuido += a.n; }
    let sobra = restante - distribuido;
    const porResto = [...atribuido].sort((x, y) => (y.exato - Math.floor(y.exato)) - (x.exato - Math.floor(x.exato)) || pesos[y.k] - pesos[x.k]);
    for (const a of porResto) {
      if (sobra <= 0) break;
      if (resultado[a.k] < limites[a.k]) { resultado[a.k]++; sobra--; }
    }
    const novoRestante = sobra;
    if (novoRestante === restante) break;
    restante = novoRestante;
    ativos = ativos.filter((k) => resultado[k] < limites[k]);
  }
  return resultado;
}

const ORDEM_DIFICULDADE: Dificuldade[] = ["facil", "medio", "dificil"];

export function selecionarQuestoes(candidatas: Candidata[], c: ConfigSelecao): ResultadoSelecao {
  const rnd = aleatorio(c.semente ?? 1);
  const somaDif = ORDEM_DIFICULDADE.reduce((s, d) => s + (c.dificuldades[d] ?? 0), 0);
  const proporcao = Object.fromEntries(ORDEM_DIFICULDADE.map((d) => [d, somaDif > 0 ? c.dificuldades[d] ?? 0 : 1])) as Record<Dificuldade, number>;
  const permitidas = ORDEM_DIFICULDADE.filter((d) => proporcao[d] > 0);

  const filtradas = candidatas.filter((q) =>
    permitidas.includes(q.dificuldade) &&
    (c.modo === "ineditas" ? q.vezes_respondida === 0 : c.modo === "erros" ? q.ultima_correta === false : true));
  const chave = (q: Candidata) => (c.agruparPor === "assunto" ? q.assunto_id ?? "sem-assunto" : q.disciplina_id);

  const grupos = new Map<string, Candidata[]>();
  for (const q of filtradas) grupos.set(chave(q), [...(grupos.get(chave(q)) ?? []), q]);

  const pesosInformados = Object.keys(c.pesos).length > 0;
  const pesosAlvo: Record<string, number> = pesosInformados
    ? Object.fromEntries(Object.entries(c.pesos).filter(([, v]) => v > 0))
    : Object.fromEntries([...grupos.keys()].map((k) => [k, 1]));
  const limites = Object.fromEntries([...grupos].map(([k, l]) => [k, l.length]));
  const porGrupo = repartir(c.quantidade, Object.fromEntries(Object.entries(pesosAlvo).filter(([k]) => grupos.has(k))), limites);

  const escolhidas: Candidata[] = [];
  for (const [grupo, n] of Object.entries(porGrupo)) {
    if (n === 0) continue;
    const doGrupo = grupos.get(grupo)!;
    const porDif = new Map<Dificuldade, Candidata[]>();
    for (const d of permitidas) {
      // Menos respondidas primeiro; empates resolvidos aleatoriamente.
      porDif.set(d, embaralhar(doGrupo.filter((q) => q.dificuldade === d), rnd).sort((a, b) => a.vezes_respondida - b.vezes_respondida));
    }
    const alvo = repartir(n, proporcao, Object.fromEntries(permitidas.map((d) => [d, n])));
    const tomados = Object.fromEntries(permitidas.map((d) => [d, Math.min(alvo[d] ?? 0, porDif.get(d)!.length)])) as Record<string, number>;
    // O que faltar numa dificuldade vem das outras permitidas (a capacidade do grupo garante que cabe).
    let falta = n - Object.values(tomados).reduce((s, v) => s + v, 0);
    for (const d of [...permitidas].sort((a, b) => proporcao[b] - proporcao[a])) {
      if (falta <= 0) break;
      const extra = Math.min(falta, porDif.get(d)!.length - tomados[d]);
      tomados[d] += extra;
      falta -= extra;
    }
    for (const d of permitidas) escolhidas.push(...porDif.get(d)!.slice(0, tomados[d]));
  }

  // Déficit: o que faltou para a quantidade pedida, atribuído aos grupos que ficaram
  // abaixo da cota ideal (sem limite de estoque).
  const deficits: Deficit[] = [];
  const faltaTotal = c.quantidade - escolhidas.length;
  if (faltaTotal > 0) {
    const chavesAlvo = Object.keys(pesosAlvo).length ? Object.keys(pesosAlvo) : ["geral"];
    const ideal = repartir(c.quantidade, chavesAlvo.length ? Object.fromEntries(chavesAlvo.map((k) => [k, pesosAlvo[k] ?? 1])) : { geral: 1 },
      Object.fromEntries(chavesAlvo.map((k) => [k, c.quantidade])));
    const abaixo = Object.fromEntries(chavesAlvo.map((k) => [k, Math.max(0, (ideal[k] ?? 0) - (porGrupo[k] ?? 0))]).filter(([, v]) => (v as number) > 0));
    const reparticao = Object.keys(abaixo).length
      ? repartir(faltaTotal, abaixo as Record<string, number>, Object.fromEntries(Object.keys(abaixo).map((k) => [k, faltaTotal])))
      : { geral: faltaTotal };
    for (const [grupo, faltam] of Object.entries(reparticao)) if (faltam > 0) deficits.push({ grupo, faltam });
  }

  const ordenadas = c.ordem === "aleatoria"
    ? embaralhar(escolhidas, rnd)
    : [...escolhidas].sort((a, b) => a.disciplina_id.localeCompare(b.disciplina_id) || (a.assunto_id ?? "").localeCompare(b.assunto_id ?? "") ||
        ORDEM_DIFICULDADE.indexOf(a.dificuldade) - ORDEM_DIFICULDADE.indexOf(b.dificuldade));

  return { ids: ordenadas.map((q) => q.id), porGrupo, deficits, disponiveis: filtradas.length };
}

/** Pesos do simulado adaptativo: mais peso a assuntos com menor acerto, sem zerar os demais. */
export function pesosAdaptativos(taxasPorAssunto: Record<string, number | null>, minimo = 0.5): Record<string, number> {
  return Object.fromEntries(Object.entries(taxasPorAssunto).map(([k, taxa]) => [k, taxa === null ? 1 : Math.max(minimo, 1 + 2 * (0.75 - taxa))]));
}
