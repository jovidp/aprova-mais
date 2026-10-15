import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina, EstadoVazio, Tabela } from "@/components/ui/layout";
import { formatarDataHora, formatarDuracao, formatarPercentual } from "@/lib/utils";

export const metadata: Metadata = { title: "Comparar simulados" };

interface Agg { id: string | null; nome: string; total: number; acertos: number }

export default async function PaginaComparar({ searchParams }: PageProps<"/simulados/comparar">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const ids = (typeof sp.t === "string" ? sp.t.split(",") : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 6);
  const supabase = await clienteServidor();
  const { data } = ids.length
    ? await supabase.from("simulados_resultados").select("*, simulados(nome)").eq("user_id", usuario.id).in("tentativa_id", ids).order("created_at")
    : { data: [] };
  const lista = data ?? [];
  if (lista.length < 2) {
    return <EstadoVazio titulo="Selecione ao menos dois simulados concluídos" acao={<Button asChild><Link href="/simulados">Meus simulados</Link></Button>} />;
  }
  const disciplinas = [...new Set(lista.flatMap((r) => (r.por_disciplina as Agg[]).map((d) => d.nome)))].sort();
  const pct = (a?: Agg) => (a && a.total ? formatarPercentual((100 * a.acertos) / a.total) : "—");

  return (
    <>
      <CabecalhoPagina titulo="Comparar simulados" acoes={<Button variant="outline" asChild><Link href="/simulados"><ArrowLeft /> Meus simulados</Link></Button>} />
      <Tabela>
        <thead>
          <tr><th>Indicador</th>{lista.map((r) => <th key={r.tentativa_id} className="text-right">{(r.simulados as unknown as { nome: string }).nome}<div className="text-xs font-normal">{formatarDataHora(r.created_at)}</div></th>)}</tr>
        </thead>
        <tbody>
          <tr><td>Questões</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{r.total}</td>)}</tr>
          <tr><td>Nota</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{Number(r.nota)} / {Number(r.nota_maxima)}</td>)}</tr>
          <tr><td>Acerto (sobre o total)</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{formatarPercentual(Number(r.percentual_acerto_total))}</td>)}</tr>
          <tr><td>Acerto (sobre respondidas)</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{formatarPercentual(r.percentual_acerto === null ? null : Number(r.percentual_acerto))}</td>)}</tr>
          <tr><td>Acertos · erros · brancos</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{r.acertos} · {r.erros} · {r.brancos}</td>)}</tr>
          <tr><td>Tempo total</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{formatarDuracao(r.tempo_total_seg)}</td>)}</tr>
          <tr><td>Tempo médio por questão</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{formatarDuracao(Number(r.tempo_medio_seg))}</td>)}</tr>
          {disciplinas.map((d) => (
            <tr key={d}><td className="text-muted-foreground">{d}</td>{lista.map((r) => <td key={r.tentativa_id} className="text-right tabular-nums">{pct((r.por_disciplina as Agg[]).find((x) => x.nome === d))}</td>)}</tr>
          ))}
        </tbody>
      </Tabela>
    </>
  );
}
