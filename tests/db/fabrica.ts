/** Fábricas de dados para os testes de banco. Todos os dados são fictícios. */
import { comoSistema, comoUsuario, umValor, type Db } from "./harness";

export async function criarDisciplina(db: Db, userId: string, nome = "Direito Constitucional") {
  await comoUsuario(db, userId);
  const slug = nome.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-");
  const disciplinaId = await umValor<string>(
    db,
    "insert into public.disciplinas (owner_id, nome, slug) values ($1, $2, $3) returning id",
    [userId, nome, slug],
  );
  return disciplinaId;
}

export async function criarAssunto(db: Db, userId: string, disciplinaId: string, nome: string) {
  await comoUsuario(db, userId);
  const slug = nome.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-");
  return umValor<string>(
    db,
    "insert into public.assuntos (owner_id, disciplina_id, nome, slug) values ($1, $2, $3, $4) returning id",
    [userId, disciplinaId, nome, slug],
  );
}

let contador = 0;

export interface OpcoesQuestao {
  disciplinaId: string;
  assuntoId?: string | null;
  tipo?: "multipla_escolha" | "certo_errado";
  dificuldade?: "facil" | "medio" | "dificil";
  status?: "rascunho" | "pendente_revisao" | "aprovada";
  corretaIndice?: number;
  origem?: "ia" | "manual" | "importada_licenciada";
}

/** Cria questão pelo caminho oficial (salvar_questao) e devolve ids das alternativas. */
export async function criarQuestao(db: Db, userId: string, opcoes: OpcoesQuestao) {
  const n = ++contador;
  await comoUsuario(db, userId);
  const tipo = opcoes.tipo ?? "multipla_escolha";
  const letras = tipo === "certo_errado" ? ["C", "E"] : ["A", "B", "C", "D", "E"];
  const correta = opcoes.corretaIndice ?? 0;
  const dados = {
    tipo,
    enunciado: `Enunciado de teste número ${n} sobre direitos fundamentais e sua aplicação.`,
    dificuldade: opcoes.dificuldade ?? "medio",
    disciplina_id: opcoes.disciplinaId,
    assunto_id: opcoes.assuntoId ?? null,
    origem: opcoes.origem ?? "manual",
    status: opcoes.status ?? "aprovada",
    explicacao: "Explicação de teste.",
    alternativas: letras.map((letra, i) => ({
      letra,
      texto: tipo === "certo_errado" ? (letra === "C" ? "Certo" : "Errado") : `Alternativa ${letra} da questão ${n}`,
      correta: i === correta,
      justificativa: `Justificativa ${letra}`,
    })),
  };
  const id = await umValor<string>(db, "select public.salvar_questao($1::jsonb)", [JSON.stringify(dados)]);
  await comoSistema(db);
  const alts = await db.query<{ id: string; letra: string }>(
    "select id, letra from public.alternativas where questao_id = $1 order by ordem",
    [id],
  );
  return { id, alternativas: alts.rows.map((a) => a.id), corretaId: alts.rows[correta].id };
}

/** Cria várias questões em sequência (uma conexão não pode alternar papéis em paralelo). */
export async function criarQuestoes(db: Db, userId: string, quantidade: number, opcoes: OpcoesQuestao) {
  const lista = [];
  for (let i = 0; i < quantidade; i++) lista.push(await criarQuestao(db, userId, opcoes));
  return lista;
}
