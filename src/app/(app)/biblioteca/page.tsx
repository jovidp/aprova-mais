import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BookOpen, History, Library, Upload } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Progress } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio } from "@/components/ui/layout";
import { formatarData } from "@/lib/utils";
import { FiltrosBiblioteca } from "./filtros";
import { AcoesMaterial } from "./acoes-material";

export const metadata: Metadata = { title: "Biblioteca de Materiais" };

interface LinhaMaterial {
  id: string;
  titulo: string;
  aula_numero: number | null;
  total_paginas: number;
  status: string;
  favorito: boolean;
  ultimo_acesso_em: string | null;
  data_material: string | null;
  possivelmente_desatualizado: boolean;
  disciplina_id: string | null;
  disciplinas: { nome: string } | null;
}

export default async function PaginaBiblioteca({ searchParams }: PageProps<"/biblioteca">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const filtro = {
    disciplina: typeof sp.disciplina === "string" ? sp.disciplina : "",
    busca: typeof sp.busca === "string" ? sp.busca.trim() : "",
    visao: typeof sp.visao === "string" ? sp.visao : "todos",
  };
  const supabase = await clienteServidor();

  let consulta = supabase
    .from("materiais")
    .select("id, titulo, aula_numero, total_paginas, status, favorito, ultimo_acesso_em, data_material, possivelmente_desatualizado, disciplina_id, disciplinas(nome)")
    .eq("user_id", usuario.id);
  if (filtro.disciplina) consulta = consulta.eq("disciplina_id", filtro.disciplina);
  if (filtro.busca) consulta = consulta.ilike("titulo", `%${filtro.busca.replace(/[%_]/g, "")}%`);
  if (filtro.visao === "favoritos") consulta = consulta.eq("favorito", true);
  if (filtro.visao === "recentes") consulta = consulta.not("ultimo_acesso_em", "is", null).order("ultimo_acesso_em", { ascending: false }).limit(30);

  const [{ data: materiais, error }, { data: progresso }, { data: disciplinas }, { count: importacoes }] = await Promise.all([
    consulta.order("aula_numero", { ascending: true, nullsFirst: false }).order("titulo").limit(1000),
    supabase.from("progresso_leitura").select("material_id, paginas_lidas, concluido").eq("user_id", usuario.id),
    supabase.from("disciplinas").select("id, nome").order("nome"),
    supabase.from("importacoes").select("id", { count: "exact", head: true }).eq("user_id", usuario.id),
  ]);
  if (error) throw error;

  const lidas = new Map((progresso ?? []).map((p) => [p.material_id as string, { n: (p.paginas_lidas as number[]).length, concluido: p.concluido as boolean }]));
  let lista = (materiais ?? []) as unknown as LinhaMaterial[];
  if (filtro.visao === "nao_estudadas") lista = lista.filter((m) => !lidas.has(m.id));

  const grupos = new Map<string, LinhaMaterial[]>();
  for (const m of lista) {
    const chave = m.disciplinas?.nome ?? "Sem disciplina";
    grupos.set(chave, [...(grupos.get(chave) ?? []), m]);
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Biblioteca de Materiais"
        descricao="Seus PDFs organizados por disciplina e aula. Estude pelo leitor integrado e acompanhe o progresso de leitura."
        acoes={
          <>
            {(importacoes ?? 0) > 0 && <Button variant="outline" asChild><Link href="/biblioteca/importacoes"><History /> Importações</Link></Button>}
            <Button asChild><Link href="/biblioteca/importar"><Upload /> Adicionar materiais</Link></Button>
          </>
        }
      />
      <FiltrosBiblioteca disciplinas={disciplinas ?? []} atual={filtro} />

      {lista.length === 0 ? (
        <EstadoVazio
          icone={<Library />}
          titulo={filtro.busca || filtro.disciplina || filtro.visao !== "todos" ? "Nenhum material encontrado com esses filtros" : "Sua biblioteca está vazia"}
          descricao="Importe o ZIP com seus PDFs para começar a estudar pelos materiais e gerar questões a partir deles."
          acao={<Button asChild><Link href="/biblioteca/importar"><Upload /> Importar materiais</Link></Button>}
        />
      ) : (
        <div className="grid gap-8">
          {[...grupos].map(([disciplina, itens]) => (
            <section key={disciplina}>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                {disciplina} <Badge variant="outline">{itens.length}</Badge>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {itens.map((m) => {
                  const lido = lidas.get(m.id);
                  const pct = m.total_paginas ? Math.round(((lido?.n ?? 0) / m.total_paginas) * 100) : 0;
                  return (
                    <Card key={m.id} className="flex flex-col">
                      <CardContent className="flex flex-1 flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/biblioteca/${m.id}`} className="font-medium leading-snug hover:text-primary">
                            {m.titulo}
                          </Link>
                          <AcoesMaterial id={m.id} titulo={m.titulo} favorito={m.favorito} />
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-xs">
                          <Badge variant="outline">{m.total_paginas} páginas</Badge>
                          {m.status === "requer_ocr" && <Badge variant="warning">Precisa de OCR</Badge>}
                          {m.status === "erro" && <Badge variant="destructive">Processamento incompleto</Badge>}
                          {m.status === "processando" && <Badge variant="info">Processando</Badge>}
                          {m.possivelmente_desatualizado && <Badge variant="warning"><AlertTriangle /> Verificar atualização</Badge>}
                          {!lido && <Badge variant="secondary">Não iniciado</Badge>}
                          {lido?.concluido && <Badge variant="success">Lido</Badge>}
                        </div>
                        <div className="mt-auto">
                          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                            <span>Leitura</span>
                            <span>{pct}%</span>
                          </div>
                          <Progress value={pct} />
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{m.data_material ? `Material de ${formatarData(m.data_material)}` : ""}</span>
                            <Link href={`/biblioteca/${m.id}/ler`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                              <BookOpen className="size-3.5" /> {lido ? "Continuar" : "Estudar"}
                            </Link>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
