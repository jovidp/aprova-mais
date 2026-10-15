/**
 * Documentos sem paginação (DOCX, TXT, Markdown): o texto é dividido em
 * "páginas" de tamanho estável (quebrando em parágrafos) e as seções vêm
 * dos títulos (Markdown "#", ou títulos do DOCX convertidos para "#").
 */
import type { ResultadoAnalise, SecaoDetectada } from "./tipos";
import { removerDadosPessoais } from "./limpeza";
import { extrairMetadados } from "./capa";
import { classificarTipoSecao, temaDaSecao } from "./secoes";
import { atribuirAssuntos } from "./taxonomia";

export const CARACTERES_POR_PAGINA = 3000;

export function paginarTexto(texto: string, alvo = CARACTERES_POR_PAGINA): string[] {
  const paragrafos = texto.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const paginas: string[] = [];
  let atual = "";
  for (const p of paragrafos) {
    const bloco = p.trim();
    if (!bloco) continue;
    if (atual && atual.length + bloco.length + 2 > alvo) {
      paginas.push(atual);
      atual = "";
    }
    if (bloco.length > alvo * 1.5) {
      // Parágrafo enorme: corta em frases.
      for (let i = 0; i < bloco.length; i += alvo) paginas.push(bloco.slice(i, i + alvo));
      continue;
    }
    atual = atual ? `${atual}\n\n${bloco}` : bloco;
  }
  if (atual) paginas.push(atual);
  return paginas.length ? paginas : [""];
}

export function analisarTextoSimples(textoBruto: string, caminhoOriginal: string): ResultadoAnalise {
  const texto = textoBruto
    .split("\n")
    .map((l) => removerDadosPessoais(l))
    .join("\n");
  const paginasTexto = paginarTexto(texto);
  const paginas = paginasTexto.map((t, i) => ({ numero: i + 1, texto: t.replace(/^#{1,6}\s+/gm, ""), caracteres: t.length }));

  // Títulos e a página onde aparecem.
  const titulos: { titulo: string; pagina: number }[] = [];
  paginasTexto.forEach((t, i) => {
    for (const m of t.matchAll(/^#{1,3}\s+(.+)$/gm)) titulos.push({ titulo: m[1].trim().slice(0, 200), pagina: i + 1 });
  });

  const linhasFalsas = [{ numero: 1, altura: 1, linhas: (paginasTexto[0] ?? "").split("\n").slice(0, 12).map((l, k) => ({ texto: l.replace(/^#+\s*/, ""), x: 0, y: 100 - k, altura: 10 })) }];
  const metadados = extrairMetadados(linhasFalsas, caminhoOriginal);

  let secoes: SecaoDetectada[];
  if (titulos.length > 0) {
    const base = titulos.map((t) => {
      const tipo = classificarTipoSecao(t.titulo);
      return { tipo, tema: temaDaSecao(t.titulo, tipo) };
    });
    const sugestoes = atribuirAssuntos(base, metadados.disciplina);
    secoes = titulos.map((t, i) => {
      const proxima = titulos[i + 1];
      return {
        ordem: i + 1, titulo: t.titulo, paginaInicio: t.pagina,
        paginaFim: proxima ? Math.max(t.pagina, proxima.pagina - (proxima.pagina > t.pagina ? 1 : 0)) : paginas.length,
        tipo: base[i].tipo, assunto: sugestoes[i]?.assunto ?? null, subassunto: sugestoes[i]?.subassunto ?? null,
        banca: null, origem: "titulos" as const, confianca: Math.min(0.75, sugestoes[i]?.confianca ?? 0.5),
      };
    });
  } else {
    const titulo = caminhoOriginal.split(/[\\/]/).pop()?.replace(/\.\w+$/, "") ?? "Documento";
    secoes = [{
      ordem: 1, titulo, paginaInicio: 1, paginaFim: paginas.length, tipo: "teoria", assunto: titulo, subassunto: null,
      banca: null, origem: "documento_inteiro", confianca: 0.3,
    }];
  }

  const avisos = ["Documento sem paginação original: as páginas foram geradas a cada ~3.000 caracteres."];
  if (!metadados.disciplina) avisos.push("Disciplina não identificada; classifique manualmente.");
  return {
    metadados, secoes, paginas, totalPaginas: paginas.length, linhasRemovidas: 0,
    paginasSemTexto: [], requerOcr: false, avisos,
  };
}
