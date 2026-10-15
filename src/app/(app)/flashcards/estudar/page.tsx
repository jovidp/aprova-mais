import type { Metadata } from "next";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CabecalhoPagina } from "@/components/ui/layout";
import { dataLocal } from "@/lib/estudo/tempo";
import { fusoDoUsuario } from "@/lib/servidor/painel";
import { Estudo } from "./estudo";

export const metadata: Metadata = { title: "Estudar flashcards" };

export default async function PaginaEstudar({ searchParams }: PageProps<"/flashcards/estudar">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const hoje = dataLocal(new Date(), await fusoDoUsuario(supabase, usuario.id));
  let consulta = supabase.from("flashcards").select("id, frente, verso, pagina, material_id, assuntos(nome)")
    .eq("user_id", usuario.id).eq("suspenso", false).lte("proxima_em", hoje).order("proxima_em").limit(100);
  if (typeof sp.disciplina === "string" && sp.disciplina) consulta = consulta.eq("disciplina_id", sp.disciplina);
  if (typeof sp.assunto === "string" && sp.assunto) consulta = consulta.eq("assunto_id", sp.assunto);
  const { data } = await consulta;
  const cartoes = ((data ?? []) as unknown as { id: string; frente: string; verso: string; pagina: number | null; material_id: string | null; assuntos: { nome: string } | null }[])
    .map((c) => ({ id: c.id, frente: c.frente, verso: c.verso, pagina: c.pagina, materialId: c.material_id, assunto: c.assuntos?.nome ?? null }));
  return (
    <>
      <CabecalhoPagina titulo="Estudar flashcards" descricao={`${cartoes.length} cartão(ões) para hoje`} />
      <Estudo cartoes={cartoes} />
    </>
  );
}
