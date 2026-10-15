import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Assistente } from "./assistente";

export const metadata: Metadata = { title: "Configuração inicial" };

export default async function PaginaOnboarding({ searchParams }: PageProps<"/onboarding">) {
  const usuario = await exigirUsuario();
  const { refazer } = await searchParams;
  if (usuario.onboardingConcluido && refazer !== "1") redirect("/dashboard");
  const supabase = await clienteServidor();
  const [{ data: bancas }, { data: disciplinas }] = await Promise.all([
    supabase.from("bancas").select("id, sigla, nome").order("sigla"),
    supabase.from("disciplinas").select("nome").order("nome"),
  ]);
  return (
    <Assistente
      nome={usuario.nome}
      bancas={bancas ?? []}
      disciplinasExistentes={(disciplinas ?? []).map((d) => d.nome)}
    />
  );
}
