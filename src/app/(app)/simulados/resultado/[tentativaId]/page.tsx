import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/basicos";
import { CabecalhoPagina } from "@/components/ui/layout";
import { analisarResultado, type ResultadoProva } from "@/lib/simulados/analise";
import { integrarResultado } from "@/lib/simulados/integracao";
import { formatarDataHora } from "@/lib/utils";
import { PainelResultado, type QuestaoCorrigida } from "./painel-resultado";

export const metadata: Metadata = { title: "Resultado do simulado" };

export default async function PaginaResultado({ params }: PageProps<"/simulados/resultado/[tentativaId]">) {
  const { tentativaId } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("obter_correcao_simulado", { p_tentativa_id: tentativaId });
  if (error || !data) notFound();
  const correcao = data as { tentativa: { simulado_id: string; numero: number; finalizada_em: string; finalizacao: string; status: string }; resultado: ResultadoProva & { regra: Record<string, number | boolean> }; questoes: QuestaoCorrigida[] };

  const [{ data: simulado }, recomendacoes, { data: anteriores }, { data: caderno }] = await Promise.all([
    supabase.from("simulados").select("id, nome, tipo, observacoes_geracao").eq("id", correcao.tentativa.simulado_id).single(),
    integrarResultado(supabase, usuario.id, tentativaId),
    supabase.from("simulados_resultados").select("tentativa_id, created_at, percentual_acerto_total, nota, nota_maxima, simulados(nome)").eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("caderno_erros").select("questao_id").eq("user_id", usuario.id).in("questao_id", correcao.questoes.map((q) => q.questao_id)),
  ]);
  const analise = analisarResultado(correcao.resultado);

  return (
    <>
      <CabecalhoPagina
        titulo={simulado?.nome ?? "Resultado"}
        descricao={<>Tentativa {correcao.tentativa.numero} · entregue em {formatarDataHora(correcao.tentativa.finalizada_em)}
          {correcao.tentativa.finalizacao === "tempo_esgotado" && <Badge variant="warning" className="ml-2">entregue por tempo</Badge>}
          {correcao.tentativa.status === "interrompida" && <Badge variant="outline" className="ml-2">interrompida</Badge>}</>}
        acoes={
          <>
            <Button variant="outline" asChild><Link href="/simulados"><ArrowLeft /> Meus simulados</Link></Button>
            <Button variant="outline" asChild><Link href={`/simulados/${correcao.tentativa.simulado_id}`}><RotateCcw /> Refazer</Link></Button>
          </>
        }
      />
      <PainelResultado
        resultado={correcao.resultado}
        questoes={correcao.questoes}
        analise={analise}
        recomendacoes={recomendacoes}
        anteriores={[...(anteriores ?? [])].reverse().map((a) => ({
          id: a.tentativa_id, data: a.created_at, percentual: Number(a.percentual_acerto_total),
          nome: (a.simulados as unknown as { nome: string } | null)?.nome ?? "", atual: a.tentativa_id === tentativaId,
        }))}
        noCaderno={(caderno ?? []).map((c) => c.questao_id)}
        observacoes={(simulado?.observacoes_geracao as string[] | undefined) ?? []}
      />
    </>
  );
}
