"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Archive, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Textarea } from "@/components/ui/basicos";
import { Select } from "@/components/ui/formulario";
import { formatarData } from "@/lib/utils";
import { ROTULO_CAUSA, type CAUSAS } from "./rotulos";
import { atualizarErro } from "./acoes";

export interface LinhaCaderno {
  id: string; questaoId: string; enunciado: string; disciplina: string; assunto: string | null; assuntoId: string | null;
  totalErros: number; acertosSeguidos: number; causa: string; observacoes: string; status: string; primeira: string; ultima: string; letraErrada: string | null;
}

export function ItemCaderno({ linha }: { linha: LinhaCaderno }) {
  const [obs, setObs] = useState(linha.observacoes);
  const [causa, setCausa] = useState(linha.causa);
  const [editando, setEditando] = useState(false);
  const [pendente, iniciar] = useTransition();

  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline">{linha.disciplina}</Badge>
          {linha.assunto && <Badge variant="outline">{linha.assunto}</Badge>}
          <Badge variant="destructive">errou {linha.totalErros}×</Badge>
          {linha.acertosSeguidos > 0 && <Badge variant="success">{linha.acertosSeguidos} acerto(s) seguido(s)</Badge>}
          <span className="ml-auto text-muted-foreground">{formatarData(linha.primeira)} → {formatarData(linha.ultima)}</span>
        </div>
        <p className="line-clamp-3 text-sm">{linha.enunciado}</p>
        {linha.letraErrada && <p className="text-xs text-muted-foreground">Última resposta errada: {linha.letraErrada}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-8 w-56" aria-label="Causa do erro" valor={causa}
            aoMudar={(v) => { setCausa(v); iniciar(async () => { const r = await atualizarErro({ id: linha.id, causa: v as (typeof CAUSAS)[number] }); if (!r.ok) toast.error(r.erro); }); }}
            opcoes={Object.entries(ROTULO_CAUSA).map(([v, r]) => ({ valor: v, rotulo: r }))} />
          <Button size="sm" variant="ghost" onClick={() => setEditando(!editando)}>{obs ? "Ver observação" : "Anotar"}</Button>
          <Button size="sm" variant="outline" asChild><Link href={`/questoes/${linha.questaoId}`}><ExternalLink /> Refazer e ver histórico</Link></Button>
          {linha.status === "ativo" && (
            <Button size="sm" variant="ghost" disabled={pendente} onClick={() => iniciar(async () => {
              const r = await atualizarErro({ id: linha.id, status: "arquivado" });
              if (r.ok) toast.success("Arquivado"); else toast.error(r.erro);
            })}><Archive /> Arquivar</Button>
          )}
        </div>
        {editando && (
          <div className="grid gap-2">
            <Textarea aria-label="Observações" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="O que levou ao erro? O que lembrar na próxima vez?" />
            <Button size="sm" className="justify-self-start" disabled={pendente}
              onClick={() => iniciar(async () => { const r = await atualizarErro({ id: linha.id, observacoes: obs }); if (r.ok) { toast.success("Observação salva"); setEditando(false); } else toast.error(r.erro); })}>
              Salvar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
