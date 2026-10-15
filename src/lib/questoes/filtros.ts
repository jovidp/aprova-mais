/** Filtros do banco de questões: compartilhados entre servidor e cliente. */

export interface OpcoesFiltro {
  disciplinas: { id: string; nome: string }[];
  assuntos: { id: string; nome: string; disciplina_id: string }[];
  bancas: { id: string; sigla: string }[];
  materiais: { id: string; titulo: string; disciplina_id: string | null }[];
  concursos?: { id: string; nome: string }[];
}

export const SITUACOES = [
  { valor: "", rotulo: "Todas" },
  { valor: "ineditas", rotulo: "Inéditas para mim" },
  { valor: "respondidas", rotulo: "Já respondidas" },
  { valor: "erradas", rotulo: "Que errei (última tentativa)" },
  { valor: "acertadas", rotulo: "Que acertei" },
  { valor: "favoritas", rotulo: "Favoritas" },
  { valor: "marcadas", rotulo: "Marcadas para revisão" },
  { valor: "caderno", rotulo: "No caderno de erros" },
];

export const CHAVES_FILTRO = ["disciplina", "assunto", "dificuldade", "tipo", "origem", "banca", "situacao", "material", "ano", "cargo", "concurso", "busca"] as const;
export type ValoresFiltro = Partial<Record<(typeof CHAVES_FILTRO)[number], string>>;

/** Converte os parâmetros da URL para o formato de listar_questoes(). */
export function filtrosParaConsulta(v: ValoresFiltro) {
  return {
    ...(v.disciplina ? { disciplina_ids: [v.disciplina] } : {}),
    ...(v.assunto ? { assunto_ids: [v.assunto] } : {}),
    ...(v.dificuldade ? { dificuldades: [v.dificuldade] } : {}),
    ...(v.tipo ? { tipos: [v.tipo] } : {}),
    ...(v.origem ? { origens: [v.origem] } : {}),
    ...(v.banca ? { banca_id: v.banca } : {}),
    ...(v.situacao ? { situacao: v.situacao } : {}),
    ...(v.material ? { material_id: v.material } : {}),
    ...(v.ano ? { ano: v.ano } : {}),
    ...(v.cargo ? { cargo: v.cargo } : {}),
    ...(v.concurso ? { concurso_id: v.concurso } : {}),
    ...(v.busca ? { busca: v.busca } : {}),
  };
}

export function lerValoresFiltro(sp: Record<string, string | string[] | undefined>): ValoresFiltro {
  const v: ValoresFiltro = {};
  for (const k of CHAVES_FILTRO) {
    const x = sp[k];
    if (typeof x === "string" && x) v[k] = x.slice(0, 200);
  }
  return v;
}
