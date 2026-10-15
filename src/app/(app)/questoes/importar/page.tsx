import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/layout";
import { Aviso } from "@/components/ui/layout";
import { ImportadorBase } from "./importador-base";

export const metadata: Metadata = { title: "Importar base de questões" };

const EXEMPLO = `{
  "licenca": "Base adquirida de <fornecedor>, licença de uso pessoal nº ...",
  "questoes": [
    {
      "tipo": "certo_errado",
      "disciplina": "Direito Constitucional",
      "assunto": "Nacionalidade",
      "banca": "CEBRASPE",
      "ano": 2024,
      "cargo": "Agente Administrativo",
      "dificuldade": "medio",
      "enunciado": "Texto do item...",
      "alternativas": [
        { "letra": "C", "texto": "Certo", "correta": true },
        { "letra": "E", "texto": "Errado" }
      ],
      "explicacao": "Comentário do gabarito..."
    }
  ]
}`;

export default function PaginaImportarBase() {
  return (
    <>
      <CabecalhoPagina titulo="Importar base de questões licenciada" descricao="Para bases que você tem direito de usar (compradas, próprias ou de domínio público)." />
      <Aviso tipo="alerta" titulo="Direitos autorais" className="mb-6">
        Importe somente questões que você está autorizado a usar. Não há integração automática com o Estratégia Questões,
        porque a plataforma não oferece API pública. Os resultados obtidos lá podem ser registrados em Configurações →
        Resultados externos. As questões importadas ficam privadas na sua conta, entram como pendentes de revisão e são
        identificadas como "base licenciada".
      </Aviso>
      <ImportadorBase exemplo={EXEMPLO} />
    </>
  );
}
