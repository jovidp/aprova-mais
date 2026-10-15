"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BookOpen, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/basicos";
import { cn, ROTULO_DIFICULDADE } from "@/lib/utils";
import { rotuloOrigem, type CorrecaoExibicao, type QuestaoExibicao } from "@/lib/questoes/exibicao";

export type { AlternativaExibicao, QuestaoExibicao, FonteCorrecao, CorrecaoExibicao } from "@/lib/questoes/exibicao";

interface Props {
  questao: QuestaoExibicao;
  numero?: number;
  total?: number;
  selecionada: string | null;
  aoSelecionar?: (alternativaId: string) => void;
  correcao?: CorrecaoExibicao | null;
  /** Atalhos de teclado (letras) para selecionar. */
  atalhos?: boolean;
  bloqueada?: boolean;
}

export function CartaoQuestao({ questao, numero, total, selecionada, aoSelecionar, correcao, atalhos = false, bloqueada = false }: Props) {
  const corrigida = Boolean(correcao);

  useEffect(() => {
    if (!atalhos || corrigida || bloqueada || !aoSelecionar) return;
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(alvo.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const alt = questao.alternativas.find((a) => a.letra.toLowerCase() === e.key.toLowerCase());
      if (alt) {
        e.preventDefault();
        aoSelecionar(alt.id);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [atalhos, corrigida, bloqueada, aoSelecionar, questao.alternativas]);

  return (
    <article className="grid gap-5" aria-label={numero ? `Questão ${numero}` : "Questão"}>
      <header className="flex flex-wrap items-center gap-1.5 text-xs">
        {numero !== undefined && <span className="mr-1 text-sm font-semibold">Questão {numero}{total ? ` de ${total}` : ""}</span>}
        {questao.disciplina && <Badge variant="outline">{questao.disciplina}</Badge>}
        {questao.assunto && <Badge variant="outline">{questao.assunto}</Badge>}
        <Badge variant="secondary">{ROTULO_DIFICULDADE[questao.dificuldade] ?? questao.dificuldade}</Badge>
        <Badge variant={questao.origem === "importada_licenciada" ? "info" : "outline"}>{rotuloOrigem(questao)}</Badge>
        {questao.possivelmente_desatualizada && <Badge variant="warning">Confira legislação atual</Badge>}
      </header>

      {questao.texto_apoio && (
        <div className="texto-estudo rounded-lg border bg-muted/40 p-4 text-sm">{questao.texto_apoio}</div>
      )}
      <p className="texto-estudo text-base">{questao.enunciado}</p>

      <div role="radiogroup" aria-label="Alternativas" className="grid gap-2">
        {questao.alternativas.map((a) => {
          const marcada = selecionada === a.id;
          const correta = correcao?.alternativa_correta_id === a.id;
          const errada = corrigida && marcada && !correta;
          const justificativa = correcao?.justificativas?.[a.id];
          return (
            <div key={a.id}>
              <button
                type="button"
                role="radio"
                aria-checked={marcada}
                disabled={corrigida || bloqueada || !aoSelecionar}
                onClick={() => aoSelecionar?.(a.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-default",
                  !corrigida && marcada && "border-primary bg-primary/5 ring-1 ring-primary",
                  !corrigida && !marcada && "hover:bg-accent",
                  correta && "border-success bg-success/10",
                  errada && "border-destructive bg-destructive/10",
                )}
              >
                <span className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  marcada && !corrigida && "border-primary bg-primary text-primary-foreground",
                  correta && "border-success bg-success text-success-foreground",
                  errada && "border-destructive bg-destructive text-destructive-foreground",
                )}>
                  {correta ? <Check className="size-4" /> : errada ? <X className="size-4" /> : a.letra}
                </span>
                <span className="texto-estudo flex-1 pt-0.5">{questao.tipo === "certo_errado" ? (a.letra === "C" ? "Certo" : "Errado") : a.texto}</span>
              </button>
              {corrigida && justificativa && (marcada || correta) && (
                <p className={cn("mt-1 ml-10 text-xs", correta ? "text-success" : "text-destructive")}>{justificativa}</p>
              )}
            </div>
          );
        })}
      </div>

      {correcao && (
        <section className="rounded-lg border bg-card p-4" aria-label="Comentário da questão">
          <p className="mb-2 font-medium">
            {selecionada === null ? "Questão em branco." : selecionada === correcao.alternativa_correta_id ? "Você acertou!" : "Você errou."}{" "}
            <span className="font-normal text-muted-foreground">
              Gabarito: {questao.alternativas.find((a) => a.id === correcao.alternativa_correta_id)?.letra}
            </span>
          </p>
          <div className="texto-estudo text-sm">{correcao.explicacao}</div>
          {Object.keys(correcao.justificativas ?? {}).length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Justificativa de todas as alternativas</summary>
              <ul className="mt-2 grid gap-1">
                {questao.alternativas.map((a) => correcao.justificativas[a.id] && (
                  <li key={a.id}><strong>{a.letra})</strong> {correcao.justificativas[a.id]}</li>
                ))}
              </ul>
            </details>
          )}
          {correcao.fontes?.length > 0 && (
            <div className="mt-3 grid gap-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Material de referência</p>
              {correcao.fontes.map((f, i) => (
                <div key={i} className="text-sm">
                  {f.material_id && f.pagina ? (
                    <Link
                      href={`/biblioteca/${f.material_id}/ler?pagina=${f.pagina}${f.trecho ? `&destaque=${encodeURIComponent(f.trecho.split(/\s+/).slice(0, 6).join(" "))}` : ""}`}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <BookOpen className="size-3.5" /> {f.material_titulo ?? "Material"}, p. {f.pagina}
                    </Link>
                  ) : (
                    <span className="font-medium">{f.descricao ?? "Fonte"}</span>
                  )}
                  {f.trecho && <p className="mt-0.5 border-l-2 pl-2 text-xs text-muted-foreground">“{f.trecho}”</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </article>
  );
}
