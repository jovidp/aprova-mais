import { chaveNome, SEPARADOR_TITULO } from "./normalizacao";

export interface SugestaoAssunto {
  assunto: string;
  subassunto: string | null;
  confianca: number;
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "x", "ao", "aos", "um", "uma", "com", "para", "por"]);

/** Remove referências normativas entre parênteses e sufixos de formato. */
export function limparTitulo(titulo: string) {
  return titulo
    .replace(/\s*\((?:arts?\.|art\s|lei|cf\/?88|decreto|ec\b|sumula)[^)]*\)/gi, "")
    .replace(/\s+[-–]\s+aula completa\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–:.]+$/, "")
    .trim();
}

interface Token {
  base: string;
  abreviado: boolean;
}

function tokens(texto: string): Token[] {
  return texto
    .split(/\s+/)
    .map((bruto) => ({ base: chaveNome(bruto), abreviado: /\.$/.test(bruto) && chaveNome(bruto).length <= 5 }))
    .filter((t) => t.base && !PALAVRAS_VAZIAS.has(t.base));
}

function combina(a: Token, b: Token) {
  if (a.base === b.base) return true;
  if (a.abreviado && b.base.startsWith(a.base)) return true;
  if (b.abreviado && a.base.startsWith(b.base)) return true;
  // Plural/singular e pequenas variações ("competencia" / "competencias").
  const [menor, maior] = a.base.length <= b.base.length ? [a.base, b.base] : [b.base, a.base];
  return menor.length >= 5 && maior.startsWith(menor) && maior.length - menor.length <= 2;
}

/** Similaridade de Dice entre títulos, tolerante a abreviações ("Ind." ≈ "Individuais"). */
export function similaridadeTitulos(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const usados = new Set<number>();
  let iguais = 0;
  for (const t of ta) {
    const idx = tb.findIndex((u, i) => !usados.has(i) && combina(t, u));
    if (idx >= 0) {
      usados.add(idx);
      iguais++;
    }
  }
  return (2 * iguais) / (ta.length + tb.length);
}

/** Entre variantes do mesmo nome, prefere a sem abreviações e mais longa. */
export function melhorVariante(variantes: string[]) {
  return [...variantes].sort((a, b) => {
    const abrevA = tokens(a).filter((t) => t.abreviado).length;
    const abrevB = tokens(b).filter((t) => t.abreviado).length;
    return abrevA - abrevB || b.length - a.length;
  })[0];
}

/**
 * Taxonomias curadas a partir dos materiais reais. A ordem importa: a primeira
 * regra que casar vence (ex.: "Repartição de Competências e a Federação"
 * precisa cair em competências antes da regra de federação).
 */
const TAXONOMIAS_CURADAS: Record<string, { assunto: string; padrao: RegExp }[]> = {
  "direito constitucional": [
    { assunto: "Teoria da Constituição", padrao: /classificacao das constituicoes|aplicabilidade das normas|hierarquia das normas|poder constituinte|conceito de constituicao|teoria da constituicao|interpretacao constitucional|elementos da constituicao/ },
    { assunto: "Princípios Fundamentais", padrao: /principios fundamentais/ },
    { assunto: "Remédios Constitucionais", padrao: /remedios constitucionais|habeas corpus|habeas data|mandado de seguranca|mandado de injuncao|acao popular|acao civil publica/ },
    { assunto: "Teoria Geral dos Direitos Fundamentais", padrao: /teoria geral dos direitos fundamentais|geracoes dos direitos|caracteristicas dos direitos fundamentais|^direitos fundamentais/ },
    { assunto: "Direitos e Deveres Individuais e Coletivos", padrao: /direitos e deveres ind/ },
    { assunto: "Direitos Sociais", padrao: /direitos sociais|trabalhadores/ },
    { assunto: "Nacionalidade", padrao: /nacionalidade/ },
    { assunto: "Direitos Políticos", padrao: /direitos politicos/ },
    { assunto: "Partidos Políticos", padrao: /partidos politicos/ },
    { assunto: "Repartição de Competências", padrao: /reparticao de competencias|competencias (exclusivas|privativas|comuns|legislativas|dos estados|dos municipios)/ },
    { assunto: "Intervenção", padrao: /intervencao/ },
    { assunto: "Organização do Estado", padrao: /teoria geral do estado|federacao|organizacao politico|vedacoes federativas|bens publicos|bens da uniao|bens dos estados|territorios federais|organizacao do estado/ },
    { assunto: "Funções Essenciais à Justiça", padrao: /funcoes essenciais|ministerio publico|advocacia|defensoria/ },
    { assunto: "Administração Pública", padrao: /administracao publica|agentes publicos|responsabilidade civil do estado|servidores publicos|militares dos estados|regime juridico da administracao|outras disposicoes constitucionais/ },
    { assunto: "Fiscalização Contábil, Financeira e Orçamentária", padrao: /fiscalizacao contabil|tribunal de contas/ },
    { assunto: "Poder Legislativo", padrao: /poder legislativo|congresso nacional|camara dos deputados|senado federal|estatuto dos congressistas|processo legislativo|comissoes parlamentares/ },
    { assunto: "Poder Executivo", padrao: /poder executivo|forma de governo|sistema de governo|chefia de estado|presidente da republica|vice presidente|ministros de estado|conselho da republica|conselho de defesa|impedimento e vacancia|substituicao e sucessao/ },
    { assunto: "Poder Judiciário", padrao: /poder judiciario|magistratura|juizes|conselho nacional de justica|supremo tribunal|superior tribunal|justica (federal|do trabalho|eleitoral|militar)|tribunais e juizes|precatorios|quinto constitucional|juizados especiais|justica de paz/ },
    { assunto: "Controle de Constitucionalidade", padrao: /controle de constitucionalidade|adi\b|adc\b|adpf/ },
  ],
};

function assuntoCurado(disciplina: string | null, titulo: string): string | null {
  const regras = disciplina ? TAXONOMIAS_CURADAS[chaveNome(disciplina)] : undefined;
  if (!regras) return null;
  const chave = chaveNome(titulo);
  return regras.find((r) => r.padrao.test(chave))?.assunto ?? null;
}

/** Subassunto de um título dentro de um assunto: tira o prefixo redundante ou anula se for o próprio assunto. */
function subassuntoDe(assunto: string, titulo: string): string | null {
  if (similaridadeTitulos(assunto, titulo) >= 0.9) return null;
  const partes = titulo.split(SEPARADOR_TITULO);
  if (partes.length > 1 && similaridadeTitulos(partes[0], assunto) >= 0.5) return partes.slice(1).join(" - ");
  return titulo;
}

/** Regra genérica para um tema isolado: "Assunto - Subassunto" ou só "Assunto". */
export function sugerirAssunto(disciplina: string | null, tema: string): SugestaoAssunto | null {
  const limpo = limparTitulo(tema);
  if (!chaveNome(limpo)) return null;
  const curado = assuntoCurado(disciplina, limpo);
  if (curado) return { assunto: curado, subassunto: subassuntoDe(curado, limpo), confianca: 0.9 };
  const partes = limpo.split(SEPARADOR_TITULO).filter(Boolean);
  if (partes.length >= 2) {
    return { assunto: partes[0], subassunto: partes.slice(1).join(" - "), confianca: 0.6 };
  }
  return { assunto: limpo, subassunto: null, confianca: 0.55 };
}

export interface SecaoParaAtribuir {
  tipo: string;
  tema: string;
}

const LIMIAR_CORRESPONDENCIA = 0.3;
const ehQuestoes = (tipo: string) => tipo === "questoes_comentadas" || tipo === "lista_questoes";

/**
 * Atribui assuntos às seções de um material.
 *
 * 1. Se a disciplina tem taxonomia curada, ela classifica as seções que reconhecer.
 * 2. Para as demais, os temas das seções de questões representam os assuntos do
 *    curso (ex.: "Remédios Constitucionais"). Cada seção de teoria vira subassunto
 *    do tema mais parecido; sem tema parecido, fica com o tema corrente, já que o
 *    índice segue a ordem dos assuntos. Temas sem nenhuma teoria correspondente
 *    recebem o trecho de teoria não reconhecida que os antecede.
 * 3. Sem seções de questões, aplica a regra genérica por seção.
 */
export function atribuirAssuntos(secoes: SecaoParaAtribuir[], disciplina: string | null): (SugestaoAssunto | null)[] {
  // undefined = ainda não classificada
  const resultado: (SugestaoAssunto | null | undefined)[] = secoes.map((s) => {
    if (s.tipo === "apresentacao") return null;
    const titulo = limparTitulo(s.tema);
    const curado = assuntoCurado(disciplina, titulo);
    return curado ? { assunto: curado, subassunto: subassuntoDe(curado, titulo), confianca: 0.9 } : undefined;
  });
  const pendentes = secoes.map((_, i) => i).filter((i) => resultado[i] === undefined);
  const concluido = () => resultado.map((r) => r ?? null);
  if (pendentes.length === 0) return concluido();

  const temas: string[][] = [];
  for (const i of pendentes) {
    if (!ehQuestoes(secoes[i].tipo)) continue;
    const tema = limparTitulo(secoes[i].tema);
    if (!chaveNome(tema)) continue;
    const grupo = temas.find((g) => similaridadeTitulos(g[0], tema) >= 0.75);
    if (grupo) grupo.push(tema);
    else temas.push([tema]);
  }

  if (temas.length === 0) {
    for (const i of pendentes) {
      // Numa aula já classificada pela taxonomia curada, a seção solta herda o assunto vizinho.
      const vizinho = resultado.slice(0, i).reverse().find((r) => r) ?? resultado.slice(i + 1).find((r) => r);
      const titulo = limparTitulo(secoes[i].tema);
      resultado[i] = vizinho
        ? { assunto: vizinho.assunto, subassunto: subassuntoDe(vizinho.assunto, titulo), confianca: 0.6 }
        : sugerirAssunto(null, secoes[i].tema);
    }
    return concluido();
  }

  const nomes = temas.map(melhorVariante);
  const melhorTema = (titulo: string) => {
    const notas = nomes.map((n) => similaridadeTitulos(n, titulo));
    const melhor = notas.reduce((mi, n, i) => (n > notas[mi] ? i : mi), 0);
    return { indice: melhor, nota: notas[melhor] };
  };

  // Teoria: primeiro as correspondências diretas.
  const teoria = pendentes.filter((i) => !ehQuestoes(secoes[i].tipo));
  const correspondencia = new Map<number, number>();
  for (const i of teoria) {
    const { indice, nota } = melhorTema(limparTitulo(secoes[i].tema));
    if (nota >= LIMIAR_CORRESPONDENCIA) correspondencia.set(i, indice);
  }

  // Trechos sem correspondência: herdam o tema anterior, ou ocupam um tema
  // ainda não usado que fique entre o anterior e o próximo.
  const usados = new Set(correspondencia.values());
  let temaAnterior = -1;
  for (let k = 0; k < teoria.length; k++) {
    const i = teoria[k];
    if (correspondencia.has(i)) {
      temaAnterior = correspondencia.get(i)!;
      continue;
    }
    const proximo = teoria.slice(k + 1).find((j) => correspondencia.has(j));
    const limite = proximo !== undefined ? correspondencia.get(proximo)! : nomes.length;
    const livre = nomes.findIndex((_, t) => t > temaAnterior && t < limite && !usados.has(t));
    if (livre >= 0 && temaAnterior >= 0) {
      // Só ocupa tema livre depois de já ter havido teoria do tema anterior.
      usados.add(livre);
      temaAnterior = livre;
    }
    correspondencia.set(i, temaAnterior >= 0 ? temaAnterior : Math.max(0, livre));
    if (temaAnterior < 0) temaAnterior = correspondencia.get(i)!;
  }

  for (const i of pendentes) {
    const titulo = limparTitulo(secoes[i].tema);
    if (ehQuestoes(secoes[i].tipo)) {
      resultado[i] = { assunto: nomes[melhorTema(titulo).indice], subassunto: null, confianca: 0.9 };
    } else {
      const indice = correspondencia.get(i)!;
      const direta = melhorTema(titulo).nota >= LIMIAR_CORRESPONDENCIA;
      resultado[i] = { assunto: nomes[indice], subassunto: subassuntoDe(nomes[indice], titulo), confianca: direta ? 0.85 : 0.65 };
    }
  }
  return concluido();
}
