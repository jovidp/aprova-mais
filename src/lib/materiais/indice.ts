import type { EntradaIndice, PaginaLinhas } from "./tipos";

const TITULO_INDICE = /^(?:[ÍI]ndice|sum[aá]rio)$/i;
const INICIO_ENTRADA = /^(\d{1,3})\)\s*(.*)$/;
const FIM_COM_PAGINA = /^(.*?)\s+(\d{1,4})$/;

/**
 * Lê o índice do material ("1) Título ....... 3"). Títulos longos podem quebrar
 * em mais de uma linha; a entrada termina na linha que traz o número da página.
 * O índice pode ocupar mais de uma página, então a leitura continua enquanto
 * as páginas seguintes começarem com entradas.
 */
export function extrairIndice(paginas: PaginaLinhas[], totalPaginas: number): EntradaIndice[] {
  const limiteBusca = Math.min(paginas.length, 6);
  let inicio = -1;
  for (let i = 0; i < limiteBusca; i++) {
    if (paginas[i].linhas.some((l) => TITULO_INDICE.test(l.texto.trim()))) {
      inicio = i;
      break;
    }
  }
  if (inicio < 0) return [];

  const entradas: EntradaIndice[] = [];
  let pendente: { ordem: number; partes: string[] } | null = null;

  const fecharPendente = (texto: string) => {
    const m = FIM_COM_PAGINA.exec(texto);
    if (!pendente || !m) return false;
    pendente.partes.push(m[1]);
    entradas.push({
      ordem: pendente.ordem,
      titulo: pendente.partes.join(" ").replace(/\s+/g, " ").trim(),
      pagina: Number(m[2]),
    });
    pendente = null;
    return true;
  };

  for (let i = inicio; i < Math.min(paginas.length, inicio + 5); i++) {
    let entradasNestaPagina = 0;
    for (const linha of paginas[i].linhas) {
      const texto = linha.texto.replace(/^[.\s·…]+/, "").replace(/[.\s·…]+(\d{1,4})$/, " $1").trim();
      const inicioEntrada = INICIO_ENTRADA.exec(texto);
      if (inicioEntrada) {
        pendente = { ordem: Number(inicioEntrada[1]), partes: [] };
        if (fecharPendente(inicioEntrada[2])) entradasNestaPagina++;
        else pendente.partes.push(inicioEntrada[2]);
      } else if (pendente) {
        if (fecharPendente(texto)) entradasNestaPagina++;
        else if (texto.length < 200) pendente.partes.push(texto);
      }
    }
    if (i > inicio && entradasNestaPagina === 0) break;
  }

  return validarEntradas(entradas, totalPaginas);
}

/** Descarta entradas incoerentes: páginas fora do documento ou fora de ordem. */
function validarEntradas(entradas: EntradaIndice[], totalPaginas: number) {
  const validas: EntradaIndice[] = [];
  for (const entrada of entradas) {
    if (entrada.pagina < 1 || entrada.pagina > totalPaginas) continue;
    const anterior = validas[validas.length - 1];
    if (anterior && entrada.pagina < anterior.pagina) continue;
    if (!entrada.titulo) continue;
    validas.push(entrada);
  }
  return validas;
}
