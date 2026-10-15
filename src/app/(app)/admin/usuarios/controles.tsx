"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Undo2, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/basicos";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/sobreposicoes";
import { Checkbox } from "@/components/ui/formulario";
import { bloquearIp, desbanirUsuario, desbloquearEmail, desbloquearIp, punirUsuario } from "./acoes";

export function AcoesUsuario({ userId, email, banido, ips }: { userId: string; email: string; banido: boolean; ips: string[] }) {
  const [aberto, setAberto] = useState(false);
  const [acao, setAcao] = useState<"banir" | "excluir">("excluir");
  const [bloquearIps, setBloquearIps] = useState(true);
  const [bloquearEmail, setBloquearEmail] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const abrir = (a: "banir" | "excluir") => { setAcao(a); setConfirmacao(""); setAberto(true); };
  const executar = () => iniciar(async () => {
    const r = await punirUsuario({ userId, acao, bloquearIps, bloquearEmail, motivo });
    if (!r.ok) { toast.error(r.erro); return; }
    const { ipsBloqueados, ipsIgnorados } = r.dados;
    toast.success(`${acao === "excluir" ? "Usuário excluído" : "Usuário banido"}${ipsBloqueados.length ? ` · ${ipsBloqueados.length} IP(s) bloqueado(s)` : ""}`);
    if (ipsIgnorados.length) toast.warning(`IP(s) não bloqueado(s) por também serem de administrador: ${ipsIgnorados.join(", ")}`);
    setAberto(false);
    router.refresh();
  });

  return (
    <div className="flex justify-end gap-1">
      {banido
        ? <Button size="sm" variant="outline" disabled={pendente} onClick={() => iniciar(async () => { const r = await desbanirUsuario(userId); if (r.ok) router.refresh(); else toast.error(r.erro); })}><Undo2 /> Desbanir</Button>
        : <Button size="sm" variant="outline" onClick={() => abrir("banir")}><Ban /> Banir</Button>}
      <Button size="sm" variant="destructive" onClick={() => abrir("excluir")}><UserX /> Excluir</Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{acao === "excluir" ? "Excluir usuário" : "Banir usuário"}</DialogTitle>
            <DialogDescription>
              {email}. {acao === "excluir"
                ? "A conta, os PDFs e todos os dados serão apagados permanentemente."
                : "A conta continua existindo, mas o login fica bloqueado para sempre e as sessões abertas são encerradas."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <Label className="flex items-start gap-2 font-normal">
              <Checkbox checked={bloquearIps} onCheckedChange={(v) => setBloquearIps(v === true)} />
              <span>Bloquear para sempre os IPs usados por ele ({ips.length ? ips.join(", ") : "nenhum registrado ainda"})</span>
            </Label>
            <Label className="flex items-start gap-2 font-normal">
              <Checkbox checked={bloquearEmail} onCheckedChange={(v) => setBloquearEmail(v === true)} />
              <span>Impedir que este e-mail crie conta de novo</span>
            </Label>
            <Textarea rows={2} aria-label="Motivo" placeholder="Motivo (opcional, só para seu controle)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
            {acao === "excluir" && (
              <Input aria-label="Confirmação" placeholder="Digite EXCLUIR para confirmar" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button variant="destructive" carregando={pendente} disabled={acao === "excluir" && confirmacao.trim().toUpperCase() !== "EXCLUIR"} onClick={executar}>
              {acao === "excluir" ? "Excluir definitivamente" : "Banir para sempre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function BloquearIpManual() {
  const [ip, setIp] = useState("");
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); iniciar(async () => {
      const r = await bloquearIp(ip, motivo);
      if (r.ok) { toast.success("IP bloqueado"); setIp(""); setMotivo(""); router.refresh(); } else toast.error(r.erro);
    }); }}>
      <Input aria-label="IP" placeholder="IP ou faixa" value={ip} onChange={(e) => setIp(e.target.value.trim())} className="font-mono" />
      <Input aria-label="Motivo" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Button type="submit" variant="destructive" carregando={pendente} disabled={!ip}><Ban /> Bloquear</Button>
    </form>
  );
}

export function Desbloquear({ tipo, valor }: { tipo: "ip" | "email"; valor: string }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <Button size="sm" variant="ghost" disabled={pendente} onClick={() => iniciar(async () => {
      const r = tipo === "ip" ? await desbloquearIp(valor) : await desbloquearEmail(valor);
      if (r.ok) router.refresh(); else toast.error(r.erro);
    })}><Undo2 /> Desbloquear</Button>
  );
}
