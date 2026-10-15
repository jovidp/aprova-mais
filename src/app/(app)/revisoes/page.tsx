import type { Metadata } from "next";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio, Indicador } from "@/components/ui/layout";
import { dataLocal } from "@/lib/estudo/tempo";
import { fusoDoUsuario } from "@/lib/servidor/painel";
import { formatarData } from "@/lib/utils";
import { CartaoRevisao, type RevisaoExibicao } from "./cartao-revisao";
import { NovaRevisao } from "./nova-revisao";

export const metadata: Metadata = { title: "Revisões" };

export default async function PaginaRevisoes() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const hoje = dataLocal(new Date(), await fusoDoUsuario(supabase, usuario.id));
  const [{ data: revisoes }, { data: assuntos }, { count: feitasHoje }, { data: pref }] = await Promise.all([
    supabase.from("revisoes").select("id, alvo_tipo, titulo, assunto_id, questao_id, secao_id, intervalo_dias, repeticoes, lapsos, proxima_em, ultima_em, status, origem, assuntos(nome, disciplinas(nome))")
      .eq("user_id", usuario.id).eq("status", "ativa").order("proxima_em").limit(500),
    supabase.from("assuntos").select("id, nome, disciplinas(nome)").order("nome").limit(2000),
    supabase.from("revisao_historico").select("id", { count: "exact", head: true }).eq("user_id", usuario.id).gte("created_at", `${hoje}T00:00:00`),
    supabase.from("preferencias_usuario").select("intervalos_revisao_dias").eq("user_id", usuario.id).maybeSingle(),
  ]);
  const lista = (revisoes ?? []) as unknown as (RevisaoExibicao & { assuntos: { nome: string; disciplinas: { nome: string } | null } | null })[];
  const vencidas = lista.filter((r) => r.proxima_em <= hoje);
  const futuras = lista.filter((r) => r.proxima_em > hoje);

  // Material de apoio para cada assunto vencido.
  const assuntosVencidos = [...new Set(vencidas.map((r) => r.assunto_id).filter((x): x is string => Boolean(x)))];
  const [{ data: secoes }, { data: erros }] = await Promise.all([
    assuntosVencidos.length ? supabase.from("material_secoes").select("assunto_id, material_id, titulo, pagina_inicio, pagina_fim").eq("user_id", usuario.id).in("assunto_id", assuntosVencidos).in("tipo", ["teoria", "resumo"]).order("pagina_inicio") : Promise.resolve({ data: [] }),
    assuntosVencidos.length ? supabase.from("caderno_erros").select("questoes!inner(assunto_id)").eq("user_id", usuario.id).eq("status", "ativo").in("questoes.assunto_id", assuntosVencidos) : Promise.resolve({ data: [] }),
  ]);
  const errosPorAssunto = new Map<string, number>();
  for (const e of (erros ?? []) as unknown as { questoes: { assunto_id: string } }[]) errosPorAssunto.set(e.questoes.assunto_id, (errosPorAssunto.get(e.questoes.assunto_id) ?? 0) + 1);

  return (
    <>
      <CabecalhoPagina titulo="Revisões" descricao={`Revisão espaçada: intervalos iniciais de ${(pref?.intervalos_revisao_dias ?? [1, 7, 15, 30]).join(", ")} dias, ajustados pela sua avaliação.`}
        acoes={<NovaRevisao assuntos={(assuntos ?? []).map((a) => ({ id: a.id, nome: `${a.nome} · ${(a.disciplinas as unknown as { nome: string } | null)?.nome ?? ""}` }))} />} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Indicador rotulo="Para hoje" valor={vencidas.length} />
        <Indicador rotulo="Feitas hoje" valor={feitasHoje ?? 0} />
        <Indicador rotulo="Agendadas" valor={futuras.length} detalhe={futuras[0] ? `Próxima em ${formatarData(futuras[0].proxima_em)}` : undefined} />
      </div>
      {lista.length === 0 ? (
        <EstadoVazio icone={<RotateCcw />} titulo="Nenhuma revisão agendada" descricao="Revisões são criadas a partir dos erros, dos resultados de simulados ou manualmente." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid content-start gap-3">
            {vencidas.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">Nenhuma revisão vencida. Bom trabalho!</p>}
            {vencidas.map((r) => (
              <CartaoRevisao key={r.id} revisao={{ ...r, disciplina: r.assuntos?.disciplinas?.nome ?? null }} hoje={hoje}
                secoes={(secoes ?? []).filter((s) => s.assunto_id === r.assunto_id).slice(0, 4)}
                erros={r.assunto_id ? errosPorAssunto.get(r.assunto_id) ?? 0 : 0} />
            ))}
          </div>
          <Card className="content-start">
            <CardHeader><CardTitle>Próximas</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {futuras.slice(0, 30).map((r) => (
                <div key={r.id} className="flex justify-between gap-2">
                  <span className="truncate">{r.titulo}</span><Badge variant="outline">{formatarData(r.proxima_em)}</Badge>
                </div>
              ))}
              {futuras.length > 30 && <p className="text-xs text-muted-foreground">e mais {futuras.length - 30}</p>}
              {futuras.length === 0 && <p className="text-muted-foreground">Nada agendado além de hoje.</p>}
              <Link href="/cronograma" className="mt-2 text-xs text-primary hover:underline">As revisões entram no seu cronograma automaticamente</Link>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
