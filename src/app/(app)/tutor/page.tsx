import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { estadoIA } from "@/lib/ia";
import { Button } from "@/components/ui/button";
import { Aviso, CabecalhoPagina } from "@/components/ui/layout";
import { cn, formatarData } from "@/lib/utils";
import { Chat, type MensagemChat } from "./chat";
import { ExcluirConversa } from "./excluir-conversa";

export const metadata: Metadata = { title: "Tutor IA" };

const uuid = /^[0-9a-f-]{36}$/i;

export default async function PaginaTutor({ searchParams }: PageProps<"/tutor">) {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const sp = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const conversaId = uuid.test(um(sp.c)) ? um(sp.c) : null;
  const questaoId = uuid.test(um(sp.questao)) ? um(sp.questao) : null;
  const assuntoId = uuid.test(um(sp.assunto)) ? um(sp.assunto) : null;
  const materialId = uuid.test(um(sp.material)) ? um(sp.material) : null;
  const pergunta = um(sp.pergunta).slice(0, 4000);

  const [{ data: conversas }, { data: mensagens }, ia, { count: paginas }] = await Promise.all([
    supabase.from("tutor_conversas").select("id, titulo, updated_at").eq("user_id", usuario.id).order("updated_at", { ascending: false }).limit(50),
    conversaId
      ? supabase.from("tutor_mensagens").select("id, papel, conteudo, fontes, created_at").eq("conversa_id", conversaId).eq("user_id", usuario.id).order("created_at").limit(200)
      : Promise.resolve({ data: [] }),
    estadoIA(usuario.id),
    supabase.from("material_paginas").select("material_id", { count: "exact", head: true }).eq("user_id", usuario.id),
  ]);

  return (
    <>
      <CabecalhoPagina titulo="Tutor IA" descricao="Tire dúvidas com base nos seus materiais. As respostas citam o material e a página usados." />
      {!ia.configurada && <Aviso tipo="alerta" className="mb-4" titulo="IA não configurada">Sem um provedor de IA, o tutor mostra apenas os trechos mais relevantes dos seus materiais.</Aviso>}
      {ia.configurada && ia.bloqueadaPorOrcamento && <Aviso tipo="alerta" className="mb-4" titulo="IA indisponível">O orçamento de IA foi atingido ou a IA está desativada nas suas preferências. O tutor mostrará apenas trechos dos materiais.</Aviso>}
      {!paginas && <Aviso className="mb-4" titulo="Nenhum material importado">O tutor responde melhor com seus PDFs. <Link className="underline" href="/biblioteca/importar">Importe materiais</Link>.</Aviso>}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="grid content-start gap-2" aria-label="Conversas">
          <Button asChild variant="outline"><Link href="/tutor"><MessageSquarePlus /> Nova conversa</Link></Button>
          <nav className="grid max-h-[60vh] gap-0.5 overflow-y-auto">
            {(conversas ?? []).map((c) => (
              <div key={c.id} className={cn("group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted", c.id === conversaId && "bg-muted")}>
                <Link href={`/tutor?c=${c.id}`} className="min-w-0 flex-1 px-2 py-1.5" aria-current={c.id === conversaId ? "page" : undefined}>
                  <span className="block truncate">{c.titulo}</span>
                  <span className="text-xs text-muted-foreground">{formatarData(c.updated_at)}</span>
                </Link>
                <ExcluirConversa id={c.id} ativa={c.id === conversaId} />
              </div>
            ))}
            {!conversas?.length && <p className="px-2 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>}
          </nav>
        </aside>

        <Chat
          key={conversaId ?? `nova-${pergunta}`}
          conversaId={conversaId}
          iniciais={(mensagens ?? []).map((m) => ({ id: m.id, papel: m.papel as MensagemChat["papel"], conteudo: m.conteudo, fontes: (m.fontes ?? []) as MensagemChat["fontes"] }))}
          perguntaInicial={conversaId ? "" : pergunta}
          contexto={{ questaoId, assuntoId, materialId }}
        />
      </div>
    </>
  );
}
