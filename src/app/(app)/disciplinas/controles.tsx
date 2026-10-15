"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Select, Switch } from "@/components/ui/formulario";
import { adicionarAssunto, adicionarDisciplina, renomearAssunto, salvarConfigDisciplina } from "./acoes";

const ESCALA = [1, 2, 3, 4, 5].map((n) => ({ valor: String(n), rotulo: String(n) }));

export function AdicionarDisciplina() {
  const [nome, setNome] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); iniciar(async () => {
      const r = await adicionarDisciplina(nome);
      if (r.ok) { setNome(""); toast.success("Disciplina adicionada"); router.refresh(); } else toast.error(r.erro);
    }); }}>
      <Input aria-label="Nova disciplina" placeholder="Nova disciplina" value={nome} onChange={(e) => setNome(e.target.value)} className="w-56" />
      <Button type="submit" carregando={pendente} disabled={nome.trim().length < 2}><Plus /> Adicionar</Button>
    </form>
  );
}

export function ConfigDisciplina({ disciplinaId, inicial }: { disciplinaId: string; inicial: { peso: number; dificuldade: number; prioridade: number; ativa: boolean } }) {
  const [c, setC] = useState({ ...inicial, peso: String(inicial.peso) });
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const alterado = c.peso !== String(inicial.peso) || c.dificuldade !== inicial.dificuldade || c.prioridade !== inicial.prioridade || c.ativa !== inicial.ativa;
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="grid gap-1 text-xs">Peso<Input className="w-20" inputMode="decimal" value={c.peso} onChange={(e) => setC({ ...c, peso: e.target.value.replace(/[^\d.,]/g, "") })} /></label>
      <label className="grid gap-1 text-xs">Prioridade (1–5)<Select className="w-24" aria-label="Prioridade" valor={String(c.prioridade)} aoMudar={(v) => setC({ ...c, prioridade: Number(v) })} opcoes={ESCALA} /></label>
      <label className="grid gap-1 text-xs">Dificuldade (1–5)<Select className="w-24" aria-label="Dificuldade" valor={String(c.dificuldade)} aoMudar={(v) => setC({ ...c, dificuldade: Number(v) })} opcoes={ESCALA} /></label>
      <label className="flex items-center gap-2 pb-2 text-xs"><Switch checked={c.ativa} onCheckedChange={(v) => setC({ ...c, ativa: v })} /> Estudando</label>
      {alterado && (
        <Button size="sm" carregando={pendente} onClick={() => iniciar(async () => {
          const r = await salvarConfigDisciplina({ disciplinaId, peso: Number(c.peso.replace(",", ".")), dificuldade: c.dificuldade, prioridade: c.prioridade, ativa: c.ativa });
          if (r.ok) { toast.success("Disciplina atualizada. Regere o cronograma para aplicar."); router.refresh(); } else toast.error(r.erro);
        })}>Salvar</Button>
      )}
    </div>
  );
}

export function ListaAssuntos({ disciplinaId, assuntos }: { disciplinaId: string; assuntos: { id: string; nome: string; proprio: boolean }[] }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [novo, setNovo] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted-foreground">Assuntos ({assuntos.length})</summary>
      <ul className="mt-2 grid gap-1 text-sm">
        {assuntos.map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted">
            {editando === a.id ? (
              <>
                <Input className="h-8" aria-label="Nome do assunto" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
                <Button size="icon-sm" aria-label="Salvar" disabled={pendente} onClick={() => iniciar(async () => {
                  const r = await renomearAssunto(a.id, texto);
                  if (r.ok) { setEditando(null); router.refresh(); } else toast.error(r.erro);
                })}><Check /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditando(null)}><X /></Button>
              </>
            ) : (
              <>
                <span className="flex-1">{a.nome}</span>
                {a.proprio && <Button size="icon-sm" variant="ghost" aria-label={`Renomear ${a.nome}`} onClick={() => { setEditando(a.id); setTexto(a.nome); }}><Pencil /></Button>}
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); iniciar(async () => {
        const r = await adicionarAssunto(disciplinaId, novo);
        if (r.ok) { setNovo(""); router.refresh(); } else toast.error(r.erro);
      }); }}>
        <Input className="h-8" aria-label="Novo assunto" placeholder="Novo assunto" value={novo} onChange={(e) => setNovo(e.target.value)} />
        <Button size="sm" variant="outline" type="submit" disabled={pendente || novo.trim().length < 2}><Plus /> Assunto</Button>
      </form>
    </details>
  );
}
