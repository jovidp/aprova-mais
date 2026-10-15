import type { Metadata } from "next";
import Link from "next/link";
import { NotebookPen, PenLine } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { GraficoBarras } from "@/components/graficos/graficos";
import { ItemCaderno, type LinhaCaderno } from "./item-caderno";
import { BotaoRevisoes, FiltroCaderno } from "./controles";

export const metadata: Metadata = { title: "Caderno de Erros" };

export default async function PaginaCaderno({ searchParams }: PageProps<"/caderno-erros">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ["ativo", "superado", "arquivado"].includes(sp.status) ? sp.status : "ativo";
  const causa = typeof sp.causa === "string" ? sp.causa : "";
  const disciplina = typeof sp.disciplina === "string" ? sp.disciplina : "";
  const supabase = await clienteServidor();

  let consulta = supabase.from("caderno_erros")
    .select("id, questao_id, total_erros, acertos_seguidos, causa, observacoes, status, primeira_ocorrencia_em, ultima_ocorrencia_em, ultima_alternativa_errada_id, questoes!inner(enunciado, disciplina_id, assunto_id, disciplinas(nome), assuntos(nome), alternativas(id, letra))")
    .eq("user_id", usuario.id).eq("status", status).order("ultima_ocorrencia_em", { ascending: false }).limit(300);
  if (causa) consulta = consulta.eq("causa", causa);
  if (disciplina) consulta = consulta.eq("questoes.disciplina_id", disciplina);
  const [{ data, error }, { data: disciplinas }] = await Promise.all([consulta, supabase.from("disciplinas").select("id, nome").order("nome")]);
  if (error) throw error;

  const linhas: LinhaCaderno[] = ((data ?? []) as unknown as {
    id: string; questao_id: string; total_erros: number; acertos_seguidos: number; causa: string; observacoes: string | null; status: string;
    primeira_ocorrencia_em: string; ultima_ocorrencia_em: string; ultima_alternativa_errada_id: string | null;
    questoes: { enunciado: string; assunto_id: string | null; disciplinas: { nome: string } | null; assuntos: { nome: string } | null; alternativas: { id: string; letra: string }[] };
  }[]).map((l) => ({
    id: l.id, questaoId: l.questao_id, enunciado: l.questoes.enunciado, disciplina: l.questoes.disciplinas?.nome ?? "", assunto: l.questoes.assuntos?.nome ?? null,
    assuntoId: l.questoes.assunto_id, totalErros: l.total_erros, acertosSeguidos: l.acertos_seguidos, causa: l.causa, observacoes: l.observacoes ?? "",
    status: l.status, primeira: l.primeira_ocorrencia_em, ultima: l.ultima_ocorrencia_em,
    letraErrada: l.questoes.alternativas.find((a) => a.id === l.ultima_alternativa_errada_id)?.letra ?? null,
  }));

  const porAssunto = new Map<string, { nome: string; erros: number; questoes: number; id: string | null }>();
  for (const l of linhas) {
    const k = l.assunto ?? "Sem assunto";
    const a = porAssunto.get(k) ?? { nome: k, erros: 0, questoes: 0, id: l.assuntoId };
    porAssunto.set(k, { ...a, erros: a.erros + l.totalErros, questoes: a.questoes + 1 });
  }
  const ranking = [...porAssunto.values()].sort((a, b) => b.erros - a.erros);
  const naoClassificados = linhas.filter((l) => l.causa === "nao_classificado").length;

  return (
    <>
      <CabecalhoPagina
        titulo="Caderno de Erros"
        descricao="Toda questão errada entra aqui automaticamente. Ela é considerada superada após dois acertos seguidos."
        acoes={status === "ativo" && linhas.length > 0 ? (
          <>
            <BotaoRevisoes />
            <Button asChild><Link href="/resolver?situacao=caderno"><PenLine /> Refazer erros</Link></Button>
          </>
        ) : undefined}
      />
      <FiltroCaderno status={status} causa={causa} disciplina={disciplina} disciplinas={disciplinas ?? []} />

      {linhas.length === 0 ? (
        <EstadoVazio icone={<NotebookPen />} titulo={status === "ativo" ? "Nenhum erro ativo" : "Nada por aqui"} descricao="Quando você errar uma questão, ela aparece aqui com o histórico de evolução." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="grid content-start gap-3">
            {naoClassificados > 0 && status === "ativo" && (
              <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
                {naoClassificados} erro(s) sem causa definida. Classificar o motivo (falta de atenção, confusão de conceitos…) ajuda a planejar a revisão.
              </p>
            )}
            {linhas.map((l) => <ItemCaderno key={l.id} linha={l} />)}
          </div>
          <div className="grid content-start gap-4">
            <GraficoBarras titulo="Assuntos que concentram mais erros" nomeSerie="Erros" horizontal cor="var(--chart-2)"
              dados={ranking.slice(0, 10).map((a) => ({ rotulo: a.nome, valor: a.erros, detalhe: `${a.questoes} questão(ões)` }))} />
            <Card>
              <CardHeader><CardTitle>Revisões sugeridas</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {ranking.slice(0, 5).map((a) => (
                  <div key={a.nome} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{a.nome} <Badge variant="destructive">{a.erros}</Badge></span>
                    {a.id && <Button size="sm" variant="outline" asChild><Link href={`/resolver?assunto=${a.id}&situacao=caderno`}>Refazer</Link></Button>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
