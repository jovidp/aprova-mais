import type { Metadata } from "next";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CabecalhoPagina } from "@/components/ui/layout";
import { FormQuestao } from "@/components/questoes/form-questao";
import { QUESTAO_VAZIA } from "@/lib/questoes/formulario";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";

export const metadata: Metadata = { title: "Nova questão" };

export default async function PaginaNovaQuestao() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const opcoes = await carregarOpcoesFiltro(supabase, usuario.id);
  return (
    <>
      <CabecalhoPagina titulo="Nova questão" descricao="Cadastre uma questão autoral. Ela fica privada na sua conta." />
      <FormQuestao inicial={QUESTAO_VAZIA} opcoes={opcoes} />
    </>
  );
}
