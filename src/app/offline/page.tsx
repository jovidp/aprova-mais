import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Sem conexão" };
export const dynamic = "force-static";

export default function PaginaOffline() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-3">
        <WifiOff className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Você está sem conexão</h1>
        <p className="text-sm text-muted-foreground">As páginas já visitadas continuam disponíveis para leitura. Respostas, simulados e registros precisam de internet para serem salvos com segurança.</p>
        <a href="/dashboard" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Tentar novamente</a>
      </div>
    </main>
  );
}
