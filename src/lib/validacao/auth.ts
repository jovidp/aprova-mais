import { z } from "zod";

export const esquemaEmail = z.string().trim().toLowerCase().email("E-mail inválido");
export const esquemaSenha = z.string().min(8, "A senha precisa de pelo menos 8 caracteres").max(72, "Senha longa demais");

export const esquemaEntrar = z.object({ email: esquemaEmail, senha: z.string().min(1, "Informe a senha") });

export const esquemaCadastro = z
  .object({ nome: z.string().trim().min(2, "Informe seu nome").max(120), email: esquemaEmail, senha: esquemaSenha, confirmacao: z.string() })
  .refine((d) => d.senha === d.confirmacao, { message: "As senhas não conferem", path: ["confirmacao"] });
