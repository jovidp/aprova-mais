import Link from "next/link";
import { Badge } from "@/components/ui/basicos";
import { ROTULO_IMPORTANCIA, ROTULO_TIPO_PONTO, type TipoPonto } from "@/lib/materiais/pontos-chave";
import { cn } from "@/lib/utils";

export interface PontoExibicao {
  id: string;
  secao_id: string | null;
  pagina: number;
  tipo: TipoPonto;
  importancia: number;
  titulo: string;
  explicacao: string;
  trecho: string | null;
}

const ESTRELAS: Record<number, string> = { 3: "★★★", 2: "★★", 1: "★" };

/** Pontos-chave agrupados pela seção do material, na ordem das páginas. */
export function ListaPontos({ materialId, pontos, secoes, mostrarTrecho = true, impressao = false }: {
  materialId: string;
  pontos: PontoExibicao[];
  secoes: { id: string; titulo: string; pagina_inicio: number }[];
  mostrarTrecho?: boolean;
  impressao?: boolean;
}) {
  const grupos = secoes
    .map((s) => ({ ...s, itens: pontos.filter((p) => p.secao_id === s.id).sort((a, b) => a.pagina - b.pagina) }))
    .filter((g) => g.itens.length > 0);
  return (
    <div className="grid gap-6">
      {grupos.map((g) => (
        <section key={g.id} className="break-inside-avoid-page">
          <h3 className="mb-2 font-semibold">{g.titulo}</h3>
          <ol className="grid gap-3">
            {g.itens.map((p) => (
              <li key={p.id} className={cn("rounded-lg border p-3 break-inside-avoid", p.importancia === 3 && "border-l-4 border-l-primary")}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.titulo}</span>
                  <span className="text-warning" title={ROTULO_IMPORTANCIA[p.importancia]} aria-label={ROTULO_IMPORTANCIA[p.importancia]}>{ESTRELAS[p.importancia]}</span>
                  <Badge variant="outline" className="text-[11px]">{ROTULO_TIPO_PONTO[p.tipo]}</Badge>
                  {impressao
                    ? <span className="ml-auto text-xs text-muted-foreground">p. {p.pagina}</span>
                    : <Link className="ml-auto text-xs text-primary hover:underline" href={`/biblioteca/${materialId}/ler?pagina=${p.pagina}&pontos=1`}>p. {p.pagina}</Link>}
                </div>
                <p className="text-sm">{p.explicacao}</p>
                {mostrarTrecho && p.trecho && <blockquote className="mt-2 border-l-2 border-success pl-2 text-xs text-muted-foreground">“{p.trecho}”</blockquote>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
