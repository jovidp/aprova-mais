"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Aviso } from "@/components/ui/layout";
import { importarBaseLicenciada } from "../acoes";

export function ImportadorBase({ exemplo }: { exemplo: string }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [resultado, setResultado] = useState<{ importadas: number; duplicadas: number; erros: { indice: number; erro: string }[] }>();
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Arquivo JSON</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {resultado && (
            <Aviso tipo={resultado.erros.length ? "alerta" : "sucesso"} titulo="Importação concluída">
              {resultado.importadas} importada(s), {resultado.duplicadas} duplicada(s) ignorada(s), {resultado.erros.length} com erro.
              {resultado.erros.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-y-auto text-xs">{resultado.erros.slice(0, 50).map((e) => <li key={e.indice}>Questão {e.indice + 1}: {e.erro}</li>)}</ul>
              )}
              {resultado.importadas > 0 && <div className="mt-2"><Link href="/questoes/revisao">Revisar questões importadas</Link></div>}
            </Aviso>
          )}
          <input type="file" accept="application/json,.json" aria-label="Arquivo JSON" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm" />
          <Button className="justify-self-start" disabled={!arquivo} carregando={pendente}
            onClick={() => iniciar(async () => {
              setErro(undefined);
              setResultado(undefined);
              if (!arquivo) return;
              if (arquivo.size > 15 * 1024 * 1024) return setErro("Arquivo maior que 15 MB.");
              const r = await importarBaseLicenciada(await arquivo.text());
              if (r.ok) setResultado(r.dados); else setErro(r.erro);
            })}>
            <FileUp /> Importar
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Formato esperado</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{exemplo}</pre>
          <p className="mt-2 text-xs text-muted-foreground">Múltipla escolha usa letras A–E em sequência; certo/errado usa C e E. Exatamente uma alternativa correta.</p>
        </CardContent>
      </Card>
    </div>
  );
}
