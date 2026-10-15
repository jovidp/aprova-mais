type Variante = "success" | "warning" | "destructive" | "info" | "outline";

export const ROTULO_STATUS_IMPORTACAO: Record<string, { rotulo: string; variante: Variante }> = {
  pendente: { rotulo: "Pendente", variante: "outline" },
  extraindo: { rotulo: "Extraindo", variante: "info" },
  processando: { rotulo: "Em andamento", variante: "info" },
  concluida: { rotulo: "Concluída", variante: "success" },
  concluida_com_erros: { rotulo: "Concluída com erros", variante: "warning" },
  cancelada: { rotulo: "Interrompida", variante: "outline" },
  falhou: { rotulo: "Falhou", variante: "destructive" },
};

export const ROTULO_STATUS_ARQUIVO: Record<string, { rotulo: string; variante: Variante }> = {
  pendente: { rotulo: "Pendente", variante: "outline" },
  enviando: { rotulo: "Enviando", variante: "info" },
  enviado: { rotulo: "Enviado", variante: "info" },
  processando: { rotulo: "Processando", variante: "info" },
  concluido: { rotulo: "Concluído", variante: "success" },
  duplicado: { rotulo: "Já existia", variante: "outline" },
  ignorado: { rotulo: "Ignorado", variante: "outline" },
  erro: { rotulo: "Erro", variante: "destructive" },
};
