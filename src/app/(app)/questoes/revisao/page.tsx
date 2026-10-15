import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { carregarQuestoesExibicao } from "@/lib/servidor/questoes";
import type { CorrecaoExibicao } from "@/lib/questoes/exibicao";
import { ItemRevisao } from "./item-revisao";

export const metadata: Metadata = { title: "Revisão de questões" };

export default async function PaginaRevisao({ searchParams }: PageProps<"/questoes/revisao">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  let consulta = supabase.from("questoes").select("id").eq("status", "pendente_revisao").order("created_at").limit(15);
  consulta = usuario.papel === "admin" ? consulta : consulta.eq("owner_id", usuario.id);
  if (typeof sp.id === "string") consulta = consulta.eq("id", sp.id);
  const { data: ids } = await consulta;
  const lista = (ids ?? []).map((q) => q.id as string);
  const questoes = await carregarQuestoesExibicao(supabase, lista);

  const [validacoes, fontes, gabaritos] = await Promise.all([
    supabase.from("questao_validacoes").select("questao_id, verificador, resultado, problemas").in("questao_id", lista),
    supabase.from("questao_fontes").select("questao_id, material_id, pagina, trecho, descricao, tipo, materiais(titulo)").in("questao_id", lista),
    Promise.all(lista.map(async (id) => [id, (await supabase.rpc("obter_gabarito_revisao", { p_questao_id: id })).data] as const)),
  ]);
  const gabaritoPorId = new Map(gabaritos);

  return (
    <>
      <CabecalhoPagina
        titulo="Revisão de questões"
        descricao="Questões que não passaram em todas as verificações automáticas. Só ficam disponíveis para resolução depois de aprovadas."
        acoes={<Button variant="outline" asChild><Link href="/questoes?status=pendente_revisao"><ArrowLeft /> Banco</Link></Button>}
      />
      {questoes.length === 0 ? (
        <EstadoVazio icone={<ClipboardCheck />} titulo="Nenhuma questão aguardando revisão" descricao="Questões geradas que passarem em todas as verificações ficam disponíveis automaticamente." />
      ) : (
        <div className="grid gap-6">
          {questoes.map((q) => {
            const g = gabaritoPorId.get(q.id) as { alternativa_correta_id: string; explicacao: string; justificativas: Record<string, string> } | null | undefined;
            const correcao: CorrecaoExibicao | null = g ? {
              ...g,
              fontes: (fontes.data ?? []).filter((f) => f.questao_id === q.id).map((f) => ({
                material_id: f.material_id, pagina: f.pagina, trecho: f.trecho, descricao: f.descricao, tipo: f.tipo,
                material_titulo: (f.materiais as unknown as { titulo: string } | null)?.titulo ?? null,
              })),
            } : null;
            const problemas = (validacoes.data ?? []).filter((v) => v.questao_id === q.id && v.resultado !== "aprovada")
              .flatMap((v) => (v.problemas as string[]).map((p) => ({ verificador: v.verificador as string, mensagem: p })));
            return <ItemRevisao key={q.id} questao={q} correcao={correcao} problemas={problemas} />;
          })}
        </div>
      )}
    </>
  );
}
