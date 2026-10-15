import type { Metadata } from "next";
import { FormEntrar } from "./form-entrar";

export const metadata: Metadata = { title: "Entrar" };

export default async function PaginaEntrar({ searchParams }: PageProps<"/entrar">) {
  const { voltar, erro } = await searchParams;
  return (
    <FormEntrar
      voltar={typeof voltar === "string" ? voltar : undefined}
      erroInicial={erro === "link" ? "O link expirou ou já foi usado. Solicite um novo." : undefined}
    />
  );
}
