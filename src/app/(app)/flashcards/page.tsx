import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Play } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina, EstadoVazio, Indicador } from "@/components/ui/layout";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";
import { estadoIA } from "@/lib/ia";
import { dataLocal } from "@/lib/estudo/tempo";
import { fusoDoUsuario } from "@/lib/servidor/painel";
import { GerenciarFlashcards, type CartaoLista } from "./gerenciar";

export const metadata: Metadata = { title: "Flashcards" };

export default async function PaginaFlashcards({ searchParams }: PageProps<"/flashcards">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const disciplina = typeof sp.disciplina === "string" ? sp.disciplina : "";
  const assunto = typeof sp.assunto === "string" ? sp.assunto : "";
  const supabase = await clienteServidor();
  const hoje = dataLocal(new Date(), await fusoDoUsuario(supabase, usuario.id));

  let consulta = supabase.from("flashcards").select("id, frente, verso, origem, proxima_em, repeticoes, lapsos, suspenso, pagina, material_id, disciplinas(nome), assuntos(nome)")
    .eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(500);
  if (disciplina) consulta = consulta.eq("disciplina_id", disciplina);
  if (assunto) consulta = consulta.eq("assunto_id", assunto);
  const [{ data }, opcoes, ia, { count: revisadosHoje }] = await Promise.all([
    consulta, carregarOpcoesFiltro(supabase, usuario.id), estadoIA(usuario.id),
    supabase.from("flashcard_revisoes").select("id", { count: "exact", head: true }).eq("user_id", usuario.id).gte("created_at", `${hoje}T00:00:00`),
  ]);
  const cartoes: CartaoLista[] = ((data ?? []) as unknown as (Omit<CartaoLista, "disciplina" | "assunto"> & { disciplinas: { nome: string } | null; assuntos: { nome: string } | null })[])
    .map((c) => ({ ...c, disciplina: c.disciplinas?.nome ?? null, assunto: c.assuntos?.nome ?? null }));
  const pendentes = cartoes.filter((c) => !c.suspenso && c.proxima_em <= hoje).length;
  const filtro = new URLSearchParams({ ...(disciplina ? { disciplina } : {}), ...(assunto ? { assunto } : {}) }).toString();

  return (
    <>
      <CabecalhoPagina titulo="Flashcards" descricao="Cartões de memorização com revisão espaçada."
        acoes={pendentes > 0 ? <Button asChild><Link href={`/flashcards/estudar${filtro ? `?${filtro}` : ""}`}><Play /> Estudar {pendentes} pendente(s)</Link></Button> : undefined} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Indicador rotulo="Para revisar hoje" valor={pendentes} />
        <Indicador rotulo="Revisados hoje" valor={revisadosHoje ?? 0} />
        <Indicador rotulo="Total" valor={cartoes.length} detalhe={`${cartoes.filter((c) => c.repeticoes >= 3).length} com 3+ revisões`} />
      </div>
      <GerenciarFlashcards cartoes={cartoes} opcoes={opcoes} iaDisponivel={ia.configurada && !ia.bloqueadaPorOrcamento} filtro={{ disciplina, assunto }} hoje={hoje} />
      {cartoes.length === 0 && (
        <EstadoVazio className="mt-6" icone={<Layers />} titulo="Nenhum flashcard" descricao="Crie cartões manualmente, a partir de trechos selecionados no leitor de PDF, das questões corrigidas ou gere com IA." />
      )}
    </>
  );
}
