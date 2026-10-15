import type { PaginaBruta, ResultadoAnalise, SecaoDetectada } from "./tipos";
import { reconstruirLinhas } from "./linhas";
import { juntarLinhas, limparPaginas } from "./limpeza";
import { extrairMetadados } from "./capa";
import { extrairIndice } from "./indice";
import { montarSecoes, classificarTipoSecao } from "./secoes";
import { sugerirAssunto } from "./taxonomia";

/** Abaixo disso, a página é tratada como sem texto extraível (provável imagem). */
const MIN_CARACTERES_PAGINA = 40;

/**
 * Pipeline completo de um PDF já convertido em itens posicionados:
 * linhas → limpeza de cabeçalho/rodapé/marca d'água → metadados da capa →
 * índice → seções classificadas.
 */
export function analisarPaginas(paginasBrutas: PaginaBruta[], caminhoOriginal: string): ResultadoAnalise {
  const avisos: string[] = [];
  const paginasLinhas = paginasBrutas.map(reconstruirLinhas);
  const totalPaginas = paginasBrutas.length;

  const metadados = extrairMetadados(paginasLinhas, caminhoOriginal);
  const limpeza = limparPaginas(paginasLinhas);

  const paginas = limpeza.paginas.map((p) => {
    const texto = juntarLinhas(p.linhas);
    return { numero: p.numero, texto, caracteres: texto.length };
  });

  // A primeira página (capa) quase sempre tem pouco texto; não conta para OCR.
  const paginasSemTexto = paginas.filter((p) => p.numero > 1 && p.caracteres < MIN_CARACTERES_PAGINA).map((p) => p.numero);
  const requerOcr = totalPaginas > 1 && paginasSemTexto.length / Math.max(1, totalPaginas - 1) > 0.5;
  if (requerOcr) avisos.push("A maior parte das páginas não tem texto extraível; o PDF parece digitalizado e precisa de OCR.");
  else if (paginasSemTexto.length > 0) avisos.push(`${paginasSemTexto.length} página(s) sem texto extraível.`);

  const entradas = extrairIndice(paginasLinhas, totalPaginas);
  let secoes: SecaoDetectada[];
  if (entradas.length > 0) {
    secoes = montarSecoes(entradas, totalPaginas, metadados.disciplina);
  } else {
    avisos.push("Índice não encontrado; o documento foi registrado como uma única seção.");
    const titulo = metadados.aulaRotulo ?? caminhoOriginal.split(/[\\/]/).pop() ?? "Documento";
    const sugestao = sugerirAssunto(metadados.disciplina, titulo);
    secoes = [
      {
        ordem: 1,
        titulo,
        paginaInicio: 1,
        paginaFim: totalPaginas,
        tipo: classificarTipoSecao(titulo),
        assunto: sugestao?.assunto ?? null,
        subassunto: sugestao?.subassunto ?? null,
        banca: null,
        origem: "documento_inteiro",
        confianca: Math.min(sugestao?.confianca ?? 0.3, 0.4),
      },
    ];
  }

  if (!metadados.disciplina) avisos.push("Disciplina não identificada; classifique manualmente.");

  return {
    metadados,
    secoes,
    paginas,
    totalPaginas,
    linhasRemovidas: limpeza.linhasRemovidas,
    paginasSemTexto,
    requerOcr,
    avisos,
  };
}
