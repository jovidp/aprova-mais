"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Star, Trash2, Settings2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirmar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/sobreposicoes";
import { alternarFavorito, excluirMaterial } from "./acoes";

export function AcoesMaterial({ id, titulo, favorito }: { id: string; titulo: string; favorito: boolean }) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const [fav, setFav] = useOptimistic(favorito);

  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost" size="icon-sm" aria-label={fav ? "Remover dos favoritos" : "Favoritar"} aria-pressed={fav}
        onClick={() => iniciar(async () => {
          setFav(!fav);
          const r = await alternarFavorito(id, !fav);
          if (!r.ok) toast.error(r.erro);
        })}
      >
        <Star className={fav ? "fill-warning text-warning" : ""} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Mais ações"><MoreVertical /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><Link href={`/biblioteca/${id}`}><Settings2 /> Detalhes e classificação</Link></DropdownMenuItem>
          <Confirmar
            titulo="Excluir material?"
            descricao={<>O arquivo <strong>{titulo}</strong>, suas páginas e anotações serão removidos. Questões geradas a partir dele continuam no banco, sem o link para o PDF. Esta ação não pode ser desfeita.</>}
            confirmar="Excluir" destrutivo
            aoConfirmar={async () => {
              const r = await excluirMaterial(id);
              if (r.ok) { toast.success("Material excluído"); router.refresh(); } else toast.error(r.erro);
            }}
          >
            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
              <Trash2 /> Excluir
            </DropdownMenuItem>
          </Confirmar>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
