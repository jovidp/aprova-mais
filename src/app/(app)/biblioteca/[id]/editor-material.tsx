"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Input, Textarea } from "@/components/ui/basicos";
import { Campo, Checkbox } from "@/components/ui/formulario";
import { atualizarMaterial } from "../acoes";

interface Dados {
  titulo: string;
  disciplina: string;
  aulaNumero: number | null;
  possivelmenteDesatualizado: boolean;
  observacao: string;
}

export function EditorMaterial({ id, inicial }: { id: string; inicial: Dados }) {
  const [dados, setDados] = useState(inicial);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <Card>
      <CardHeader><CardTitle>Editar material</CardTitle></CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            iniciar(async () => {
              const r = await atualizarMaterial({ materialId: id, ...dados });
              if (r.ok) { toast.success("Material atualizado"); router.refresh(); } else toast.error(r.erro);
            });
          }}
        >
          <Campo rotulo="Título" htmlFor="m-titulo">
            <Input id="m-titulo" value={dados.titulo} onChange={(e) => setDados({ ...dados, titulo: e.target.value })} />
          </Campo>
          <Campo rotulo="Disciplina" htmlFor="m-disc">
            <Input id="m-disc" value={dados.disciplina} onChange={(e) => setDados({ ...dados, disciplina: e.target.value })} />
          </Campo>
          <Campo rotulo="Aula" htmlFor="m-aula">
            <Input id="m-aula" type="number" min={0} max={999} value={dados.aulaNumero ?? ""} onChange={(e) => setDados({ ...dados, aulaNumero: e.target.value === "" ? null : Number(e.target.value) })} />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={dados.possivelmenteDesatualizado} onCheckedChange={(v) => setDados({ ...dados, possivelmenteDesatualizado: v === true })} />
            Sinalizar como possivelmente desatualizado
          </label>
          {dados.possivelmenteDesatualizado && (
            <Campo rotulo="Observação" htmlFor="m-obs" ajuda="Ex.: verificar EC posterior à data do material.">
              <Textarea id="m-obs" value={dados.observacao} onChange={(e) => setDados({ ...dados, observacao: e.target.value })} />
            </Campo>
          )}
          <Button type="submit" carregando={pendente}>Salvar</Button>
        </form>
      </CardContent>
    </Card>
  );
}
