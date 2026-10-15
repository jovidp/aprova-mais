"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Campo } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { cadastrar } from "../acoes-auth";
import { esquemaCadastro } from "@/lib/validacao/auth";

export default function PaginaCadastro() {
  const [erro, setErro] = useState<string>();
  const [enviado, setEnviado] = useState(false);
  const [pendente, iniciar] = useTransition();
  const form = useForm<z.infer<typeof esquemaCadastro>>({
    resolver: zodResolver(esquemaCadastro),
    defaultValues: { nome: "", email: "", senha: "", confirmacao: "" },
  });
  const erros = form.formState.errors;

  if (enviado) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto size-12 text-primary" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">Confirme seu e-mail</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enviamos um link para <strong>{form.getValues("email")}</strong>. Abra-o para ativar a conta e começar a configuração.
        </p>
        <Button variant="outline" asChild className="mt-6"><Link href="/entrar">Voltar para entrar</Link></Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mt-1 text-sm text-muted-foreground">Leva menos de um minuto.</p>
      <form
        className="mt-8 grid gap-4"
        noValidate
        onSubmit={form.handleSubmit((dados) =>
          iniciar(async () => {
            setErro(undefined);
            const r = await cadastrar(dados);
            if (r && !r.ok) setErro(r.erro);
            else if (r?.ok) setEnviado(true);
          }),
        )}
      >
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" htmlFor="nome" erro={erros.nome?.message}>
          <Input id="nome" autoComplete="name" {...form.register("nome")} aria-invalid={!!erros.nome} />
        </Campo>
        <Campo rotulo="E-mail" htmlFor="email" erro={erros.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!erros.email} />
        </Campo>
        <Campo rotulo="Senha" htmlFor="senha" erro={erros.senha?.message} ajuda="Mínimo de 8 caracteres.">
          <Input id="senha" type="password" autoComplete="new-password" {...form.register("senha")} aria-invalid={!!erros.senha} />
        </Campo>
        <Campo rotulo="Confirme a senha" htmlFor="confirmacao" erro={erros.confirmacao?.message}>
          <Input id="confirmacao" type="password" autoComplete="new-password" {...form.register("confirmacao")} aria-invalid={!!erros.confirmacao} />
        </Campo>
        <Button type="submit" carregando={pendente} className="w-full">Criar conta</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tem conta? <Link href="/entrar" className="font-medium text-primary hover:underline">Entrar</Link>
      </p>
    </div>
  );
}
