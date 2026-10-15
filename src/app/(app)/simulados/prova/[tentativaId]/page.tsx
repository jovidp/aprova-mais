import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { ProvaSimulado, type DadosProva } from "./prova";

export const metadata: Metadata = { title: "Prova" };

export default async function PaginaProva({ params }: PageProps<"/simulados/prova/[tentativaId]">) {
  const { tentativaId } = await params;
  await exigirUsuario();
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("obter_prova", { p_tentativa_id: tentativaId });
  if (error || !data) notFound();
  const prova = data as DadosProva;
  if (prova.tentativa.status === "concluida" || prova.tentativa.status === "interrompida") redirect(`/simulados/resultado/${tentativaId}`);
  return <ProvaSimulado inicial={prova} />;
}
