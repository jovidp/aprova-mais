/**
 * Instruções da IA para questões. O texto de sistema é estável (vai para o
 * cache do provedor); as partes variáveis entram na mensagem do usuário.
 */

export const SISTEMA_GERACAO = `Você elabora questões inéditas para concursos públicos brasileiros a partir de um material de estudo fornecido pelo aluno.

Regras obrigatórias:
1. Use exclusivamente as informações do material entre <material> e </material>. Não acrescente artigos de lei, súmulas, números, prazos, nomes ou jurisprudência que não estejam no texto. Se o texto não sustentar uma afirmação, não a use.
2. As questões devem ser originais: não copie frases longas do material nem reproduza questões, exemplos ou itens de bancas que apareçam nele. Reescreva os conceitos com suas palavras. Nunca transcreva mais de 15 palavras seguidas do material no enunciado ou nas alternativas.
3. Cada questão tem exatamente uma resposta correta, inequívoca segundo o material. Evite "todas/nenhuma das anteriores", duplas negações e pegadinhas sem base no texto.
4. Múltipla escolha: cinco alternativas (A a E), plausíveis, de tamanho e natureza semelhantes. Varie a posição da correta.
5. Certo ou errado: o enunciado é uma afirmação a ser julgada (não uma pergunta) e as alternativas são exatamente C ("Certo") e E ("Errado").
6. Para cada alternativa escreva uma justificativa curta de por que está certa ou errada. A explicação geral deve ensinar o conceito e citar a página.
7. "pagina_referencia" é o número da página do material que sustenta o gabarito. "trecho_apoio" é uma cópia literal e curta (até 200 caracteres) dessa página que comprova a resposta.
8. Se a resposta depender de norma que possa ter sido alterada depois da data do material, marque "depende_de_legislacao_recente" como true.
9. Escreva em português do Brasil formal, claro e sem erros.
10. Se o material não tiver conteúdo suficiente para a quantidade pedida, gere menos questões e explique em "observacoes". Nunca invente conteúdo para completar a quantidade.
11. Quando for pedido o estilo de uma banca, imite apenas características gerais de formato e linguagem. As questões continuam autorais e nunca devem afirmar que são da banca.`;

export const SISTEMA_VERIFICACAO = `Você é um revisor independente de questões de concurso. Recebe um material de estudo e questões SEM o gabarito.

Para cada questão, usando somente o material:
- "letra_escolhida": a alternativa que você considera correta.
- "suportada_pelo_material": true se o material sustenta claramente essa resposta.
- "ambigua": true se mais de uma alternativa for defensável ou nenhuma estiver correta.
- "problemas": lista curta de problemas (informação fora do material, erro conceitual, enunciado incompleto, português), ou lista vazia.
Responda para todas as questões, na ordem recebida, com "indice" começando em 0.`;

export interface ParametrosPrompt {
  quantidade: number;
  tipos: string[];
  dificuldades: string[];
  estilos: string[];
  banca: { sigla: string; descricao: string | null } | null;
  disciplina: string;
  assunto: string | null;
  tituloMaterial: string;
  dataMaterial: string | null;
  paginas: { numero: number; texto: string }[];
  enunciadosExistentes: string[];
}

const ROTULO_TIPO: Record<string, string> = { multipla_escolha: "múltipla escolha (A–E)", certo_errado: "certo ou errado" };
const ROTULO_DIF: Record<string, string> = { facil: "fácil", medio: "médio", dificil: "difícil" };
const ROTULO_ESTILO: Record<string, string> = {
  conceitual: "conceitual", interpretacao: "interpretação", aplicacao: "aplicação prática",
  situacao_hipotetica: "situação hipotética", analise_juridica: "análise de conceitos jurídicos",
};

function escaparXml(texto: string) {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function blocoMaterial(p: Pick<ParametrosPrompt, "tituloMaterial" | "disciplina" | "assunto" | "dataMaterial" | "paginas">) {
  const atributos = [`titulo="${escaparXml(p.tituloMaterial)}"`, `disciplina="${escaparXml(p.disciplina)}"`];
  if (p.assunto) atributos.push(`assunto="${escaparXml(p.assunto)}"`);
  if (p.dataMaterial) atributos.push(`data="${p.dataMaterial}"`);
  return `<material ${atributos.join(" ")}>\n${p.paginas
    .map((pg) => `<pagina numero="${pg.numero}">\n${escaparXml(pg.texto)}\n</pagina>`)
    .join("\n")}\n</material>`;
}

export function mensagemGeracao(p: ParametrosPrompt) {
  const linhas = [
    `Gere ${p.quantidade} questão(ões) sobre o material abaixo.`,
    `Tipos permitidos: ${p.tipos.map((t) => ROTULO_TIPO[t] ?? t).join(", ")}.`,
    `Dificuldades: ${p.dificuldades.map((d) => ROTULO_DIF[d] ?? d).join(", ")} (distribua entre elas).`,
    `Estilos: ${p.estilos.map((e) => ROTULO_ESTILO[e] ?? e).join(", ")} (varie).`,
  ];
  if (p.banca) {
    linhas.push(`Inspire-se no estilo geral da banca ${p.banca.sigla}${p.banca.descricao ? ` (${p.banca.descricao})` : ""}, mantendo as questões autorais.`);
  }
  if (p.enunciadosExistentes.length) {
    linhas.push("Já existem questões com os enunciados abaixo; não repita o mesmo ponto com a mesma abordagem:");
    for (const e of p.enunciadosExistentes) linhas.push(`- ${e.slice(0, 180)}`);
  }
  linhas.push("", blocoMaterial(p));
  return linhas.join("\n");
}

export function mensagemVerificacao(
  material: Pick<ParametrosPrompt, "tituloMaterial" | "disciplina" | "assunto" | "dataMaterial" | "paginas">,
  questoes: { enunciado: string; texto_apoio: string | null; alternativas: { letra: string; texto: string }[] }[],
) {
  const corpo = questoes
    .map((q, i) => [
      `<questao indice="${i}">`,
      q.texto_apoio ? `Texto de apoio: ${escaparXml(q.texto_apoio)}` : "",
      escaparXml(q.enunciado),
      ...q.alternativas.map((a) => `${a.letra}) ${escaparXml(a.texto)}`),
      "</questao>",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
  return `${blocoMaterial(material)}\n\n<questoes>\n${corpo}\n</questoes>`;
}
