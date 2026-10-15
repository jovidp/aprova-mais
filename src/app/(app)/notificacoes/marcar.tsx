"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marcarTodasLidas } from "./acoes";

export function MarcarTodas() {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return <Button variant="outline" carregando={pendente} onClick={() => iniciar(async () => { await marcarTodasLidas(); router.refresh(); })}><CheckCheck /> Marcar todas como lidas</Button>;
}
