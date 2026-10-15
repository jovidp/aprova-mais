"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Confirmar, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/sobreposicoes";
import { arquivarSimulado, iniciarTentativa, renomearSimulado } from "../acoes";

export function AcoesSimulado({ id, nome, tentativaAtiva, jaFeito }: { id: string; nome: string; tentativaAtiva: string | null; jaFeito: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [novoNome, setNovoNome] = useState(nome);
  const [renomeando, setRenomeando] = useState(false);

  const comecar = () => iniciar(async () => {
    const r = await iniciarTentativa(id);
    if (r.ok) router.push(`/simulados/prova/${r.dados.tentativaId}`);
    else toast.error(r.erro);
  });

  return (
    <>
      <Dialog open={renomeando} onOpenChange={setRenomeando}>
        <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Renomear"><Pencil /></Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Renomear simulado</DialogTitle></DialogHeader>
          <Input aria-label="Nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
          <DialogFooter>
            <Button onClick={async () => { const r = await renomearSimulado(id, novoNome); if (r.ok) { setRenomeando(false); router.refresh(); } else toast.error(r.erro); }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirmar titulo="Arquivar simulado?" descricao="Ele sai da lista. Resultados e correções continuam preservados no histórico de desempenho." confirmar="Arquivar"
        aoConfirmar={async () => { const r = await arquivarSimulado(id); if (r.ok) router.push("/simulados"); else toast.error(r.erro); }}>
        <Button variant="ghost" size="icon" aria-label="Arquivar"><Archive /></Button>
      </Confirmar>
      {tentativaAtiva ? (
        <Button onClick={() => router.push(`/simulados/prova/${tentativaAtiva}`)}><Play /> Continuar prova</Button>
      ) : (
        <Button onClick={comecar} carregando={pendente}>{jaFeito ? <RotateCcw /> : <Play />} {jaFeito ? "Refazer" : "Iniciar prova"}</Button>
      )}
    </>
  );
}
