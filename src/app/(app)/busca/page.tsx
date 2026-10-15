import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Search } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Busca" };

interface Resultado {
  materiais: { id: string; titulo: string; aula: number | null }[];
  paginas: { material_id: string; titulo: string; pagina: number; trecho: string }[];
  questoes: { id: string; enunciado: string; status: string }[];
  anotacoes: { id: string; material_id: string; pagina: number; texto: string }[];
  assuntos: { id: string; nome: string; disciplina: string }[];
}

/** Destaca os termos marcados pelo ts_headline (<<termo>>) sem usar HTML bruto. */
function Destaque({ texto }: { texto: string }) {
  return <>{texto.split(/(<<.*?>>)/g).map((p, i) => (p.startsWith("<<") ? <mark key={i} className="rounded bg-warning/30 px-0.5 text-foreground">{p.slice(2, -2)}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export default async function PaginaBusca({ searchParams }: PageProps<"/busca">) {
  await exigirUsuario();
  const { q } = await searchParams;
  const termo = (typeof q === "string" ? q : "").trim().slice(0, 200);
  const supabase = await clienteServidor();
  const { data } = termo.length >= 2 ? await supabase.rpc("buscar_global", { p_termo: termo, p_limite: 15 }) : { data: null };
  const r = data as Resultado | null;
  const total = r ? r.materiais.length + r.paginas.length + r.questoes.length + r.anotacoes.length + r.assuntos.length : 0;

  const Secao = ({ titulo, n, children }: { titulo: string; n: number; children: React.ReactNode }) =>
    n ? <Card><CardHeader><CardTitle>{titulo} ({n})</CardTitle></CardHeader><CardContent><ul className="grid gap-2 text-sm">{children}</ul></CardContent></Card> : null;

  return (
    <>
      <CabecalhoPagina titulo="Busca" descricao={termo ? `Resultados para "${termo}"` : "Use a barra de busca no topo (atalho: /)."} />
      <form className="mb-6 flex max-w-xl gap-2" action="/busca">
        <input name="q" defaultValue={termo} aria-label="Termo de busca" placeholder="Buscar…" className="h-9 flex-1 rounded-md border bg-card px-3 text-sm" />
        <button className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground" type="submit">Buscar</button>
      </form>
      {termo.length >= 2 && total === 0 && <EstadoVazio icone={<Search />} titulo="Nada encontrado" descricao="Tente outras palavras ou verifique a grafia." />}
      {r && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Secao titulo="Trechos dos materiais" n={r.paginas.length}>
            {r.paginas.map((p, i) => (
              <li key={i}><Link className="font-medium hover:underline" href={`/biblioteca/${p.material_id}/ler?pagina=${p.pagina}`}>{p.titulo}, p. {p.pagina}</Link>
                <p className="text-muted-foreground"><Destaque texto={p.trecho} /></p></li>
            ))}
          </Secao>
          <div className="grid content-start gap-4">
            <Secao titulo="Materiais" n={r.materiais.length}>
              {r.materiais.map((m) => <li key={m.id}><Link className="hover:underline" href={`/biblioteca/${m.id}`}>{m.titulo}</Link></li>)}
            </Secao>
            <Secao titulo="Assuntos" n={r.assuntos.length}>
              {r.assuntos.map((a) => <li key={a.id}><Link className="hover:underline" href={`/mapa?assunto=${a.id}#assunto-${a.id}`}>{a.nome}</Link> <span className="text-muted-foreground">· {a.disciplina}</span></li>)}
            </Secao>
            <Secao titulo="Questões" n={r.questoes.length}>
              {r.questoes.map((x) => <li key={x.id}><Link className="hover:underline" href={`/questoes/${x.id}`}>{x.enunciado}…</Link></li>)}
            </Secao>
            <Secao titulo="Anotações" n={r.anotacoes.length}>
              {r.anotacoes.map((a) => <li key={a.id}><Link className="hover:underline" href={`/biblioteca/${a.material_id}/ler?pagina=${a.pagina}`}>p. {a.pagina}: {a.texto}</Link></li>)}
            </Secao>
          </div>
        </div>
      )}
    </>
  );
}
