import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { AdicionarDisciplina, ConfigDisciplina, ListaAssuntos } from "./controles";
import { GeradorPontos } from "@/components/materiais/gerador-pontos";

export const metadata: Metadata = { title: "Disciplinas" };

export default async function PaginaDisciplinas() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const [{ data: config }, { data: materiais }] = await Promise.all([
    supabase.from("usuario_disciplinas").select("disciplina_id, peso, dificuldade, prioridade, ativa").eq("user_id", usuario.id),
    supabase.from("materiais").select("disciplina_id").eq("user_id", usuario.id),
  ]);
  const ids = [...new Set([...(config ?? []).map((c) => c.disciplina_id), ...(materiais ?? []).map((m) => m.disciplina_id).filter((x): x is string => Boolean(x))])];
  const [{ data: disciplinas }, { data: assuntos }] = ids.length
    ? await Promise.all([
      supabase.from("disciplinas").select("id, nome").in("id", ids).order("nome"),
      supabase.from("assuntos").select("id, nome, disciplina_id, owner_id").in("disciplina_id", ids).order("ordem").order("nome"),
    ])
    : [{ data: [] }, { data: [] }];
  const materiaisPorDisc = (materiais ?? []).reduce((m, x) => (x.disciplina_id ? m.set(x.disciplina_id, (m.get(x.disciplina_id) ?? 0) + 1) : m), new Map<string, number>());
  const cfg = new Map((config ?? []).map((c) => [c.disciplina_id, c]));

  return (
    <>
      <CabecalhoPagina titulo="Disciplinas" descricao="Peso, prioridade e dificuldade definem quanto tempo cada disciplina recebe no cronograma." acoes={<AdicionarDisciplina />} />
      {!disciplinas?.length ? (
        <EstadoVazio icone={<BookMarked />} titulo="Nenhuma disciplina" descricao="Adicione disciplinas ou importe materiais para começar." />
      ) : (
        <div className="grid gap-4">
          {disciplinas.map((d) => {
            const c = cfg.get(d.id);
            const lista = (assuntos ?? []).filter((a) => a.disciplina_id === d.id);
            return (
              <Card key={d.id} className={c && !c.ativa ? "opacity-70" : undefined}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>{d.nome}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {lista.length} assunto(s) · <Link className="hover:underline" href={`/biblioteca?disciplina=${d.id}`}>{materiaisPorDisc.get(d.id) ?? 0} material(is)</Link> · <Link className="hover:underline" href={`/mapa?disciplina=${d.id}`}>ver no mapa</Link>
                    </p>
                  </div>
                  {(materiaisPorDisc.get(d.id) ?? 0) > 0 && <GeradorPontos escopo={{ disciplinaId: d.id, nome: d.nome }} rotulo="Pontos importantes dos PDFs" variante="outline" />}
                </CardHeader>
                <CardContent className="grid gap-4">
                  <ConfigDisciplina disciplinaId={d.id} inicial={{ peso: Number(c?.peso ?? 1), dificuldade: c?.dificuldade ?? 3, prioridade: c?.prioridade ?? 3, ativa: c?.ativa ?? true }} />
                  <ListaAssuntos disciplinaId={d.id} assuntos={lista.map((a) => ({ id: a.id, nome: a.nome, proprio: a.owner_id === usuario.id }))} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
