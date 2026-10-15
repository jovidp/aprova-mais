import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Card, CardContent } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { cn, formatarDataHora } from "@/lib/utils";
import { MarcarTodas } from "./marcar";

export const metadata: Metadata = { title: "Notificações" };

export default async function PaginaNotificacoes() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data } = await supabase.from("notificacoes").select("id, tipo, titulo, mensagem, link, lida, created_at").eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(100);
  const naoLidas = (data ?? []).filter((n) => !n.lida).length;
  return (
    <>
      <CabecalhoPagina titulo="Notificações" descricao={naoLidas ? `${naoLidas} não lida(s)` : undefined} acoes={naoLidas ? <MarcarTodas /> : undefined} />
      {!data?.length ? (
        <EstadoVazio icone={<Bell />} titulo="Nenhuma notificação" descricao="Avisos de revisões, simulados agendados e processamentos aparecem aqui." />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {data.map((n) => {
              const corpo = (
                <div className={cn("grid gap-0.5 px-4 py-3", !n.lida && "bg-primary/5")}>
                  <div className="flex items-center justify-between gap-2"><span className={cn("text-sm", !n.lida && "font-semibold")}>{n.titulo}</span><span className="text-xs text-muted-foreground">{formatarDataHora(n.created_at)}</span></div>
                  <p className="text-sm text-muted-foreground">{n.mensagem}</p>
                </div>
              );
              return n.link ? <Link key={n.id} href={n.link} className="block hover:bg-muted">{corpo}</Link> : <div key={n.id}>{corpo}</div>;
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
