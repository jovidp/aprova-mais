import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Aviso, CabecalhoPagina, Tabela } from "@/components/ui/layout";
import { TIPOS_SIMULADO, type TipoSimulado } from "@/lib/simulados/config";
import { formatarDataHora, formatarDuracao, formatarPercentual } from "@/lib/utils";
import { AcoesSimulado } from "./acoes-simulado";

export const metadata: Metadata = { title: "Simulado" };

const ROTULO_TENTATIVA: Record<string, string> = { em_andamento: "Em andamento", pausada: "Pausada", concluida: "Concluída", interrompida: "Interrompida" };

export default async function PaginaSimulado({ params, searchParams }: PageProps<"/simulados/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: s } = await supabase.from("simulados").select("*, bancas(sigla), simulados_questoes(disciplina_id, assunto_id, dificuldade)").eq("id", id).eq("user_id", usuario.id).maybeSingle();
  if (!s) notFound();
  const [{ data: tentativas }, { data: resultados }, { data: disciplinas }] = await Promise.all([
    supabase.from("simulados_tentativas").select("id, numero, status, iniciada_em, finalizada_em, finalizacao").eq("simulado_id", id).order("numero", { ascending: false }),
    supabase.from("simulados_resultados").select("tentativa_id, nota, nota_maxima, percentual_acerto_total, tempo_total_seg").eq("simulado_id", id),
    supabase.from("disciplinas").select("id, nome"),
  ]);
  const questoes = (s.simulados_questoes ?? []) as { disciplina_id: string; dificuldade: string }[];
  const porDisciplina = new Map<string, number>();
  for (const q of questoes) porDisciplina.set(q.disciplina_id, (porDisciplina.get(q.disciplina_id) ?? 0) + 1);
  const nomeDisc = new Map((disciplinas ?? []).map((d) => [d.id, d.nome]));
  const ativa = (tentativas ?? []).find((t) => t.status === "em_andamento" || t.status === "pausada");
  const resultadoPor = new Map((resultados ?? []).map((r) => [r.tentativa_id, r]));

  return (
    <>
      <CabecalhoPagina
        titulo={s.nome}
        descricao={`${TIPOS_SIMULADO[s.tipo as TipoSimulado]?.rotulo ?? s.tipo} · criado em ${formatarDataHora(s.created_at)}`}
        acoes={<>
          <Button variant="outline" asChild><Link href="/simulados"><ArrowLeft /> Meus simulados</Link></Button>
          <AcoesSimulado id={id} nome={s.nome} tentativaAtiva={ativa?.id ?? null} jaFeito={(tentativas ?? []).length > 0} />
        </>}
      />
      {sp.novo === "1" && <Aviso tipo="sucesso" className="mb-4">Simulado pronto. Quando começar, o cronômetro é controlado pelo servidor e suas respostas são salvas automaticamente.</Aviso>}
      {(s.observacoes_geracao as string[]).length > 0 && <Aviso tipo="info" className="mb-4">{(s.observacoes_geracao as string[]).join(" ")}</Aviso>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle>Tentativas</CardTitle></CardHeader>
          <CardContent>
            {(tentativas ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Ainda não iniciado.</p> : (
              <Tabela>
                <thead><tr><th>#</th><th>Início</th><th>Status</th><th className="text-right">Nota</th><th className="text-right">Acerto</th><th className="text-right">Tempo</th><th /></tr></thead>
                <tbody>
                  {(tentativas ?? []).map((t) => {
                    const r = resultadoPor.get(t.id);
                    return (
                      <tr key={t.id}>
                        <td>{t.numero}</td>
                        <td>{formatarDataHora(t.iniciada_em)}</td>
                        <td><Badge variant={t.status === "concluida" ? "success" : t.status === "interrompida" ? "warning" : "info"}>{ROTULO_TENTATIVA[t.status]}</Badge>{t.finalizacao === "tempo_esgotado" && <span className="ml-1 text-xs text-muted-foreground">(tempo)</span>}</td>
                        <td className="text-right tabular-nums">{r ? `${Number(r.nota)}/${Number(r.nota_maxima)}` : "—"}</td>
                        <td className="text-right tabular-nums">{r ? formatarPercentual(Number(r.percentual_acerto_total)) : "—"}</td>
                        <td className="text-right tabular-nums">{r ? formatarDuracao(r.tempo_total_seg) : "—"}</td>
                        <td className="text-right">
                          {r ? <Button size="sm" variant="outline" asChild><Link href={`/simulados/resultado/${t.id}`}>Correção</Link></Button>
                            : <Button size="sm" asChild><Link href={`/simulados/prova/${t.id}`}>Continuar</Link></Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabela>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Configuração</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Questões</dt><dd>{s.total_questoes}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Tempo</dt><dd>{s.tempo_limite_seg ? `${Math.round(s.tempo_limite_seg / 60)} min` : "Sem limite"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Pontuação</dt><dd>+{Number(s.pontos_acerto)} / {Number(s.pontos_erro)} / {Number(s.pontos_branco)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Nota negativa</dt><dd>{s.nota_nao_negativa ? "Não (mínimo zero)" : "Permitida"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Pausa</dt><dd>{s.permite_pausa ? "Permitida" : "Não"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Gabarito</dt><dd>{s.mostrar_gabarito_durante ? "Durante a prova" : "Após a entrega"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Ordem</dt><dd>{s.ordem === "aleatoria" ? "Aleatória" : "Organizada"}</dd></div>
              {(s.bancas as unknown as { sigla: string } | null) && <div className="flex justify-between"><dt className="text-muted-foreground">Estilo</dt><dd>{(s.bancas as unknown as { sigla: string }).sigla} (autoral)</dd></div>}
            </dl>
            <div className="mt-4 grid gap-1 text-sm">
              <p className="font-medium">Distribuição</p>
              {[...porDisciplina].map(([d, n]) => <div key={d} className="flex justify-between"><span>{nomeDisc.get(d) ?? "—"}</span><span className="tabular-nums">{n}</span></div>)}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
