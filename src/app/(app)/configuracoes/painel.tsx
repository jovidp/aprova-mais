"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, LogOut, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui/basicos";
import { Campo, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { sair } from "@/app/(publico)/acoes-auth";
import { excluirConta, salvarPerfil, salvarPreferencias } from "./acoes";

interface Props {
  abaInicial: string;
  email: string;
  perfil: { nome: string; dataProva: string };
  preferencias: {
    fuso: string; intervalos: string; iaHabilitada: boolean; orcamentoIa: string; limiteQuestoesIa: string; gamificacao: boolean;
    notificacoes: { atividades: boolean; simulados: boolean; revisoes: boolean; metas: boolean; processamento: boolean };
  };
  ia: { configurada: boolean; provedor: string | null; modelo: string | null; gastoMesUsuarioUsd: number; gastoMesUsd: number; orcamentoMensalUsd: number; bloqueada: boolean };
}

const ROTULO_NOTIF = { atividades: "Atividades do cronograma", simulados: "Simulados agendados", revisoes: "Revisões vencidas", metas: "Metas", processamento: "Importações e IA" } as const;
const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PainelConfiguracoes({ abaInicial, email, perfil: p0, preferencias: pr0, ia }: Props) {
  const [perfil, setPerfil] = useState(p0);
  const [pref, setPref] = useState(pr0);
  const [confirmacao, setConfirmacao] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const salvarP = () => iniciar(async () => {
    const r = await salvarPerfil(perfil);
    if (r.ok) { toast.success("Perfil salvo"); router.refresh(); } else toast.error(r.erro);
  });
  const salvarPr = () => iniciar(async () => {
    const intervalos = pref.intervalos.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (intervalos.some((n) => !Number.isInteger(n) || n < 1)) { toast.error("Intervalos devem ser números inteiros de dias, separados por vírgula."); return; }
    const r = await salvarPreferencias({ ...pref, intervalos, orcamentoIa: Number(pref.orcamentoIa.replace(",", ".")) || 0, limiteQuestoesIa: Number(pref.limiteQuestoesIa) || 0 });
    if (r.ok) { toast.success("Preferências salvas"); router.refresh(); } else toast.error(r.erro);
  });

  return (
    <Tabs defaultValue={["perfil", "preferencias", "ia", "dados"].includes(abaInicial) ? abaInicial : "perfil"}>
      <TabsList>
        <TabsTrigger value="perfil">Perfil</TabsTrigger>
        <TabsTrigger value="preferencias">Preferências</TabsTrigger>
        <TabsTrigger value="ia">IA</TabsTrigger>
        <TabsTrigger value="dados">Dados e conta</TabsTrigger>
      </TabsList>

      <TabsContent value="perfil">
        <Card className="max-w-xl">
          <CardContent className="grid gap-4 pt-6">
            <Campo rotulo="E-mail"><Input value={email} disabled /></Campo>
            <Campo rotulo="Nome" htmlFor="nome"><Input id="nome" value={perfil.nome} maxLength={120} onChange={(e) => setPerfil({ ...perfil, nome: e.target.value })} /></Campo>
            <Campo rotulo="Data da prova" htmlFor="prova" ajuda="Usada na projeção e no cronograma."><Input id="prova" type="date" value={perfil.dataProva} onChange={(e) => setPerfil({ ...perfil, dataProva: e.target.value })} /></Campo>
            <div className="flex flex-wrap gap-2">
              <Button carregando={pendente} onClick={salvarP}>Salvar</Button>
              <Button asChild variant="outline"><Link href="/onboarding?refazer=1"><RotateCcw /> Refazer configuração inicial</Link></Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="preferencias">
        <Card className="max-w-xl">
          <CardContent className="grid gap-4 pt-6">
            <Campo rotulo="Fuso horário" htmlFor="fuso" ajuda="Ex.: America/Sao_Paulo, America/Manaus"><Input id="fuso" value={pref.fuso} onChange={(e) => setPref({ ...pref, fuso: e.target.value })} /></Campo>
            <Campo rotulo="Intervalos de revisão (dias)" htmlFor="int" ajuda="Separados por vírgula. Padrão: 1, 7, 15, 30"><Input id="int" value={pref.intervalos} onChange={(e) => setPref({ ...pref, intervalos: e.target.value })} /></Campo>
            <Label className="flex items-center gap-2 font-normal"><Switch checked={pref.gamificacao} onCheckedChange={(v) => setPref({ ...pref, gamificacao: v })} /> Mostrar sequência de dias de estudo</Label>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Notificações</legend>
              {(Object.keys(ROTULO_NOTIF) as (keyof typeof ROTULO_NOTIF)[]).map((k) => (
                <Label key={k} className="flex items-center gap-2 font-normal">
                  <Switch checked={pref.notificacoes[k]} onCheckedChange={(v) => setPref({ ...pref, notificacoes: { ...pref.notificacoes, [k]: v } })} /> {ROTULO_NOTIF[k]}
                </Label>
              ))}
            </fieldset>
            <Button className="w-fit" carregando={pendente} onClick={salvarPr}>Salvar preferências</Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ia">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Inteligência artificial</CardTitle>
            <CardDescription>{ia.configurada ? `Provedor: ${ia.provedor} · modelo ${ia.modelo}` : "Nenhum provedor configurado no servidor."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {ia.configurada && (
              <p className="text-sm">Gasto estimado neste mês: <strong>{usd(ia.gastoMesUsuarioUsd)}</strong> seu · {usd(ia.gastoMesUsd)} de {usd(ia.orcamentoMensalUsd)} da plataforma.</p>
            )}
            {ia.bloqueada && ia.configurada && <Aviso tipo="alerta">A IA está bloqueada (desativada ou orçamento atingido).</Aviso>}
            <Label className="flex items-center gap-2 font-normal"><Switch checked={pref.iaHabilitada} onCheckedChange={(v) => setPref({ ...pref, iaHabilitada: v })} /> Usar IA (geração de questões, tutor, análises)</Label>
            <Campo rotulo="Seu limite mensal (US$)" htmlFor="orc" ajuda="0 = sem limite pessoal (vale o limite da plataforma)."><Input id="orc" inputMode="decimal" value={pref.orcamentoIa} onChange={(e) => setPref({ ...pref, orcamentoIa: e.target.value.replace(/[^\d.,]/g, "") })} /></Campo>
            <Campo rotulo="Máximo de questões geradas por dia" htmlFor="lim"><Input id="lim" inputMode="numeric" value={pref.limiteQuestoesIa} onChange={(e) => setPref({ ...pref, limiteQuestoesIa: e.target.value.replace(/\D/g, "") })} /></Campo>
            <p className="text-xs text-muted-foreground">Custos são estimativas a partir dos tokens informados pelo provedor; o valor cobrado pode diferir.</p>
            <Button className="w-fit" carregando={pendente} onClick={salvarPr}>Salvar</Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="dados">
        <div className="grid max-w-xl gap-4">
          <Card>
            <CardHeader><CardTitle>Exportar dados</CardTitle><CardDescription>Arquivo JSON com seus registros (questões, respostas, simulados, cronograma, revisões, flashcards, anotações…).</CardDescription></CardHeader>
            <CardContent><Button asChild variant="outline"><a href="/api/exportar" download><Download /> Baixar meus dados</a></Button></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Sessão</CardTitle></CardHeader>
            <CardContent><form action={sair}><Button variant="outline" type="submit"><LogOut /> Sair</Button></form></CardContent>
          </Card>
          <Card className="border-destructive/40">
            <CardHeader><CardTitle className="text-destructive">Excluir conta</CardTitle><CardDescription>Apaga permanentemente sua conta, PDFs, questões, histórico e todos os demais dados. Não há como desfazer.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Input className="w-48" aria-label="Digite EXCLUIR" placeholder="Digite EXCLUIR" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
              <Button variant="destructive" disabled={confirmacao.trim().toUpperCase() !== "EXCLUIR" || pendente} onClick={() => iniciar(async () => {
                const r = await excluirConta(confirmacao);
                if (r && !r.ok) toast.error(r.erro);
              })}><Trash2 /> Excluir definitivamente</Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}
