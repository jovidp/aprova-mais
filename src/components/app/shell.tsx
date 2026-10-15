"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GraduationCap, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAVEGACAO, NAVEGACAO_ADMIN, itemAtivo } from "./navegacao";
import { BarraSuperior } from "./barra-superior";

interface ShellProps {
  children: React.ReactNode;
  usuario: { nome: string; email: string | null; admin: boolean };
  notificacoesNaoLidas: number;
}

function ListaNavegacao({ admin, aoNavegar }: { admin: boolean; aoNavegar?: () => void }) {
  const caminho = usePathname();
  const itens = admin ? [...NAVEGACAO, NAVEGACAO_ADMIN] : NAVEGACAO;
  const ativo = itemAtivo(caminho, itens);
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-0.5 px-3 py-2">
      {itens.map((item) => {
        const Icone = item.icone;
        const selecionado = item.href === ativo;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={aoNavegar}
            aria-current={selecionado ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              selecionado
                ? "bg-primary/10 font-medium text-primary"
                : "text-sidebar-foreground/80 hover:bg-accent hover:text-accent-foreground",
              item === NAVEGACAO_ADMIN && "mt-2 border-t pt-3",
            )}
          >
            <Icone className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Marca() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-6 py-5 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <span className="text-lg tracking-tight">Aprova+</span>
    </Link>
  );
}

export function Shell({ children, usuario, notificacoesNaoLidas }: ShellProps) {
  const [menuAberto, setMenuAberto] = useState(false);
  const caminho = usePathname();
  useEffect(() => setMenuAberto(false), [caminho]);

  return (
    <div className="flex min-h-dvh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>

      <aside className="nao-imprimir sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r bg-sidebar lg:flex">
        <Marca />
        <ListaNavegacao admin={usuario.admin} />
      </aside>

      {menuAberto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuAberto(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto bg-sidebar shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Marca />
              <button className="rounded-md p-2 hover:bg-accent" onClick={() => setMenuAberto(false)} aria-label="Fechar menu">
                <X className="size-5" />
              </button>
            </div>
            <ListaNavegacao admin={usuario.admin} aoNavegar={() => setMenuAberto(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperior
          usuario={usuario}
          notificacoesNaoLidas={notificacoesNaoLidas}
          botaoMenu={
            <button className="rounded-md p-2 hover:bg-accent lg:hidden" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">
              <Menu className="size-5" />
            </button>
          }
        />
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
