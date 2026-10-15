import {
  LayoutDashboard, CalendarClock, BookMarked, Library, Database, PenLine, Sparkles, ClipboardList,
  NotebookPen, RotateCcw, Layers, Bot, Target, FileBarChart, Network, Settings, ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export interface ItemNavegacao {
  rotulo: string;
  href: string;
  icone: LucideIcon;
}

export const NAVEGACAO: ItemNavegacao[] = [
  { rotulo: "Dashboard", href: "/dashboard", icone: LayoutDashboard },
  { rotulo: "Meu Cronograma", href: "/cronograma", icone: CalendarClock },
  { rotulo: "Disciplinas", href: "/disciplinas", icone: BookMarked },
  { rotulo: "Biblioteca de Materiais", href: "/biblioteca", icone: Library },
  { rotulo: "Banco de Questões", href: "/questoes", icone: Database },
  { rotulo: "Resolver Questões", href: "/resolver", icone: PenLine },
  { rotulo: "Gerar Simulados", href: "/simulados/gerar", icone: Sparkles },
  { rotulo: "Meus Simulados", href: "/simulados", icone: ClipboardList },
  { rotulo: "Caderno de Erros", href: "/caderno-erros", icone: NotebookPen },
  { rotulo: "Revisões", href: "/revisoes", icone: RotateCcw },
  { rotulo: "Flashcards", href: "/flashcards", icone: Layers },
  { rotulo: "Tutor IA", href: "/tutor", icone: Bot },
  { rotulo: "Metas", href: "/metas", icone: Target },
  { rotulo: "Relatórios", href: "/relatorios", icone: FileBarChart },
  { rotulo: "Mapa de Conhecimento", href: "/mapa", icone: Network },
  { rotulo: "Configurações", href: "/configuracoes", icone: Settings },
];

export const NAVEGACAO_ADMIN: ItemNavegacao = { rotulo: "Administração", href: "/admin", icone: ShieldCheck };

/** Item ativo: o de prefixo mais longo que casa com o caminho (evita /simulados ativar em /simulados/gerar). */
export function itemAtivo(caminho: string, itens: ItemNavegacao[]) {
  return itens
    .filter((i) => caminho === i.href || caminho.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
