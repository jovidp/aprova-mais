import type { MetadadosMaterial, PaginaLinhas } from "./tipos";
import { removerDadosPessoais } from "./limpeza";
import { normalizarNomeDisciplina } from "./disciplinas";
import { semAcentos } from "./normalizacao";

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const DATA_EXTENSO = /(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{4})/u;
const AULA = /^aula\s+(\d{1,3})\b/i;

export function extrairDataPorExtenso(texto: string): string | null {
  const m = DATA_EXTENSO.exec(texto);
  if (!m) return null;
  const mes = MESES[semAcentos(m[2]).toLowerCase()];
  const dia = Number(m[1]);
  if (!mes || dia < 1 || dia > 31) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Remove sufixos de formato que não fazem parte do nome da disciplina. */
function limparNomeDisciplina(nome: string) {
  return nome
    .replace(/\s*\((?:somente|exclusivamente|apenas)\s+pdf\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Separa "PRF (Agente Administrativo) Direito Constitucional" em concurso e disciplina.
 * O nome do curso termina no primeiro parêntese fechado seguido de texto.
 */
export function separarConcursoDisciplina(texto: string): { concurso: string | null; disciplina: string | null } {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const m = /^(.+?\([^)]*\))\s+(.+)$/.exec(limpo);
  if (m) return { concurso: m[1].trim(), disciplina: limparNomeDisciplina(m[2]) };
  return { concurso: null, disciplina: limpo ? limparNomeDisciplina(limpo) : null };
}

function tituloDePasta(pasta: string) {
  const base = pasta.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Lê os metadados da capa (primeira página). O padrão reconhecido é:
 *   "Aula NN" / "<Curso> (<Cargo>) <Disciplina>" / "Autor:" / "<autores>" / "<data>".
 * Quando a capa não segue o padrão, a disciplina vem da pasta do ZIP e a aula do nome do arquivo.
 */
export function extrairMetadados(
  paginas: PaginaLinhas[],
  caminhoOriginal: string,
): MetadadosMaterial {
  const capa = paginas[0]?.linhas.map((l) => removerDadosPessoais(l.texto)).filter(Boolean) ?? [];
  const meta: MetadadosMaterial = {
    aulaNumero: null,
    aulaRotulo: null,
    concurso: null,
    disciplina: null,
    autor: null,
    dataMaterial: null,
    fonteDisciplina: "indefinida",
  };

  const idxAula = capa.findIndex((l) => AULA.test(l));
  const idxAutor = capa.findIndex((l) => /^autor(?:es)?\s*:/i.test(l));

  if (idxAula >= 0) {
    meta.aulaRotulo = capa[idxAula];
    meta.aulaNumero = Number(AULA.exec(capa[idxAula])![1]);
  }

  if (idxAula >= 0 && idxAutor > idxAula + 1) {
    const { concurso, disciplina } = separarConcursoDisciplina(capa.slice(idxAula + 1, idxAutor).join(" "));
    meta.concurso = concurso;
    if (disciplina) {
      meta.disciplina = normalizarNomeDisciplina(disciplina);
      meta.fonteDisciplina = "capa";
    }
  }

  if (idxAutor >= 0) {
    const restante = capa.slice(idxAutor);
    const idxData = restante.findIndex((l) => DATA_EXTENSO.test(l));
    const autorLinhas = restante.slice(0, idxData > 0 ? idxData : Math.min(restante.length, 3));
    const autor = autorLinhas.join(" ").replace(/^autor(?:es)?\s*:\s*/i, "").trim();
    meta.autor = autor || null;
    if (idxData >= 0) meta.dataMaterial = extrairDataPorExtenso(restante[idxData]);
  }

  const partes = caminhoOriginal.split(/[\\/]/).filter(Boolean);
  if (!meta.disciplina && partes.length > 1) {
    const pasta = tituloDePasta(partes[partes.length - 2]);
    if (pasta) {
      meta.disciplina = normalizarNomeDisciplina(pasta);
      meta.fonteDisciplina = "pasta";
    }
  }

  if (meta.aulaNumero === null) {
    const nome = partes[partes.length - 1] ?? "";
    const m = /(?:aula\s*)?(\d{1,3})(?=\D*\.\w+$)/i.exec(nome);
    if (m) meta.aulaNumero = Number(m[1]);
  }

  return meta;
}
