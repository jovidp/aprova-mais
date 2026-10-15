import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Aviso, CabecalhoPagina, Tabela } from "@/components/ui/layout";
import { Resolvedor } from "@/components/questoes/resolvedor";
import { CartaoQuestao } from "@/components/questoes/cartao-questao";
import { carregarQuestoesExibicao } from "@/lib/servidor/questoes";
import { formatarDataHora, formatarDuracao } from "@/lib/utils";
import { AcoesDono } from "./acoes-dono";

export const metadata: Metadata = { title: "Questão" };

const ROTULO_STATUS: Record<string, string> = { rascunho: "Rascunho", pendente_revisao: "Pendente de revisão", aprovada: "Disponível", rejeitada: "Rejeitada", arquivada: "Arquivada" };

export default async function PaginaQuestao({ params }: PageProps<"/questoes/[id]">) {
  const { id } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const [{ data: meta }, [questao]] = await Promise.all([
    supabase.from("questoes").select("owner_id, status, origem, created_at, licenca").eq("id", id).maybeSingle(),
    carregarQuestoesExibicao(supabase, [id]),
  ]);
  if (!meta || !questao) notFound();

  const [{ data: tentativas }, { data: favorito }, { data: marcacao }] = await Promise.all([
    supabase.from("respostas_usuario").select("tentativa_numero, correta, tempo_seg, contexto, created_at, alternativa_id").eq("questao_id", id).eq("user_id", usuario.id).order("tentativa_numero", { ascending: false }),
    supabase.from("favoritos").select("questao_id").eq("questao_id", id).eq("user_id", usuario.id).maybeSingle(),
    supabase.from("questao_marcacoes").select("marcada_revisao, duvida").eq("questao_id", id).eq("user_id", usuario.id).maybeSingle(),
  ]);
  const dono = meta.owner_id === usuario.id;
  const letra = (altId: string | null) => questao.alternativas.find((a) => a.id === altId)?.letra ?? "—";

  return (
    <>
      <CabecalhoPagina
        titulo="Questão"
        descricao={<>Status: <Badge variant={meta.status === "aprovada" ? "success" : "outline"}>{ROTULO_STATUS[meta.status]}</Badge>{meta.licenca ? ` · Licença: ${meta.licenca}` : ""}</>}
        acoes={
          <>
            <Button variant="outline" asChild><Link href="/questoes"><ArrowLeft /> Banco</Link></Button>
            {dono && (tentativas ?? []).length === 0 && <Button variant="outline" asChild><Link href={`/questoes/${id}/editar`}><Pencil /> Editar</Link></Button>}
            {dono && <AcoesDono id={id} status={meta.status} />}
          </>
        }
      />

      {meta.status === "aprovada" ? (
        <Resolvedor
          questoes={[questao]}
          favoritas={favorito ? [id] : []}
          marcadas={marcacao?.marcada_revisao ? [id] : []}
          duvidas={marcacao?.duvida ? { [id]: marcacao.duvida } : {}}
        />
      ) : (
        <>
          <Aviso tipo="alerta" className="mb-4">Esta questão não está disponível para resolução ({ROTULO_STATUS[meta.status].toLowerCase()}).</Aviso>
          <Card><CardContent className="p-6"><CartaoQuestao questao={questao} selecionada={null} /></CardContent></Card>
        </>
      )}

      {(tentativas ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Seu histórico nesta questão</CardTitle></CardHeader>
          <CardContent>
            <Tabela>
              <thead><tr><th>Tentativa</th><th>Data</th><th>Resposta</th><th>Resultado</th><th>Tempo</th><th>Contexto</th></tr></thead>
              <tbody>
                {(tentativas ?? []).map((t) => (
                  <tr key={t.tentativa_numero}>
                    <td>#{t.tentativa_numero}</td>
                    <td>{formatarDataHora(t.created_at)}</td>
                    <td>{letra(t.alternativa_id)}</td>
                    <td><Badge variant={t.correta ? "success" : "destructive"}>{t.correta ? "Acerto" : "Erro"}</Badge></td>
                    <td>{formatarDuracao(t.tempo_seg)}</td>
                    <td className="capitalize">{t.contexto}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </CardContent>
        </Card>
      )}
    </>
  );
}
