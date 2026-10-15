"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Select } from "@/components/ui/formulario";
import { gerarRelatorio } from "./acoes";

const OPCOES = [
  { valor: "semanal-atual", rotulo: "Semana atual" },
  { valor: "semanal-anterior", rotulo: "Semana passada" },
  { valor: "mensal-atual", rotulo: "Mês atual" },
  { valor: "mensal-anterior", rotulo: "Mês passado" },
  { valor: "personalizado", rotulo: "Período personalizado" },
];

export function GeradorRelatorio() {
  const [opcao, setOpcao] = useState("semanal-atual");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const gerar = () => iniciar(async () => {
    const [periodo, referencia] = opcao.split("-") as ["semanal" | "mensal", "atual" | "anterior"];
    const r = await gerarRelatorio(opcao === "personalizado" ? { periodo: "personalizado", inicio, fim } : { periodo, referencia });
    if (r.ok) router.push(`/relatorios/${r.dados.id}`);
    else toast.error(r.erro);
  });

  return (
    <div className="grid gap-4">
      <Select aria-label="Período" valor={opcao} aoMudar={setOpcao} opcoes={OPCOES} />
      {opcao === "personalizado" && (
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" aria-label="Início" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          <Input type="date" aria-label="Fim" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
      )}
      <Button carregando={pendente} disabled={opcao === "personalizado" && (!inicio || !fim)} onClick={gerar}>Gerar relatório</Button>
    </div>
  );
}
