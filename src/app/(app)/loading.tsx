import { Skeleton } from "@/components/ui/basicos";

/**
 * Esqueleto exibido imediatamente ao trocar de página. Como o Next.js
 * pré-carrega este estado junto com os links do menu, a navegação responde
 * no clique enquanto os dados da nova página chegam do servidor.
 */
export default function Carregando() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Carregando">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
