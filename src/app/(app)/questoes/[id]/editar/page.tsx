import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CabecalhoPagina } from "@/components/ui/layout";
import { FormQuestao } from "@/components/questoes/form-questao";
import type { DadosFormQuestao } from "@/lib/questoes/formulario";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";

export const metadata: Metadata = { title: "Editar questão" };

export default async function PaginaEditarQuestao({ params }: PageProps<"/questoes/[id]/editar">) {
  const { id } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: q } = await supabase
    .from("questoes")
    .select("id, owner_id, tipo, estilo, enunciado, texto_apoio, dificuldade, disciplina_id, banca_estilo_id, assuntos(nome), subassuntos(nome), alternativas(id, letra, texto, ordem), questao_fontes(material_id, pagina)")
    .eq("id", id).maybeSingle();
  if (!q) notFound();
  if (q.owner_id !== usuario.id && usuario.papel !== "admin") redirect(`/questoes/${id}`);
  const { count } = await supabase.from("respostas_usuario").select("id", { count: "exact", head: true }).eq("questao_id", id);
  if ((count ?? 0) > 0) redirect(`/questoes/${id}`);

  const [{ data: gabarito }, opcoes] = await Promise.all([
    supabase.rpc("obter_gabarito_revisao", { p_questao_id: id }),
    carregarOpcoesFiltro(supabase, usuario.id),
  ]);
  const g = gabarito as { alternativa_correta_id: string; explicacao: string; justificativas: Record<string, string> } | null;
  const alternativas = [...(q.alternativas as { id: string; letra: string; texto: string; ordem: number }[])].sort((a, b) => a.ordem - b.ordem);
  const fonte = (q.questao_fontes as { material_id: string | null; pagina: number | null }[])[0];

  const inicial: DadosFormQuestao = {
    id: q.id, tipo: q.tipo, estilo: q.estilo, enunciado: q.enunciado, textoApoio: q.texto_apoio ?? "", dificuldade: q.dificuldade,
    disciplinaId: q.disciplina_id, assunto: (q.assuntos as unknown as { nome: string } | null)?.nome ?? "",
    subassunto: (q.subassuntos as unknown as { nome: string } | null)?.nome ?? "", bancaEstiloId: q.banca_estilo_id ?? "",
    explicacao: g?.explicacao ?? "", materialId: fonte?.material_id ?? "", pagina: fonte?.pagina ? String(fonte.pagina) : "",
    alternativas: alternativas.map((a) => ({ letra: a.letra, texto: a.texto, correta: a.id === g?.alternativa_correta_id, justificativa: g?.justificativas?.[a.id] ?? "" })),
  };
  return (
    <>
      <CabecalhoPagina titulo="Editar questão" descricao="Questões já respondidas não podem ser editadas; arquive e crie uma nova versão." />
      <FormQuestao inicial={inicial} opcoes={opcoes} />
    </>
  );
}
