import type { ItemTexto, Linha, PaginaBruta, PaginaLinhas } from "./tipos";

const LIDER_PONTILHADO = /^[\s.·…_\-–]{4,}$/;

/** Itens que só desenham pontilhados de índice não carregam conteúdo. */
function itemRelevante(item: ItemTexto) {
  return item.str.trim().length > 0 && !LIDER_PONTILHADO.test(item.str);
}

/**
 * Reconstrói as linhas de uma página a partir dos itens posicionados do PDF.
 * Itens com coordenada vertical próxima formam a mesma linha; dentro dela,
 * a ordem é horizontal e um espaço é inserido apenas quando há distância real
 * entre os itens (preserva versaletes como "N" + "ACIONALIDADE").
 */
export function reconstruirLinhas(pagina: PaginaBruta): PaginaLinhas {
  const itens = pagina.itens.filter(itemRelevante).sort((a, b) => b.y - a.y || a.x - b.x);

  const grupos: ItemTexto[][] = [];
  for (const item of itens) {
    const atual = grupos[grupos.length - 1];
    if (atual) {
      const ref = atual[0];
      const tolerancia = Math.max(2, 0.5 * Math.max(item.altura, ref.altura));
      if (Math.abs(ref.y - item.y) <= tolerancia) {
        atual.push(item);
        continue;
      }
    }
    grupos.push([item]);
  }

  const linhas: Linha[] = grupos.map((grupo) => {
    grupo.sort((a, b) => a.x - b.x);
    let texto = "";
    let fimAnterior = -Infinity;
    for (const item of grupo) {
      const lacuna = item.x - fimAnterior;
      const precisaEspaco =
        texto.length > 0 && lacuna > Math.max(1, 0.15 * item.altura) && !/\s$/.test(texto) && !/^\s/.test(item.str);
      texto += (precisaEspaco ? " " : "") + item.str;
      fimAnterior = Math.max(fimAnterior, item.x + item.largura);
    }
    const alturaMax = Math.max(...grupo.map((i) => i.altura));
    return {
      texto: texto.replace(/\s+/g, " ").trim(),
      x: grupo[0].x,
      y: grupo[0].y,
      altura: alturaMax,
    };
  });

  return { numero: pagina.numero, altura: pagina.altura, linhas: linhas.filter((l) => l.texto.length > 0) };
}
