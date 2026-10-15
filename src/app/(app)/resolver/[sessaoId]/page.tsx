import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { Resolvedor } from "@/components/questoes/resolvedor";
import { carregarQuestoesExibicao } from "@/lib/servidor/questoes";

export const metadata: Metadata = { title: "Sessão de questões" };

export default async function PaginaSessao({ params }: PageProps<"/resolver/[sessaoId]">) {
  const { sessaoId } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: sessao } = await supabase.from("sessoes_questoes").select("*").eq("id", sessaoId).eq("user_id", usuario.id).maybeSingle();
  if (!sessao) notFound();
  const ids = sessao.questao_ids as string[];

  const [questoes, { data: favoritos }, { data: marcacoes }, { data: respostas }] = await Promise.all([
    carregarQuestoesExibicao(supabase, ids),
    supabase.from("favoritos").select("questao_id").eq("user_id", usuario.id).in("questao_id", ids),
    supabase.from("questao_marcacoes").select("questao_id, marcada_revisao, duvida").eq("user_id", usuario.id).in("questao_id", ids),
    supabase.from("respostas_usuario").select("questao_id, alternativa_id, correta, tempo_seg, tentativa_numero").eq("sessao_id", sessaoId).order("tentativa_numero"),
  ]);
  if (questoes.length === 0) {
    return <EstadoVazio titulo="As questões desta sessão não estão mais disponíveis" descricao="Elas podem ter sido arquivadas. Crie uma nova sessão." />;
  }
  const jaRespondidas = Object.fromEntries((respostas ?? []).map((r) => [r.questao_id, { alternativaId: r.alternativa_id, correta: r.correta, tempoSeg: r.tempo_seg }]));

  return (
    <>
      <CabecalhoPagina titulo={sessao.nome} descricao={`${questoes.length} questões${sessao.status === "concluida" ? " · sessão concluída" : ""}`} />
      <Resolvedor
        questoes={questoes}
        sessaoId={sessaoId}
        posicaoInicial={sessao.posicao}
        favoritas={(favoritos ?? []).map((f) => f.questao_id)}
        marcadas={(marcacoes ?? []).filter((m) => m.marcada_revisao).map((m) => m.questao_id)}
        duvidas={Object.fromEntries((marcacoes ?? []).filter((m) => m.duvida).map((m) => [m.questao_id, m.duvida as string]))}
        jaRespondidas={jaRespondidas}
        contexto={sessao.modo === "revisao_erros" ? "revisao" : sessao.modo === "diagnostico" ? "diagnostico" : "pratica"}
      />
    </>
  );
}
