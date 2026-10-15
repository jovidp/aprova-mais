"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/basicos";
import { Select } from "@/components/ui/formulario";
import { atualizarSecao } from "../acoes";

export interface SecaoEditavel {
  id: string;
  ordem: number;
  titulo: string;
  pagina_inicio: number;
  pagina_fim: number;
  tipo: string;
  banca: string | null;
  confianca: number | null;
  classificacao_origem: string;
  revisado_manualmente: boolean;
  assunto: string;
  subassunto: string;
}

export const ROTULO_TIPO_SECAO: Record<string, string> = {
  apresentacao: "Apresentação", teoria: "Teoria", questoes_comentadas: "Questões comentadas",
  lista_questoes: "Lista de questões", gabarito: "Gabarito", resumo: "Resumo", outro: "Outro",
};

function LinhaSecao({ materialId, secao, assuntos, totalPaginas }: { materialId: string; secao: SecaoEditavel; assuntos: string[]; totalPaginas: number }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState({ assunto: secao.assunto, subassunto: secao.subassunto, tipo: secao.tipo, paginaInicio: secao.pagina_inicio, paginaFim: secao.pagina_fim });
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const baixaConfianca = !secao.revisado_manualmente && (secao.confianca ?? 0) < 0.7;

  if (!editando) {
    return (
      <tr>
        <td className="text-muted-foreground tabular-nums">
          <Link href={`/biblioteca/${materialId}/ler?pagina=${secao.pagina_inicio}`} className="hover:text-primary hover:underline">
            {secao.pagina_inicio}–{secao.pagina_fim}
          </Link>
        </td>
        <td>
          <div className="font-medium">{secao.titulo}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <Badge variant={secao.tipo === "teoria" ? "info" : "outline"}>{ROTULO_TIPO_SECAO[secao.tipo] ?? secao.tipo}</Badge>
            {secao.banca && <Badge variant="outline">{secao.banca}</Badge>}
            {secao.revisado_manualmente && <Badge variant="success">Revisado</Badge>}
            {baixaConfianca && <Badge variant="warning">Confira</Badge>}
          </div>
        </td>
        <td>{secao.assunto || <span className="text-muted-foreground">—</span>}{secao.subassunto && <div className="text-xs text-muted-foreground">{secao.subassunto}</div>}</td>
        <td className="text-right">
          <Button variant="ghost" size="icon-sm" aria-label={`Editar classificação de ${secao.titulo}`} onClick={() => setEditando(true)}><Pencil /></Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-muted/30">
      <td>
        <div className="flex items-center gap-1">
          <Input type="number" aria-label="Página inicial" className="h-8 w-16" min={1} max={totalPaginas} value={valor.paginaInicio} onChange={(e) => setValor({ ...valor, paginaInicio: Number(e.target.value) })} />
          <Input type="number" aria-label="Página final" className="h-8 w-16" min={1} max={totalPaginas} value={valor.paginaFim} onChange={(e) => setValor({ ...valor, paginaFim: Number(e.target.value) })} />
        </div>
      </td>
      <td>
        <div className="mb-1 text-sm font-medium">{secao.titulo}</div>
        <Select aria-label="Tipo da seção" valor={valor.tipo} aoMudar={(v) => setValor({ ...valor, tipo: v })} className="h-8"
          opcoes={Object.entries(ROTULO_TIPO_SECAO).map(([v, r]) => ({ valor: v, rotulo: r }))} />
      </td>
      <td>
        <Input list={`assuntos-${materialId}`} aria-label="Assunto" className="mb-1 h-8" placeholder="Assunto" value={valor.assunto} onChange={(e) => setValor({ ...valor, assunto: e.target.value })} />
        <Input aria-label="Subassunto" className="h-8" placeholder="Subassunto (opcional)" value={valor.subassunto} onChange={(e) => setValor({ ...valor, subassunto: e.target.value })} />
      </td>
      <td className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="icon-sm" aria-label="Salvar" carregando={pendente}
            onClick={() => iniciar(async () => {
              const r = await atualizarSecao({ secaoId: secao.id, ...valor });
              if (r.ok) { toast.success("Classificação salva"); setEditando(false); router.refresh(); } else toast.error(r.erro);
            })}>
            {!pendente && <Check />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setEditando(false)}><X /></Button>
        </div>
        <datalist id={`assuntos-${materialId}`}>{assuntos.map((a) => <option key={a} value={a} />)}</datalist>
      </td>
    </tr>
  );
}

export function TabelaSecoes({ materialId, secoes, assuntos, totalPaginas }: { materialId: string; secoes: SecaoEditavel[]; assuntos: string[]; totalPaginas: number }) {
  if (secoes.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma seção identificada.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm [&_td]:px-2 [&_td]:py-2 [&_td]:align-top [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_tr]:border-b">
        <thead><tr><th>Páginas</th><th>Seção</th><th>Assunto</th><th /></tr></thead>
        <tbody>
          {secoes.map((s) => <LinhaSecao key={s.id} materialId={materialId} secao={s} assuntos={assuntos} totalPaginas={totalPaginas} />)}
        </tbody>
      </table>
    </div>
  );
}
