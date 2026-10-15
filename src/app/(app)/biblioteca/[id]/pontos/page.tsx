import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { ListaPontos, type PontoExibicao } from "@/components/materiais/lista-pontos";
import { GeradorPontos } from "@/components/materiais/gerador-pontos";
import { BotaoImprimir } from "@/components/materiais/botao-imprimir";
import { FiltroImportancia } from "./filtro-importancia";

export const metadata: Metadata = { title: "Pontos importantes" };

export default async function PaginaPontos({ params, searchParams }: PageProps<"/biblioteca/[id]/pontos">) {
  const { id } = await params;
  const { minimo } = await searchParams;
  const min = Math.min(3, Math.max(1, Number(minimo) || 1));
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: material } = await supabase.from("materiais").select("id, titulo, disciplinas(nome)").eq("id", id).eq("user_id", usuario.id).maybeSingle();
  if (!material) notFound();
  const [{ data: pontos }, { data: secoes }] = await Promise.all([
    supabase.from("material_pontos_chave").select("id, secao_id, pagina, tipo, importancia, titulo, explicacao, trecho").eq("material_id", id).gte("importancia", min).order("pagina").order("ordem"),
    supabase.from("material_secoes").select("id, titulo, pagina_inicio").eq("material_id", id).order("ordem"),
  ]);
  const disciplina = (material.disciplinas as unknown as { nome: string } | null)?.nome;

  return (
    <article>
      <CabecalhoPagina
        titulo={`Pontos importantes · ${material.titulo}`}
        descricao={`${disciplina ? `${disciplina} · ` : ""}${pontos?.length ?? 0} ponto(s). Gerados por IA a partir do material; confira no texto original sempre que houver dúvida.`}
        acoes={
          <div className="nao-imprimir flex flex-wrap gap-2">
            <Button variant="outline" asChild><Link href={`/biblioteca/${id}`}><ArrowLeft /> Material</Link></Button>
            <Button variant="outline" asChild><Link href={`/biblioteca/${id}/ler?pontos=1`}><BookOpen /> Ver no PDF</Link></Button>
            <FiltroImportancia valor={String(min)} />
            <BotaoImprimir />
          </div>
        }
      />
      {!pontos?.length ? (
        <EstadoVazio titulo="Nenhum ponto gerado" descricao="Gere os pontos mais importantes deste material com a IA." acao={<GeradorPontos escopo={{ materialId: id }} />} />
      ) : (
        <ListaPontos materialId={id} pontos={pontos as PontoExibicao[]} secoes={secoes ?? []} />
      )}
    </article>
  );
}
