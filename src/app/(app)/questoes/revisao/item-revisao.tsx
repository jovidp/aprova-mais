"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Textarea } from "@/components/ui/basicos";
import { Aviso } from "@/components/ui/layout";
import { CartaoQuestao } from "@/components/questoes/cartao-questao";
import type { CorrecaoExibicao, QuestaoExibicao } from "@/lib/questoes/exibicao";
import { definirStatusQuestao } from "../acoes";

const ROTULO_VERIFICADOR: Record<string, string> = {
  estrutural: "Estrutura", referencia: "Referência", duplicidade: "Duplicidade", ia: "Revisor independente", humano: "Revisão humana",
};

export function ItemRevisao({ questao, correcao, problemas }: {
  questao: QuestaoExibicao;
  correcao: CorrecaoExibicao | null;
  problemas: { verificador: string; mensagem: string }[];
}) {
  const [motivo, setMotivo] = useState("");
  const [rejeitando, setRejeitando] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const decidir = (status: "aprovada" | "rejeitada" | "arquivada") =>
    iniciar(async () => {
      const r = await definirStatusQuestao(questao.id, status, status === "rejeitada" ? motivo : undefined);
      if (r.ok) {
        toast.success(status === "aprovada" ? "Questão aprovada e disponível" : status === "rejeitada" ? "Questão rejeitada" : "Questão arquivada");
        router.refresh();
      } else toast.error(r.erro);
    });

  return (
    <Card>
      <CardContent className="grid gap-4 p-5">
        {problemas.length > 0 && (
          <Aviso tipo="alerta" titulo="Pontos a conferir">
            <ul className="grid gap-1">
              {problemas.map((p, i) => <li key={i}><strong>{ROTULO_VERIFICADOR[p.verificador] ?? p.verificador}:</strong> {p.mensagem}</li>)}
            </ul>
          </Aviso>
        )}
        <CartaoQuestao questao={questao} selecionada={correcao?.alternativa_correta_id ?? null} correcao={correcao} />
        {rejeitando && (
          <Textarea aria-label="Motivo da rejeição" placeholder="Motivo da rejeição (ex.: gabarito incorreto, informação fora do material)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        )}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="success" onClick={() => decidir("aprovada")} disabled={pendente}><Check /> Aprovar</Button>
          {!rejeitando ? (
            <Button variant="outline" onClick={() => setRejeitando(true)} disabled={pendente}><X /> Rejeitar</Button>
          ) : (
            <Button variant="destructive" onClick={() => decidir("rejeitada")} disabled={pendente || motivo.trim().length < 3}><X /> Confirmar rejeição</Button>
          )}
          <Button variant="outline" asChild><Link href={`/questoes/${questao.id}/editar`}><Pencil /> Corrigir</Link></Button>
          <Button variant="ghost" onClick={() => decidir("arquivada")} disabled={pendente}><Archive /> Arquivar</Button>
        </div>
      </CardContent>
    </Card>
  );
}
