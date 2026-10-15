import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Network, PenLine, Sparkles } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Badge, Card, CardContent, Progress } from "@/components/ui/basicos";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina, EstadoVazio, Indicador } from "@/components/ui/layout";
import { COR_NIVEL, ROTULO_NIVEL, type NivelDominio } from "@/lib/estudo/dominio";
import { dataLocal } from "@/lib/estudo/tempo";
import { dominioPorAssunto, fusoDoUsuario } from "@/lib/servidor/painel";
import { cn, formatarPercentual } from "@/lib/utils";
import { FiltrosMapa } from "./filtros-mapa";

export const metadata: Metadata = { title: "Mapa de Conhecimento" };

const NIVEIS: NivelDominio[] = ["nao_iniciado", "em_aprendizado", "necessita_reforco", "bom_desempenho", "dominio_consistente"];
const BARRA: Record<NivelDominio, string> = {
  nao_iniciado: "bg-muted-foreground/30", em_aprendizado: "bg-[var(--chart-2)]", necessita_reforco: "bg-destructive",
  bom_desempenho: "bg-success", dominio_consistente: "bg-primary",
};

interface Secao { assunto_id: string | null; subassunto_id: string | null; material_id: string; titulo: string; pagina_inicio: number; pagina_fim: number; tipo: string }

export default async function PaginaMapa({ searchParams }: PageProps<"/mapa">) {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const sp = await searchParams;
  const filtroDisc = typeof sp.disciplina === "string" ? sp.disciplina : "";
  const filtroNivel = typeof sp.nivel === "string" ? sp.nivel : "";
  const destaque = typeof sp.assunto === "string" ? sp.assunto : "";
  const hoje = dataLocal(new Date(), await fusoDoUsuario(supabase, usuario.id));

  const [{ data: perfil }, { data: minhas }, { data: materiais }, dominio, { data: secoes }, { data: progresso }, { data: questoes }, { data: erros }, { data: revisoes }] = await Promise.all([
    supabase.from("profiles").select("concurso_alvo_id, data_prova, concursos(nome, cargo, orgao)").eq("id", usuario.id).maybeSingle(),
    supabase.from("usuario_disciplinas").select("disciplina_id, peso, prioridade, ativa").eq("user_id", usuario.id),
    supabase.from("materiais").select("id, titulo, disciplina_id, total_paginas").eq("user_id", usuario.id),
    dominioPorAssunto(supabase),
    supabase.from("material_secoes").select("assunto_id, subassunto_id, material_id, titulo, pagina_inicio, pagina_fim, tipo").eq("user_id", usuario.id).not("assunto_id", "is", null).limit(10000),
    supabase.from("progresso_leitura").select("material_id, paginas_lidas").eq("user_id", usuario.id),
    supabase.from("questoes").select("assunto_id").eq("status", "aprovada").not("assunto_id", "is", null).limit(20000),
    supabase.from("caderno_erros").select("questoes!inner(assunto_id)").eq("user_id", usuario.id).eq("status", "ativo").limit(5000),
    supabase.from("revisoes").select("assunto_id, proxima_em").eq("user_id", usuario.id).eq("status", "ativa").not("assunto_id", "is", null),
  ]);

  const discIds = [...new Set([...(minhas ?? []).filter((m) => m.ativa).map((m) => m.disciplina_id), ...(materiais ?? []).map((m) => m.disciplina_id).filter((x): x is string => Boolean(x))])];
  const [{ data: disciplinas }, { data: assuntos }] = discIds.length
    ? await Promise.all([
      supabase.from("disciplinas").select("id, nome").in("id", discIds).order("nome"),
      supabase.from("assuntos").select("id, nome, disciplina_id, ordem, subassuntos(id, nome, ordem)").in("disciplina_id", discIds).order("ordem").order("nome"),
    ])
    : [{ data: [] }, { data: [] }];

  // Índices auxiliares
  const domPorAssunto = new Map(dominio.map((d) => [d.assuntoId, d]));
  const lidas = new Map((progresso ?? []).map((p) => [p.material_id, new Set(p.paginas_lidas as number[])]));
  const tituloMaterial = new Map((materiais ?? []).map((m) => [m.id, m.titulo]));
  const secoesPorAssunto = new Map<string, Secao[]>();
  for (const s of (secoes ?? []) as Secao[]) {
    const l = secoesPorAssunto.get(s.assunto_id!) ?? [];
    l.push(s);
    secoesPorAssunto.set(s.assunto_id!, l);
  }
  const contar = (lista: (string | null)[]) => lista.reduce((m, id) => (id ? m.set(id, (m.get(id) ?? 0) + 1) : m), new Map<string, number>());
  const qPorAssunto = contar((questoes ?? []).map((q) => q.assunto_id));
  const errosPorAssunto = contar(((erros ?? []) as unknown as { questoes: { assunto_id: string | null } }[]).map((e) => e.questoes.assunto_id));
  const revVencidas = contar((revisoes ?? []).filter((r) => r.proxima_em <= hoje).map((r) => r.assunto_id));
  const peso = new Map((minhas ?? []).map((m) => [m.disciplina_id, m]));

  const leitura = (lista: Secao[]) => {
    let total = 0;
    let lido = 0;
    for (const s of lista.filter((x) => x.tipo === "teoria" || x.tipo === "resumo")) {
      const set = lidas.get(s.material_id);
      for (let p = s.pagina_inicio; p <= s.pagina_fim; p++) { total++; if (set?.has(p)) lido++; }
    }
    return { total, lido };
  };

  type ItemAssunto = { id: string; nome: string; nivel: NivelDominio; indice: number; respondidas: number; taxa: number | null; leitura: { total: number; lido: number };
    secoes: Secao[]; questoes: number; erros: number; revisoes: number; subassuntos: { id: string; nome: string; secoes: Secao[] }[] };
  const arvore = (disciplinas ?? []).filter((d) => !filtroDisc || d.id === filtroDisc).map((d) => {
    const itens: ItemAssunto[] = (assuntos ?? []).filter((a) => a.disciplina_id === d.id).map((a) => {
      const dom = domPorAssunto.get(a.id);
      const secs = secoesPorAssunto.get(a.id) ?? [];
      return {
        id: a.id, nome: a.nome, nivel: dom?.nivel ?? "nao_iniciado", indice: dom?.indice ?? 0, respondidas: dom?.respondidas ?? 0, taxa: dom?.taxa ?? null,
        leitura: leitura(secs), secoes: secs, questoes: qPorAssunto.get(a.id) ?? 0, erros: errosPorAssunto.get(a.id) ?? 0, revisoes: revVencidas.get(a.id) ?? 0,
        subassuntos: [...((a.subassuntos ?? []) as { id: string; nome: string; ordem: number }[])].sort((x, y) => x.ordem - y.ordem).map((s) => ({ id: s.id, nome: s.nome, secoes: secs.filter((x) => x.subassunto_id === s.id) })),
      };
    }).filter((a) => !filtroNivel || a.nivel === filtroNivel);
    const contagem = Object.fromEntries(NIVEIS.map((n) => [n, itens.filter((i) => i.nivel === n).length])) as Record<NivelDominio, number>;
    const leit = itens.reduce((s, i) => ({ total: s.total + i.leitura.total, lido: s.lido + i.leitura.lido }), { total: 0, lido: 0 });
    return { ...d, itens, contagem, leitura: leit, config: peso.get(d.id) };
  }).filter((d) => d.itens.length > 0 || !filtroNivel);

  const todos = arvore.flatMap((d) => d.itens);
  const concurso = perfil?.concursos as unknown as { nome: string; cargo: string | null; orgao: string | null } | null;

  return (
    <>
      <CabecalhoPagina titulo="Mapa de Conhecimento"
        descricao={concurso ? `${concurso.nome}${concurso.cargo ? ` · ${concurso.cargo}` : ""}. Domínio calculado das suas respostas; leitura, das páginas marcadas como lidas.` : "Domínio calculado das suas respostas; leitura, das páginas marcadas como lidas."}
        acoes={<FiltrosMapa disciplinas={(disciplinas ?? []).map((d) => ({ id: d.id, nome: d.nome }))} disciplina={filtroDisc} nivel={filtroNivel} niveis={NIVEIS.map((n) => ({ valor: n, rotulo: ROTULO_NIVEL[n] }))} />} />

      {arvore.length === 0 ? (
        <EstadoVazio icone={<Network />} titulo="Nada para mapear ainda" descricao="Importe materiais ou adicione disciplinas para ver o mapa." acao={<Button asChild><Link href="/biblioteca/importar">Importar materiais</Link></Button>} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            {NIVEIS.map((n) => (
              <Indicador key={n} rotulo={ROTULO_NIVEL[n]} valor={todos.filter((i) => i.nivel === n).length} detalhe="assunto(s)" />
            ))}
          </div>

          <div className="grid gap-4">
            {arvore.map((d) => (
              <Card key={d.id}>
                <CardContent className="pt-6">
                  <details open={arvore.length <= 2 || d.itens.some((i) => i.id === destaque)}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">{d.nome}</h2>
                        <p className="text-xs text-muted-foreground">
                          {d.itens.length} assunto(s){d.leitura.total ? ` · leitura ${formatarPercentual((100 * d.leitura.lido) / d.leitura.total)}` : ""}
                          {d.config ? ` · peso ${Number(d.config.peso).toLocaleString("pt-BR")} · prioridade ${d.config.prioridade}` : ""}
                        </p>
                      </div>
                      {/* Distribuição dos níveis (rótulos na legenda abaixo dos indicadores) */}
                      <div className="flex h-2.5 w-full max-w-xs gap-0.5 overflow-hidden rounded-full" role="img"
                        aria-label={NIVEIS.map((n) => `${ROTULO_NIVEL[n]}: ${d.contagem[n]}`).join(", ")}>
                        {NIVEIS.filter((n) => d.contagem[n] > 0).map((n) => <div key={n} className={BARRA[n]} style={{ flexGrow: d.contagem[n] }} title={`${ROTULO_NIVEL[n]}: ${d.contagem[n]}`} />)}
                      </div>
                    </summary>

                    <ul className="mt-4 grid gap-2">
                      {d.itens.map((a) => (
                        <li key={a.id} id={`assunto-${a.id}`} className={cn("rounded-lg border p-3", a.id === destaque && "border-primary ring-2 ring-primary/30")}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium">{a.nome}</p>
                              <p className="text-xs text-muted-foreground">
                                {a.respondidas ? `${a.respondidas} resposta(s) · acerto ${formatarPercentual(a.taxa === null ? null : a.taxa * 100)}` : "Nenhuma questão respondida"}
                                {` · ${a.questoes} questão(ões) no banco`}
                                {a.erros ? ` · ${a.erros} no caderno de erros` : ""}
                                {a.revisoes ? ` · ${a.revisoes} revisão(ões) vencida(s)` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {a.respondidas >= 10 && <span className="text-sm font-semibold tabular-nums" title="Índice de domínio (0–100)">{Math.round(a.indice)}</span>}
                              <Badge variant={COR_NIVEL[a.nivel]}>{ROTULO_NIVEL[a.nivel]}</Badge>
                            </div>
                          </div>
                          {a.leitura.total > 0 && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <BookOpen className="size-3.5" aria-hidden /> Leitura
                              <Progress className="h-1.5 max-w-48" value={(100 * a.leitura.lido) / a.leitura.total} aria-label={`Leitura de ${a.nome}`} />
                              <span className="tabular-nums">{a.leitura.lido}/{a.leitura.total} p.</span>
                            </div>
                          )}
                          <details className="mt-2 text-sm">
                            <summary className="cursor-pointer text-xs text-muted-foreground">Materiais, subassuntos e ações</summary>
                            <div className="mt-2 grid gap-3">
                              {a.secoes.length > 0 && (
                                <ul className="grid gap-1 text-xs">
                                  {a.secoes.slice(0, 12).map((s, i) => (
                                    <li key={i}>
                                      <Link className="hover:underline" href={`/biblioteca/${s.material_id}/ler?pagina=${s.pagina_inicio}`}>
                                        {tituloMaterial.get(s.material_id)} · {s.titulo} <span className="text-muted-foreground">(p. {s.pagina_inicio}–{s.pagina_fim}, {s.tipo})</span>
                                      </Link>
                                    </li>
                                  ))}
                                  {a.secoes.length > 12 && <li className="text-muted-foreground">+{a.secoes.length - 12} seção(ões)</li>}
                                </ul>
                              )}
                              {a.subassuntos.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {a.subassuntos.map((s) => <Badge key={s.id} variant="outline">{s.nome}{s.secoes.length ? ` · ${s.secoes.length} seção(ões)` : ""}</Badge>)}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <Button asChild size="sm" variant="outline"><Link href={`/resolver?disciplina=${d.id}&assunto=${a.id}`}><PenLine /> Resolver questões</Link></Button>
                                <Button asChild size="sm" variant="outline"><Link href={`/questoes/gerar?disciplina=${d.id}&assunto=${a.id}`}><Sparkles /> Gerar questões</Link></Button>
                                <Button asChild size="sm" variant="ghost"><Link href={`/tutor?assunto=${a.id}&pergunta=${encodeURIComponent(`Explique os pontos principais de ${a.nome}`)}`}>Perguntar ao tutor</Link></Button>
                              </div>
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
