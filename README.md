# Aprova+

Plataforma pessoal de estudos para concursos públicos: importa os PDFs do curso, organiza por disciplina e assunto, gera questões e pontos-chave com IA, monta simulados, cronograma adaptativo, revisões espaçadas e acompanha o desempenho.

Produção: https://aprova-mais-ten.vercel.app

## Principais recursos

- **Biblioteca**: importação de ZIP grande direto no navegador (um PDF por vez, sem duplicar), extração de texto, seções e classificação automática por assunto; leitor de PDF com busca, anotações, destaques e marcadores.
- **Pontos importantes**: a IA marca o que mais cai em prova em cada capítulo, com página de origem e realce do trecho no PDF; resumo para imprimir.
- **Estudar com a IA**: chat ao lado do PDF que acompanha a página atual, com voz (microfone e leitura em voz alta).
- **Questões**: geração por IA a partir dos materiais, validação (referência na página, cópia, duplicidade), revisão manual, resolução com correção no servidor.
- **Simulados**: 10 tipos, prova cronometrada, pontuação e gabarito apenas no servidor, correção comentada, análise e integração com revisões e cronograma.
- **Planejamento**: cronograma adaptativo com replanejamento, metas, Pomodoro, revisões espaçadas (SM-2), flashcards e caderno de erros.
- **Desempenho**: dashboard, relatórios (PDF pela impressão), mapa de conhecimento com índice de domínio, Tutor IA com citação de fontes.
- **PWA** para instalar no celular e inicializador `.exe` para Windows.

## Tecnologia

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres com RLS em todas as tabelas, Auth, Storage), pdf.js/unpdf, Vitest + PGlite. IA por provedor configurável: Anthropic ou qualquer API compatível com `/chat/completions` (ex.: Gemini), com fila de modelos reserva e controle de orçamento.

## Rodando localmente

Requisitos: Node.js 24 e um projeto Supabase.

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run db:migrar            # aplica supabase/migrations (usa DATABASE_URL)
npm run dev                  # http://localhost:3000
```

Sem acesso direto ao banco, rode `npm run db:sql-unico` e cole `supabase/instalacao-completa.sql` no SQL Editor do Supabase.

### Variáveis de ambiente

Veja `.env.example`. As chaves secretas (`SUPABASE_SECRET_KEY`, `IA_API_KEY`, `CRON_SECRET`, `DATABASE_URL`) ficam só no servidor e nunca devem ser commitadas.

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Desenvolvimento, build e servidor de produção |
| `npm run typecheck` / `lint` | Verificação de tipos e lint |
| `npm test` | Testes unitários e de banco (PGlite) |
| `npm run db:migrar` | Aplica as migrações pendentes |
| `npm run analisar-zip -- arquivo.zip` | Inventário de um ZIP de materiais |
| `npx tsx scripts/smoke-e2e.ts <url>` | Teste ponta a ponta com usuário temporário |

## Deploy

O projeto na Vercel está conectado a este repositório: cada push na branch `main` publica em produção. As variáveis de ambiente ficam configuradas no painel da Vercel. No Supabase (Authentication → URL Configuration), o domínio de produção deve constar em Site URL e Redirect URLs.

## Inicializador para Windows

`launcher/AprovaMais.cs` gera o `AprovaMais.exe`, que sobe o servidor local e abre o app numa janela própria:

```bash
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -target:winexe -win32icon:launcher\icone.ico -out:AprovaMais.exe -r:System.Windows.Forms.dll -r:System.Drawing.dll launcher\AprovaMais.cs
```

## Segurança

- RLS em todas as tabelas; gabaritos e pontuação nunca chegam ao navegador antes da resposta.
- Funções `SECURITY DEFINER` com `search_path` vazio; histórico de respostas imutável.
- Nenhuma raspagem de plataformas de terceiros; questões geradas são autorais e verificadas contra o material.
