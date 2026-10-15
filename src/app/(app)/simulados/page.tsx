import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Wand2 } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { statusDoSimulado } from "@/lib/simulados/status";
import { ListaSimulados, type LinhaSimulado } from "./lista-simulados";
import { Agendamentos } from "./agendamentos";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";

export const metadata: Metadata = { title: "Meus Simulados" };

export default async function PaginaSimulados() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const [{ data: simulados }, { data: agendamentos }, opcoes] = await Promise.all([
    supabase.from("simulados")
      .select("id, nome, tipo, total_questoes, tempo_limite_seg, status, created_at, concursos(nome), simulados_tentativas(id, numero, status, iniciada_em, finalizada_em), simulados_resultados(tentativa_id, nota, nota_maxima, percentual_acerto_total, tempo_total_seg, created_at)")
      .eq("user_id", usuario.id).neq("status", "arquivado").order("created_at", { ascending: false }).limit(200),
    supabase.from("simulados_agendamentos").select("*").eq("user_id", usuario.id).order("created_at"),
    carregarOpcoesFiltro(supabase, usuario.id),
  ]);

  const linhas: LinhaSimulado[] = (simulados ?? []).map((s) => {
    const tentativas = (s.simulados_tentativas ?? []) as { id: string; numero: number; status: string; iniciada_em: string; finalizada_em: string | null }[];
    const resultados = (s.simulados_resultados ?? []) as { tentativa_id: string; nota: number; nota_maxima: number; percentual_acerto_total: number; tempo_total_seg: number; created_at: string }[];
    const ultimoResultado = [...resultados].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    const ativa = tentativas.find((t) => t.status === "em_andamento" || t.status === "pausada") ?? null;
    return {
      id: s.id, nome: s.nome, tipo: s.tipo, totalQuestoes: s.total_questoes, tempoLimiteSeg: s.tempo_limite_seg, criadoEm: s.created_at,
      concurso: (s.concursos as unknown as { nome: string } | null)?.nome ?? null,
      status: statusDoSimulado(tentativas), tentativas: tentativas.length, tentativaAtivaId: ativa?.id ?? null,
      ultimo: ultimoResultado ? { tentativaId: ultimoResultado.tentativa_id, nota: Number(ultimoResultado.nota), notaMaxima: Number(ultimoResultado.nota_maxima), percentual: Number(ultimoResultado.percentual_acerto_total), tempoSeg: ultimoResultado.tempo_total_seg, data: ultimoResultado.created_at } : null,
    };
  });

  return (
    <>
      <CabecalhoPagina titulo="Meus Simulados" descricao="Histórico completo com as questões, respostas, gabaritos e regras de cada prova preservados."
        acoes={<Button asChild><Link href="/simulados/gerar"><Wand2 /> Gerar simulado</Link></Button>} />
      {linhas.length === 0 ? (
        <EstadoVazio icone={<ClipboardList />} titulo="Nenhum simulado ainda" descricao="Monte um simulado a partir do seu banco de questões ou deixe a IA completar com questões dos seus materiais."
          acao={<Button asChild><Link href="/simulados/gerar"><Wand2 /> Gerar simulado</Link></Button>} />
      ) : (
        <ListaSimulados linhas={linhas} />
      )}
      <Agendamentos agendamentos={agendamentos ?? []} disciplinas={opcoes.disciplinas} />
    </>
  );
}
