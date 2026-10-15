"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Input } from "@/components/ui/basicos";
import { Campo } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { redefinirSenha } from "../(publico)/acoes-auth";

export default function PaginaRedefinirSenha() {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nova senha</CardTitle>
          <CardDescription>Escolha uma senha com pelo menos 8 caracteres.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              iniciar(async () => {
                const r = await redefinirSenha(senha, confirmacao);
                if (r && !r.ok) setErro(r.erro);
              });
            }}
          >
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <Campo rotulo="Nova senha" htmlFor="senha">
              <Input id="senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </Campo>
            <Campo rotulo="Confirme" htmlFor="confirmacao">
              <Input id="confirmacao" type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
            </Campo>
            <Button type="submit" carregando={pendente}>Salvar senha</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
