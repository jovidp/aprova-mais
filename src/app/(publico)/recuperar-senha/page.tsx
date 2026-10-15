"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Campo } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { solicitarRecuperacao } from "../acoes-auth";

export default function PaginaRecuperarSenha() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<{ tipo: "erro" | "sucesso"; texto: string }>();
  const [pendente, iniciar] = useTransition();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enviaremos um link para criar uma nova senha.</p>
      <form
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          iniciar(async () => {
            const r = await solicitarRecuperacao(email);
            setEstado(r.ok
              ? { tipo: "sucesso", texto: "Se houver uma conta com este e-mail, você receberá o link em instantes." }
              : { tipo: "erro", texto: r.erro });
          });
        }}
      >
        {estado && <Aviso tipo={estado.tipo}>{estado.texto}</Aviso>}
        <Campo rotulo="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Button type="submit" carregando={pendente} className="w-full">Enviar link</Button>
      </form>
      <p className="mt-6 text-center text-sm"><Link href="/entrar" className="text-primary hover:underline">Voltar para entrar</Link></p>
    </div>
  );
}
