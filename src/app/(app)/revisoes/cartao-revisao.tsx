"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BookOpen, PauseCircle, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent } from "@/components/ui/basicos";
import { ROTULO_AVALIACAO, type Avaliacao } from "@/lib/estudo/srs";
import { formatarData } from "@/lib/utils";
import { alterarStatusRevisao, avaliarRevisao } from "./acoes";

export interface RevisaoExibicao {
  id: string; alvo_tipo: string; titulo: string; assunto_id: string | null; questao_id: string | null; secao_id: string | null;
  intervalo_dias: number; repeticoes: number; lapsos: number; proxima_em: string; ultima_em: string | null; origem: string;
  disciplina?: string | null;
}

const CORES: Record<Avaliacao, "destructive" | "outline" | "secondary" | "success"> = { nao_lembrei: "destructive", dificil: "outline", bom: "secondary", facil: "success" };

export function CartaoRevisao({ revisao: r, hoje, secoes, erros }: {
  revisao: RevisaoExibicao; hoje: string; erros: number;
  secoes: { material_id: string; titulo: string; pagina_inicio: number; pagina_fim: number }[];
}) {
  const [feita, setFeita] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const atrasada = r.proxima_em < hoje;

  if (feita) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">✓ {r.titulo}: próxima revisão em {formatarData(feita)}.</CardContent></Card>;
  }
  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{r.titulo}</span>
          {r.disciplina && <Badge variant="outline">{r.disciplina}</Badge>}
          {atrasada && <Badge variant="warning">atrasada desde {formatarData(r.proxima_em)}</Badge>}
          <Badge variant="secondary">{r.repeticoes} revisão(ões){r.lapsos ? ` · ${r.lapsos} esquecimento(s)` : ""}</Badge>
        </div>
        {(secoes.length > 0 || erros > 0 || r.assunto_id) && (
          <div className="flex flex-wrap gap-2 text-sm">
            {secoes.map((s) => (
              <Button key={`${s.material_id}-${s.pagina_inicio}`} size="sm" variant="outline" asChild>
                <Link href={`/biblioteca/${s.material_id}/ler?pagina=${s.pagina_inicio}`}><BookOpen /> {s.titulo.slice(0, 40)} (p. {s.pagina_inicio}–{s.pagina_fim})</Link>
              </Button>
            ))}
            {r.assunto_id && <Button size="sm" variant="outline" asChild><Link href={`/resolver?assunto=${r.assunto_id}`}><PenLine /> Questões{erros ? ` · ${erros} erro(s) no caderno` : ""}</Link></Button>}
            {r.questao_id && <Button size="sm" variant="outline" asChild><Link href={`/questoes/${r.questao_id}`}><PenLine /> Refazer questão</Link></Button>}
          </div>
        )}
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Depois de revisar, como foi lembrar deste conteúdo?</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ROTULO_AVALIACAO) as Avaliacao[]).map((a) => (
              <Button key={a} size="sm" variant={CORES[a] === "destructive" ? "destructive" : CORES[a] === "success" ? "success" : "outline"} disabled={pendente}
                onClick={() => iniciar(async () => {
                  const res = await avaliarRevisao({ id: r.id, avaliacao: a });
                  if (res.ok) setFeita(res.dados.proximaEm); else toast.error(res.erro);
                })}>{ROTULO_AVALIACAO[a]}</Button>
            ))}
            <Button size="sm" variant="ghost" disabled={pendente} onClick={() => iniciar(async () => {
              const res = await alterarStatusRevisao(r.id, "suspensa");
              if (res.ok) toast.success("Revisão suspensa"); else toast.error(res.erro);
            })}><PauseCircle /> Suspender</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
