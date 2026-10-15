"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BotaoImprimir({ rotulo = "Salvar em PDF / imprimir" }: { rotulo?: string }) {
  return <Button variant="outline" onClick={() => window.print()}><Printer /> {rotulo}</Button>;
}
