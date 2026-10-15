import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Database, FileUp, PenLine, Plus, Sparkles, Star, XCircle } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { FiltrosQuestoes } from "@/components/questoes/filtros-questoes";
import { filtrosParaConsulta, lerValoresFiltro } from "@/lib/questoes/filtros";
import { rotuloOrigem } from "@/lib/questoes/exibicao";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";
import { ROTULO_DIFICULDADE, ROTULO_TIPO_QUESTAO, formatarNumero } from "@/lib/utils";

export const metadata: Metadata = { title: "Banco de Questões" };

const POR_PAGINA = 20;
const ABAS = [
  { valor: "aprovada", rotulo: "Disponíveis" },
  { valor: "pendente_revisao", rotulo: "Pendentes de revisão" },
  { valor: "rejeitada", rotulo: "Rejeitadas" },
  { valor: "arquivada", rotulo: "Arquivadas" },
];

interface Item {
  id: string; enunciado: string; tipo: string; dificuldade: string; origem: string; status: string; ano: number | null;
  disciplina: { nome: string }; assunto: { nome: string } | null; banca_estilo: string | null; banca_oficial: string | null;
  vezes_respondida: number; ultima_correta: boolean | null; favorita: boolean; marcada: boolean;
}

export default async function PaginaBancoQuestoes({ searchParams }: PageProps<"/questoes">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const valores = lerValoresFiltro(sp);
  const aba = typeof sp.status === "string" && ABAS.some((a) => a.valor === sp.status) ? sp.status : "aprovada";
  const pagina = Math.max(1, Number(typeof sp.pagina === "string" ? sp.pagina : 1) || 1);
  const supabase = await clienteServidor();

  const [opcoes, lista, { count: pendentes }] = await Promise.all([
    carregarOpcoesFiltro(supabase, usuario.id),
    supabase.rpc("listar_questoes", { p_filtros: { ...filtrosParaConsulta(valores), status: [aba] }, p_limite: POR_PAGINA, p_offset: (pagina - 1) * POR_PAGINA }),
    supabase.from("questoes").select("id", { count: "exact", head: true }).eq("owner_id", usuario.id).eq("status", "pendente_revisao"),
  ]);
  if (lista.error) throw lista.error;
  const { total, itens } = lista.data as { total: number; itens: Item[] };
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...valores, status: aba, ...extra } as Record<string, string>).toString();

  return (
    <>
      <CabecalhoPagina
        titulo="Banco de Questões"
        descricao="Questões autorais geradas a partir dos seus materiais, criadas por você ou importadas de bases licenciadas."
        acoes={
          <>
            <Button variant="outline" asChild><Link href="/questoes/importar"><FileUp /> Importar base</Link></Button>
            <Button variant="outline" asChild><Link href="/questoes/nova"><Plus /> Nova questão</Link></Button>
            <Button asChild><Link href="/questoes/gerar"><Sparkles /> Gerar com IA</Link></Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist">
        {ABAS.map((a) => (
          <Link key={a.valor} role="tab" aria-selected={aba === a.valor} href={`/questoes?${new URLSearchParams({ ...valores, status: a.valor } as Record<string, string>)}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${aba === a.valor ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {a.rotulo}{a.valor === "pendente_revisao" && (pendentes ?? 0) > 0 && <Badge variant="warning" className="ml-1.5">{pendentes}</Badge>}
          </Link>
        ))}
      </div>

      <FiltrosQuestoes opcoes={opcoes} valores={valores} extras={{ status: aba }} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{formatarNumero(total)} questão(ões)</span>
        {aba === "aprovada" && total > 0 && (
          <Button size="sm" asChild><Link href={`/resolver?${new URLSearchParams(valores as Record<string, string>)}`}><PenLine /> Resolver estas questões</Link></Button>
        )}
        {aba === "pendente_revisao" && total > 0 && (
          <Button size="sm" asChild><Link href="/questoes/revisao"><ClipboardCheck /> Revisar pendentes</Link></Button>
        )}
      </div>

      {itens.length === 0 ? (
        <EstadoVazio
          icone={<Database />}
          titulo={aba === "aprovada" ? "Nenhuma questão disponível com esses filtros" : "Nada por aqui"}
          descricao={aba === "aprovada" ? "Gere questões a partir dos seus materiais ou cadastre manualmente." : undefined}
          acao={aba === "aprovada" ? <Button asChild><Link href="/questoes/gerar"><Sparkles /> Gerar questões com IA</Link></Button> : undefined}
        />
      ) : (
        <ul className="grid gap-2">
          {itens.map((q) => (
            <li key={q.id}>
              <Link href={aba === "pendente_revisao" ? `/questoes/revisao?id=${q.id}` : `/questoes/${q.id}`} className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/50">
                <p className="line-clamp-2 text-sm">{q.enunciado}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="outline">{q.disciplina.nome}</Badge>
                  {q.assunto && <Badge variant="outline">{q.assunto.nome}</Badge>}
                  <Badge variant="secondary">{ROTULO_DIFICULDADE[q.dificuldade]}</Badge>
                  <Badge variant="secondary">{ROTULO_TIPO_QUESTAO[q.tipo]}</Badge>
                  <Badge variant="outline">{rotuloOrigem(q)}</Badge>
                  {q.favorita && <Star className="size-3.5 fill-warning text-warning" aria-label="Favorita" />}
                  {q.vezes_respondida > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
                      {q.ultima_correta ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-destructive" />}
                      respondida {q.vezes_respondida}×
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {paginas > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Paginação">
          <Button variant="outline" size="sm" asChild disabled={pagina <= 1}>
            <Link href={`/questoes?${qs({ pagina: String(Math.max(1, pagina - 1)) })}`} aria-disabled={pagina <= 1}>Anterior</Link>
          </Button>
          <span className="text-sm text-muted-foreground">Página {pagina} de {paginas}</span>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/questoes?${qs({ pagina: String(Math.min(paginas, pagina + 1)) })}`} aria-disabled={pagina >= paginas}>Próxima</Link>
          </Button>
        </nav>
      )}
    </>
  );
}
