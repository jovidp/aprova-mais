"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Campo } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { entrar } from "../acoes-auth";
import { esquemaEntrar } from "@/lib/validacao/auth";

export function FormEntrar({ voltar, erroInicial }: { voltar?: string; erroInicial?: string }) {
  const [erro, setErro] = useState(erroInicial);
  const [pendente, iniciar] = useTransition();
  const form = useForm<z.infer<typeof esquemaEntrar>>({ resolver: zodResolver(esquemaEntrar), defaultValues: { email: "", senha: "" } });

  const enviar = form.handleSubmit((dados) =>
    iniciar(async () => {
      setErro(undefined);
      const r = await entrar({ ...dados, voltar });
      if (r && !r.ok) setErro(r.erro);
    }),
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-1 text-sm text-muted-foreground">Continue de onde parou.</p>
      <form onSubmit={enviar} className="mt-8 grid gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="E-mail" htmlFor="email" erro={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
        </Campo>
        <Campo rotulo="Senha" htmlFor="senha" erro={form.formState.errors.senha?.message}>
          <Input id="senha" type="password" autoComplete="current-password" {...form.register("senha")} aria-invalid={!!form.formState.errors.senha} />
        </Campo>
        <div className="flex justify-end">
          <Link href="/recuperar-senha" className="text-sm text-primary hover:underline">Esqueci minha senha</Link>
        </div>
        <Button type="submit" carregando={pendente} className="w-full">Entrar</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Ainda não tem conta? <Link href="/cadastro" className="font-medium text-primary hover:underline">Criar conta</Link>
      </p>
    </div>
  );
}
