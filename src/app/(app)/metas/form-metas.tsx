"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/basicos";
import { Select } from "@/components/ui/formulario";
import { desativarMeta, salvarMeta } from "./acoes";

export function FormMetas({ disciplinas, metas }: { disciplinas: { id: string; nome: string }[]; metas: { id: string; rotulo: string }[] }) {
  const [m, setM] = useState({ periodo: "diaria" as "diaria" | "semanal" | "mensal", tipo: "questoes", alvo: "30", disciplina: "" });
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <div className="grid gap-3 border-t pt-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_1fr_auto]">
        <Select aria-label="Período" valor={m.periodo} aoMudar={(v) => setM({ ...m, periodo: v as typeof m.periodo })} opcoes={[{ valor: "diaria", rotulo: "Diária" }, { valor: "semanal", rotulo: "Semanal" }, { valor: "mensal", rotulo: "Mensal" }]} />
        <Select aria-label="Tipo" valor={m.tipo} aoMudar={(v) => setM({ ...m, tipo: v })}
          opcoes={[["questoes", "Questões"], ["horas", "Horas"], ["simulados", "Simulados"], ["revisoes", "Revisões"], ["paginas", "Páginas"], ["flashcards", "Flashcards"]].map(([v, r]) => ({ valor: v, rotulo: r }))} />
        <Input aria-label="Alvo" inputMode="decimal" value={m.alvo} onChange={(e) => setM({ ...m, alvo: e.target.value.replace(/[^\d.,]/g, "") })} />
        <Select aria-label="Disciplina" valor={m.disciplina} aoMudar={(v) => setM({ ...m, disciplina: v })} desabilitado={m.tipo !== "questoes"}
          opcoes={[{ valor: "", rotulo: "Todas" }, ...disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
        <Button carregando={pendente} onClick={() => iniciar(async () => {
          const r = await salvarMeta({ periodo: m.periodo, tipo: m.tipo, alvo: Number(m.alvo.replace(",", ".")), disciplinaId: m.tipo === "questoes" && m.disciplina ? m.disciplina : null });
          if (r.ok) { toast.success("Meta salva"); router.refresh(); } else toast.error(r.erro);
        })}><Plus /> Definir</Button>
      </div>
      {metas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {metas.map((x) => (
            <Badge key={x.id} variant="outline" className="gap-1">{x.rotulo}
              <button aria-label={`Remover meta ${x.rotulo}`} onClick={() => iniciar(async () => { const r = await desativarMeta(x.id); if (r.ok) router.refresh(); else toast.error(r.erro); })}><X className="size-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
