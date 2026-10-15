import { Fragment, type ReactNode } from "react";

/**
 * Markdown mínimo e seguro (sem HTML bruto): parágrafos, títulos, listas,
 * **negrito**, *itálico*, `código` e citações [n] (renderizadas por `citacao`).
 */
export function TextoRico({ texto, citacao }: { texto: string; citacao?: (n: number) => ReactNode }) {
  const blocos: ReactNode[] = [];
  const linhas = texto.replace(/\r/g, "").split("\n");
  let lista: { ordenada: boolean; itens: string[] } | null = null;
  let paragrafo: string[] = [];

  const inline = (t: string, chave: string) => {
    const partes: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[\d{1,2}(?:\s*,\s*\d{1,2})*\])/g;
    let ultimo = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(t))) {
      if (m.index > ultimo) partes.push(t.slice(ultimo, m.index));
      const s = m[0];
      const k = `${chave}-${i++}`;
      if (s.startsWith("**")) partes.push(<strong key={k}>{s.slice(2, -2)}</strong>);
      else if (s.startsWith("`")) partes.push(<code key={k} className="rounded bg-muted px-1 font-mono text-[0.9em]">{s.slice(1, -1)}</code>);
      else if (s.startsWith("[")) {
        const nums = s.slice(1, -1).split(",").map((x) => Number(x.trim()));
        partes.push(<Fragment key={k}>{citacao ? nums.map((n, j) => <Fragment key={j}>{citacao(n)}</Fragment>) : s}</Fragment>);
      } else partes.push(<em key={k}>{s.slice(1, -1)}</em>);
      ultimo = m.index + s.length;
    }
    if (ultimo < t.length) partes.push(t.slice(ultimo));
    return partes;
  };

  const fecharParagrafo = () => {
    if (paragrafo.length) {
      const k = `p${blocos.length}`;
      blocos.push(<p key={k}>{paragrafo.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `${k}-${i}`)}</Fragment>)}</p>);
      paragrafo = [];
    }
  };
  const fecharLista = () => {
    if (lista) {
      const k = `l${blocos.length}`;
      const itens = lista.itens.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>);
      blocos.push(lista.ordenada ? <ol key={k} className="list-decimal pl-5">{itens}</ol> : <ul key={k} className="list-disc pl-5">{itens}</ul>);
      lista = null;
    }
  };

  for (const linha of linhas) {
    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    const item = /^\s*([-*•]|\d{1,2}[.)])\s+(.*)$/.exec(linha);
    if (!linha.trim()) { fecharParagrafo(); fecharLista(); continue; }
    if (titulo) {
      fecharParagrafo(); fecharLista();
      blocos.push(<p key={`h${blocos.length}`} className="font-semibold">{inline(titulo[2], `h${blocos.length}`)}</p>);
      continue;
    }
    if (item) {
      fecharParagrafo();
      const ordenada = /\d/.test(item[1]);
      if (lista && lista.ordenada !== ordenada) fecharLista();
      lista ??= { ordenada, itens: [] };
      lista.itens.push(item[2]);
      continue;
    }
    fecharLista();
    paragrafo.push(linha);
  }
  fecharParagrafo();
  fecharLista();
  return <div className="grid gap-2 leading-relaxed">{blocos}</div>;
}
