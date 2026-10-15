"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookOpen, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Textarea } from "@/components/ui/basicos";
import { Campo, Select, Switch } from "@/components/ui/formulario";
import { Confirmar, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/sobreposicoes";
import type { OpcoesFiltro } from "@/lib/questoes/filtros";
import { formatarData } from "@/lib/utils";
import { criarFlashcard, editarFlashcard, excluirFlashcard } from "./acoes";

export interface CartaoLista {
  id: string; frente: string; verso: string; origem: string; proxima_em: string; repeticoes: number; lapsos: number; suspenso: boolean;
  pagina: number | null; material_id: string | null; disciplina: string | null; assunto: string | null;
}

const ROTULO_ORIGEM: Record<string, string> = { manual: "Manual", ia: "IA", trecho_pdf: "Trecho do PDF", questao: "Questão", erro: "Erro" };

export function GerenciarFlashcards({ cartoes, opcoes, iaDisponivel, filtro, hoje }: {
  cartoes: CartaoLista[]; opcoes: OpcoesFiltro; iaDisponivel: boolean; filtro: { disciplina: string; assunto: string }; hoje: string;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [novo, setNovo] = useState({ frente: "", verso: "", disciplinaId: filtro.disciplina, assuntoId: filtro.assunto });
  const [ia, setIa] = useState({ disciplinaId: filtro.disciplina, assuntoId: filtro.assunto, materialId: "", quantidade: 10 });
  const [edicao, setEdicao] = useState<CartaoLista | null>(null);
  const [aberto, setAberto] = useState<"novo" | "ia" | null>(null);
  const [pendente, iniciar] = useTransition();
  const assuntos = (d: string) => opcoes.assuntos.filter((a) => a.disciplina_id === d);
  const filtrar = (m: Partial<typeof filtro>) => {
    const p = new URLSearchParams({ ...filtro, ...m });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    router.push(`${caminho}?${p}`);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-56" aria-label="Disciplina" valor={filtro.disciplina} aoMudar={(v) => filtrar({ disciplina: v, assunto: "" })}
          opcoes={[{ valor: "", rotulo: "Todas as disciplinas" }, ...opcoes.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
        <Select className="w-56" aria-label="Assunto" valor={filtro.assunto} aoMudar={(v) => filtrar({ assunto: v })} desabilitado={!filtro.disciplina}
          opcoes={[{ valor: "", rotulo: "Todos os assuntos" }, ...assuntos(filtro.disciplina).map((a) => ({ valor: a.id, rotulo: a.nome }))]} />
        <div className="ml-auto flex gap-2">
          <Dialog open={aberto === "novo"} onOpenChange={(v) => setAberto(v ? "novo" : null)}>
            <DialogTrigger asChild><Button variant="outline"><Plus /> Novo cartão</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo flashcard</DialogTitle></DialogHeader>
              <Campo rotulo="Frente" htmlFor="fc-f"><Textarea id="fc-f" value={novo.frente} onChange={(e) => setNovo({ ...novo, frente: e.target.value })} /></Campo>
              <Campo rotulo="Verso" htmlFor="fc-v"><Textarea id="fc-v" rows={4} value={novo.verso} onChange={(e) => setNovo({ ...novo, verso: e.target.value })} /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Select aria-label="Disciplina" valor={novo.disciplinaId} aoMudar={(v) => setNovo({ ...novo, disciplinaId: v, assuntoId: "" })} opcoes={[{ valor: "", rotulo: "Disciplina" }, ...opcoes.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
                <Select aria-label="Assunto" valor={novo.assuntoId} aoMudar={(v) => setNovo({ ...novo, assuntoId: v })} opcoes={[{ valor: "", rotulo: "Assunto" }, ...assuntos(novo.disciplinaId).map((a) => ({ valor: a.id, rotulo: a.nome }))]} />
              </div>
              <DialogFooter>
                <Button carregando={pendente} onClick={() => iniciar(async () => {
                  const r = await criarFlashcard({ frente: novo.frente, verso: novo.verso, disciplinaId: novo.disciplinaId || null, assuntoId: novo.assuntoId || null });
                  if (r.ok) { toast.success("Cartão criado"); setNovo({ ...novo, frente: "", verso: "" }); setAberto(null); router.refresh(); } else toast.error(r.erro);
                })}>Criar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={aberto === "ia"} onOpenChange={(v) => setAberto(v ? "ia" : null)}>
            <DialogTrigger asChild><Button disabled={!iaDisponivel} title={iaDisponivel ? undefined : "IA indisponível"}><Sparkles /> Gerar com IA</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Gerar flashcards dos seus materiais</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <Select aria-label="Disciplina" valor={ia.disciplinaId} aoMudar={(v) => setIa({ ...ia, disciplinaId: v, assuntoId: "", materialId: "" })} opcoes={[{ valor: "", rotulo: "Disciplina" }, ...opcoes.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
                <Select aria-label="Assunto" valor={ia.assuntoId} aoMudar={(v) => setIa({ ...ia, assuntoId: v })} opcoes={[{ valor: "", rotulo: "Qualquer assunto" }, ...assuntos(ia.disciplinaId).map((a) => ({ valor: a.id, rotulo: a.nome }))]} />
                <Select aria-label="Material" valor={ia.materialId} aoMudar={(v) => setIa({ ...ia, materialId: v })} opcoes={[{ valor: "", rotulo: "Qualquer material" }, ...opcoes.materiais.filter((m) => !ia.disciplinaId || m.disciplina_id === ia.disciplinaId).map((m) => ({ valor: m.id, rotulo: m.titulo }))]} />
                <Select aria-label="Quantidade" valor={String(ia.quantidade)} aoMudar={(v) => setIa({ ...ia, quantidade: Number(v) })} opcoes={[5, 10, 15, 20].map((n) => ({ valor: String(n), rotulo: `${n} cartões` }))} />
              </div>
              <DialogFooter>
                <Button carregando={pendente} disabled={!ia.disciplinaId && !ia.materialId} onClick={() => iniciar(async () => {
                  const resp = await fetch("/api/flashcards/gerar", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ disciplinaId: ia.disciplinaId || null, assuntoId: ia.assuntoId || null, materialId: ia.materialId || null, quantidade: ia.quantidade }) });
                  const corpo = await resp.json().catch(() => ({}));
                  if (!resp.ok) return void toast.error(corpo.erro ?? "Falha ao gerar.");
                  toast.success(`${corpo.criados} cartão(ões) criado(s) de ${corpo.fonte.titulo}`);
                  setAberto(null);
                  router.refresh();
                })}><Sparkles /> Gerar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cartoes.map((c) => (
          <Card key={c.id} className={c.suspenso ? "opacity-60" : undefined}>
            <CardContent className="grid gap-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {c.assunto && <Badge variant="outline">{c.assunto}</Badge>}
                <Badge variant="secondary">{ROTULO_ORIGEM[c.origem] ?? c.origem}</Badge>
                {c.suspenso ? <Badge variant="outline">suspenso</Badge> : c.proxima_em <= hoje ? <Badge variant="warning">para hoje</Badge> : <span className="text-muted-foreground">próx. {formatarData(c.proxima_em)}</span>}
              </div>
              <p className="font-medium">{c.frente}</p>
              <p className="line-clamp-3 text-muted-foreground">{c.verso}</p>
              <div className="mt-1 flex items-center gap-1">
                {c.material_id && c.pagina && <Button size="icon-sm" variant="ghost" asChild aria-label="Abrir no PDF"><Link href={`/biblioteca/${c.material_id}/ler?pagina=${c.pagina}`}><BookOpen /></Link></Button>}
                <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEdicao(c)}><Pencil /></Button>
                <Confirmar titulo="Excluir flashcard?" descricao="O histórico de revisões deste cartão também será removido." confirmar="Excluir" destrutivo
                  aoConfirmar={async () => { const r = await excluirFlashcard(c.id); if (r.ok) router.refresh(); else toast.error(r.erro); }}>
                  <Button size="icon-sm" variant="ghost" aria-label="Excluir"><Trash2 /></Button>
                </Confirmar>
                <span className="ml-auto text-xs text-muted-foreground">{c.repeticoes} rev.</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(edicao)} onOpenChange={(v) => !v && setEdicao(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar flashcard</DialogTitle></DialogHeader>
          {edicao && (
            <>
              <Textarea aria-label="Frente" value={edicao.frente} onChange={(e) => setEdicao({ ...edicao, frente: e.target.value })} />
              <Textarea aria-label="Verso" rows={4} value={edicao.verso} onChange={(e) => setEdicao({ ...edicao, verso: e.target.value })} />
              <label className="flex items-center gap-2 text-sm"><Switch checked={edicao.suspenso} onCheckedChange={(v) => setEdicao({ ...edicao, suspenso: v })} /> Suspender revisões</label>
              <DialogFooter>
                <Button carregando={pendente} onClick={() => iniciar(async () => {
                  const r = await editarFlashcard({ id: edicao.id, frente: edicao.frente, verso: edicao.verso, suspenso: edicao.suspenso });
                  if (r.ok) { setEdicao(null); router.refresh(); } else toast.error(r.erro);
                })}>Salvar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
