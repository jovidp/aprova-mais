"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { NOMES_DIAS, horaParaMinutos, minutosParaHora } from "@/lib/estudo/tempo";

export interface Janela {
  diaSemana: number;
  inicioMin: number;
  fimMin: number;
}

interface Props {
  janelas: Janela[];
  aoMudar: (janelas: Janela[]) => void;
  diasDescanso: number[];
}

export function totalMinutosSemana(janelas: Janela[], diasDescanso: number[] = []) {
  return janelas.filter((j) => !diasDescanso.includes(j.diaSemana)).reduce((s, j) => s + Math.max(0, j.fimMin - j.inicioMin), 0);
}

export function janelasSobrepostas(janelas: Janela[]) {
  return janelas.some((a, i) => janelas.some((b, k) => k > i && a.diaSemana === b.diaSemana && a.inicioMin < b.fimMin && b.inicioMin < a.fimMin));
}

/** Editor de janelas semanais. Nenhum horário é presumido: o aluno informa os seus. */
export function EditorDisponibilidade({ janelas, aoMudar, diasDescanso }: Props) {
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const atualizar = (indice: number, campo: "inicioMin" | "fimMin", valor: string) => {
    const minutos = horaParaMinutos(valor);
    if (Number.isNaN(minutos)) return;
    aoMudar(janelas.map((j, i) => (i === indice ? { ...j, [campo]: minutos } : j)));
  };
  return (
    <div className="grid gap-3">
      {ordem.map((dia) => {
        const doDia = janelas.map((j, i) => ({ ...j, i })).filter((j) => j.diaSemana === dia);
        const descanso = diasDescanso.includes(dia);
        return (
          <div key={dia} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
            <div className="w-24 shrink-0 pt-2 text-sm font-medium">
              {NOMES_DIAS[dia]}
              {descanso && <span className="block text-xs font-normal text-muted-foreground">descanso</span>}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {doDia.length === 0 && <p className="pt-2 text-sm text-muted-foreground">Sem horário de estudo.</p>}
              {doDia.map((j) => (
                <div key={j.i} className="flex items-center gap-2">
                  <Input type="time" aria-label={`Início ${NOMES_DIAS[dia]}`} className="w-32" value={minutosParaHora(j.inicioMin)} onChange={(e) => atualizar(j.i, "inicioMin", e.target.value)} />
                  <span className="text-sm text-muted-foreground">às</span>
                  <Input type="time" aria-label={`Fim ${NOMES_DIAS[dia]}`} className="w-32" value={minutosParaHora(Math.min(j.fimMin, 1439))} onChange={(e) => atualizar(j.i, "fimMin", e.target.value)} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover horário" onClick={() => aoMudar(janelas.filter((_, i) => i !== j.i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => {
                const ultimo = doDia[doDia.length - 1];
                const inicio = ultimo ? Math.min(ultimo.fimMin + 30, 1380) : 19 * 60;
                aoMudar([...janelas, { diaSemana: dia, inicioMin: inicio, fimMin: Math.min(inicio + 120, 1440) }]);
              }}
            >
              <Plus /> Horário
            </Button>
          </div>
        );
      })}
    </div>
  );
}
