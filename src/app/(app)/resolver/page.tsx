import type { Metadata } from "next";
import Link from "next/link";
import { History, PenLine } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina } from "@/components/ui/layout";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";
import { lerValoresFiltro } from "@/lib/questoes/filtros";
import { formatarDataHora } from "@/lib/utils";
import { ConfigurarSessao } from "./configurar-sessao";

export const metadata: Metadata = { title: "Resolver Questões" };

export default async function PaginaResolver({ searchParams }: PageProps<"/resolver">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const [opcoes, { data: abertas }] = await Promise.all([
    carregarOpcoesFiltro(supabase, usuario.id),
    supabase.from("sessoes_questoes").select("id, nome, questao_ids, posicao, updated_at").eq("user_id", usuario.id)
      .eq("status", "em_andamento").order("updated_at", { ascending: false }).limit(5),
  ]);

  return (
    <>
      <CabecalhoPagina titulo="Resolver Questões" descricao="Monte uma sessão com os filtros que quiser. Seu progresso é salvo a cada resposta." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ConfigurarSessao opcoes={opcoes} valores={lerValoresFiltro(sp)} />
        <Card className="content-start">
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" /> Sessões em andamento</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {(abertas ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma sessão interrompida.</p>}
            {(abertas ?? []).map((s) => (
              <Link key={s.id} href={`/resolver/${s.id}`} className="rounded-lg border p-3 text-sm hover:border-primary/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.nome}</span>
                  <Badge variant="outline"><PenLine /> {s.posicao + 1}/{(s.questao_ids as string[]).length}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">Continuar · {formatarDataHora(s.updated_at)}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
