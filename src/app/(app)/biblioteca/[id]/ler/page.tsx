import type { Metadata } from "next";
import type { ComponentProps } from "react";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Aviso } from "@/components/ui/layout";
import { LeitorCarregavel } from "./leitor-carregavel";

export const metadata: Metadata = { title: "Leitor" };

export default async function PaginaLeitor({ params, searchParams }: PageProps<"/biblioteca/[id]/ler">) {
  const { id } = await params;
  const sp = await searchParams;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: material } = await supabase
    .from("materiais")
    .select("id, titulo, storage_path, total_paginas, disciplina_id, disciplinas(nome)")
    .eq("id", id).eq("user_id", usuario.id).maybeSingle();
  if (!material) notFound();

  const [{ data: assinada, error }, { data: secoes }, { data: anotacoes }, { data: progresso }, { data: pontos }] = await Promise.all([
    supabase.storage.from("materiais").createSignedUrl(material.storage_path, 60 * 60 * 3),
    supabase.from("material_secoes").select("id, titulo, pagina_inicio, pagina_fim, tipo, assunto_id").eq("material_id", id).order("ordem"),
    supabase.from("anotacoes").select("id, pagina, tipo, texto, trecho, cor, created_at").eq("material_id", id).order("pagina"),
    supabase.from("progresso_leitura").select("ultima_pagina, paginas_lidas").eq("material_id", id).maybeSingle(),
    supabase.from("material_pontos_chave").select("id, pagina, tipo, importancia, titulo, explicacao, trecho").eq("material_id", id).order("pagina").order("ordem"),
  ]);
  if (error || !assinada) return <Aviso tipo="erro">Não foi possível abrir o arquivo. Tente novamente em instantes.</Aviso>;

  const paginaPedida = Number(typeof sp.pagina === "string" ? sp.pagina : NaN);
  const paginaInicial = Number.isInteger(paginaPedida) && paginaPedida >= 1 ? Math.min(paginaPedida, material.total_paginas || paginaPedida) : progresso?.ultima_pagina ?? 1;

  return (
    <LeitorCarregavel
      material={{ id: material.id, titulo: material.titulo, totalPaginas: material.total_paginas, disciplinaId: material.disciplina_id,
        disciplina: (material.disciplinas as unknown as { nome: string } | null)?.nome ?? null }}
      url={assinada.signedUrl}
      paginaInicial={paginaInicial}
      destaque={typeof sp.destaque === "string" ? sp.destaque : undefined}
      secoes={secoes ?? []}
      anotacoesIniciais={anotacoes ?? []}
      paginasLidas={(progresso?.paginas_lidas as number[] | undefined) ?? []}
      pontos={(pontos ?? []) as ComponentProps<typeof LeitorCarregavel>["pontos"]}
      abrirPontos={sp.pontos === "1"}
    />
  );
}
