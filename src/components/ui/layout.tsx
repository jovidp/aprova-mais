import * as React from "react";
import { cn } from "@/lib/utils";

export function CabecalhoPagina({ titulo, descricao, acoes, className }: {
  titulo: string;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}

/** Estado vazio informativo: nunca preencher com dados fictícios. */
export function EstadoVazio({ icone, titulo, descricao, acao, className }: {
  icone?: React.ReactNode;
  titulo: string;
  descricao?: React.ReactNode;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      {icone && <div className="mb-3 text-muted-foreground [&_svg]:size-10">{icone}</div>}
      <p className="font-medium">{titulo}</p>
      {descricao && <p className="mt-1 max-w-md text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

export function Aviso({ tipo = "info", titulo, children, className }: {
  tipo?: "info" | "alerta" | "erro" | "sucesso";
  titulo?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const estilos = {
    info: "border-primary/30 bg-primary/5",
    alerta: "border-warning/50 bg-warning/10",
    erro: "border-destructive/40 bg-destructive/5",
    sucesso: "border-success/40 bg-success/5",
  }[tipo];
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className={cn("rounded-lg border p-4 text-sm", estilos, className)}>
      {titulo && <p className="mb-1 font-medium">{titulo}</p>}
      <div className="text-muted-foreground [&_a]:text-primary [&_a]:underline">{children}</div>
    </div>
  );
}

export function Indicador({ rotulo, valor, detalhe, icone, className }: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  icone?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{rotulo}</span>
        {icone && <span className="[&_svg]:size-4">{icone}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{valor}</div>
      {detalhe && <div className="mt-1 text-xs text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

export function Tabela({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-lg border">
      <table className={cn("w-full caption-bottom text-sm [&_th]:h-10 [&_th]:px-3 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-b [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-muted/40 [&_thead]:bg-muted/40", className)} {...props} />
    </div>
  );
}
