"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirmar } from "@/components/ui/sobreposicoes";
import { excluirConversa } from "./acoes";

export function ExcluirConversa({ id, ativa }: { id: string; ativa: boolean }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <Confirmar titulo="Excluir conversa?" descricao="As mensagens desta conversa serão apagadas." confirmar="Excluir" destrutivo desabilitado={pendente}
      aoConfirmar={() => iniciar(async () => {
        const r = await excluirConversa(id);
        if (!r.ok) toast.error(r.erro);
        else if (ativa) router.push("/tutor");
      })}>
      <Button variant="ghost" size="icon-sm" aria-label="Excluir conversa" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><Trash2 /></Button>
    </Confirmar>
  );
}
