import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { estadoIA } from "@/lib/ia";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina } from "@/components/ui/layout";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";
import { FormGeracao } from "./form-geracao";

export const metadata: Metadata = { title: "Gerar questões com IA" };

export default async function PaginaGerar({ searchParams }: PageProps<"/questoes/gerar">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const [opcoes, ia] = await Promise.all([carregarOpcoesFiltro(supabase, usuario.id), estadoIA(usuario.id)]);
  const materialInicial = typeof sp.material === "string" ? sp.material : "";
  const material = opcoes.materiais.find((m) => m.id === materialInicial);

  return (
    <>
      <CabecalhoPagina
        titulo="Gerar questões com IA"
        descricao="Questões inéditas elaboradas a partir dos seus materiais, com referência à página e revisão automática antes de ficarem disponíveis."
        acoes={<Button variant="outline" asChild><Link href="/questoes"><ArrowLeft /> Banco de questões</Link></Button>}
      />
      <FormGeracao
        opcoes={opcoes}
        ia={ia}
        inicial={{ materialId: materialInicial, disciplinaId: material?.disciplina_id ?? (typeof sp.disciplina === "string" ? sp.disciplina : ""), assuntoId: typeof sp.assunto === "string" ? sp.assunto : "" }}
      />
    </>
  );
}
