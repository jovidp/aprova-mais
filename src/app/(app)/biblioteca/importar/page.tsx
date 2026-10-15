import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina } from "@/components/ui/layout";
import { Importador } from "./importador";

export const metadata: Metadata = { title: "Importar materiais" };

export default function PaginaImportar() {
  return (
    <>
      <CabecalhoPagina
        titulo="Importar materiais"
        descricao="Envie um ZIP com seus PDFs. Disciplinas, aulas, assuntos e páginas são identificados automaticamente e podem ser corrigidos depois."
        acoes={<Button variant="outline" asChild><Link href="/biblioteca"><ArrowLeft /> Biblioteca</Link></Button>}
      />
      <Importador />
    </>
  );
}
