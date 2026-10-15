"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/formulario";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/sobreposicoes";
import { formatarData } from "@/lib/utils";
import { criarRevisaoAssunto } from "./acoes";

export function NovaRevisao({ assuntos }: { assuntos: { id: string; nome: string }[] }) {
  const [assunto, setAssunto] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline"><Plus /> Nova revisão</Button></PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3">
        <Select aria-label="Assunto" valor={assunto} aoMudar={setAssunto} opcoes={assuntos.map((a) => ({ valor: a.id, rotulo: a.nome }))} placeholder="Escolha o assunto" />
        <Button disabled={!assunto} carregando={pendente} onClick={() => iniciar(async () => {
          const r = await criarRevisaoAssunto(assunto);
          if (r.ok) { toast.success(`Revisão agendada para ${formatarData(r.dados.data)}`); router.refresh(); } else toast.error(r.erro);
        })}>Agendar</Button>
      </PopoverContent>
    </Popover>
  );
}
