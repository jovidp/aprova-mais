"use client";

import { useRouter } from "next/navigation";
import { Archive, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirmar } from "@/components/ui/sobreposicoes";
import { definirStatusQuestao } from "../acoes";

export function AcoesDono({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  if (status === "arquivada") {
    return (
      <Button variant="outline" onClick={async () => {
        const r = await definirStatusQuestao(id, "pendente_revisao");
        if (r.ok) { toast.success("Questão enviada para revisão"); router.refresh(); } else toast.error(r.erro);
      }}><Undo2 /> Restaurar</Button>
    );
  }
  return (
    <Confirmar
      titulo="Arquivar questão?"
      descricao="Ela deixa de aparecer no banco e em novos simulados. Seu histórico de respostas e os simulados já feitos são preservados."
      confirmar="Arquivar"
      aoConfirmar={async () => {
        const r = await definirStatusQuestao(id, "arquivada");
        if (r.ok) { toast.success("Questão arquivada"); router.refresh(); } else toast.error(r.erro);
      }}
    >
      <Button variant="outline"><Archive /> Arquivar</Button>
    </Confirmar>
  );
}
