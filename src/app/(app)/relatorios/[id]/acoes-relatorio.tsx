"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirmar } from "@/components/ui/sobreposicoes";
import { analisarRelatorioComIA, excluirRelatorio } from "../acoes";

export function AcoesRelatorio({ id, temAnalise, iaDisponivel }: { id: string; temAnalise: boolean; iaDisponivel: boolean }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <div className="nao-imprimir flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => window.print()}><Printer /> Exportar PDF</Button>
      {iaDisponivel && (
        <Button variant="outline" carregando={pendente} onClick={() => iniciar(async () => {
          const r = await analisarRelatorioComIA(id);
          if (r.ok) { toast.success("Análise gerada"); router.refresh(); } else toast.error(r.erro);
        })}><Sparkles /> {temAnalise ? "Refazer análise com IA" : "Analisar com IA"}</Button>
      )}
      <Confirmar titulo="Excluir relatório?" descricao="Os dados de origem não são afetados; apenas este relatório salvo será removido." confirmar="Excluir" destrutivo
        aoConfirmar={() => iniciar(async () => {
          const r = await excluirRelatorio(id);
          if (r.ok) router.push("/relatorios"); else toast.error(r.erro);
        })}>
        <Button variant="ghost" size="icon" aria-label="Excluir relatório"><Trash2 /></Button>
      </Confirmar>
    </div>
  );
}
