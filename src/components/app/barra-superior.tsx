"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Bell, LogOut, Moon, Search, Settings, Sun, Monitor, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/sobreposicoes";
import { Kbd } from "@/components/ui/basicos";
import { sair } from "@/app/(publico)/acoes-auth";

interface Props {
  usuario: { nome: string; email: string | null };
  notificacoesNaoLidas: number;
  botaoMenu: React.ReactNode;
}

function SeletorTema() {
  const { theme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const Icone = !montado ? Monitor : theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tema">
          <Icone />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}><Sun /> Claro</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}><Moon /> Escuro</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}><Monitor /> Sistema</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BarraSuperior({ usuario, notificacoesNaoLidas, botaoMenu }: Props) {
  const router = useRouter();
  const [termo, setTermo] = useState("");

  // Atalho "/" foca a busca global.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) && !alvo.isContentEditable) {
        e.preventDefault();
        document.getElementById("busca-global")?.focus();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <header className="nao-imprimir sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      {botaoMenu}
      <form
        role="search"
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (termo.trim().length >= 2) router.push(`/busca?q=${encodeURIComponent(termo.trim())}`);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="busca-global" className="sr-only">Buscar</label>
        <input
          id="busca-global"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar materiais, questões, anotações…"
          className="h-9 w-full rounded-md border bg-card pr-10 pl-9 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Kbd className="absolute top-1/2 right-2 hidden -translate-y-1/2 sm:block">/</Kbd>
      </form>
      <div className="ml-auto flex items-center gap-1">
        <SeletorTema />
        <Button variant="ghost" size="icon" asChild aria-label={`Notificações (${notificacoesNaoLidas} não lidas)`}>
          <Link href="/notificacoes" className="relative">
            <Bell />
            {notificacoesNaoLidas > 0 && (
              <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                {notificacoesNaoLidas > 9 ? "9+" : notificacoesNaoLidas}
              </span>
            )}
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Conta">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {(usuario.nome || usuario.email || "?").charAt(0).toUpperCase()}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="font-medium text-foreground">{usuario.nome || "Estudante"}</div>
              <div className="truncate text-xs font-normal">{usuario.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/configuracoes"><User /> Perfil</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/configuracoes?aba=preferencias"><Settings /> Preferências</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void sair()}><LogOut /> Sair</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
