-- Pontos mais importantes de cada material, extraídos por IA das seções de teoria.
-- Cada ponto aponta a página de origem e, quando verificado, o trecho literal
-- usado para destacá-lo no leitor.

create table public.material_pontos_chave (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  material_id uuid not null references public.materiais (id) on delete cascade,
  secao_id uuid references public.material_secoes (id) on delete cascade,
  pagina int not null check (pagina >= 1),
  ordem int not null default 0,
  tipo text not null check (tipo in ('conceito', 'lei', 'jurisprudencia', 'pegadinha', 'prazo_numero', 'classificacao', 'exemplo')),
  importancia smallint not null default 2 check (importancia between 1 and 3),
  titulo text not null check (char_length(titulo) between 1 and 200),
  explicacao text not null check (char_length(explicacao) between 1 and 2000),
  trecho text check (char_length(trecho) <= 600),
  processamento_id uuid references public.processamentos_ia (id) on delete set null,
  created_at timestamptz not null default now()
);
create index material_pontos_chave_material_idx on public.material_pontos_chave (material_id, pagina, ordem);
create index material_pontos_chave_user_idx on public.material_pontos_chave (user_id);

alter table public.material_pontos_chave enable row level security;
create policy "pontos: dono" on public.material_pontos_chave for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.materiais m where m.id = material_id and m.user_id = (select auth.uid()))
    and (secao_id is null or exists (select 1 from public.material_secoes s where s.id = secao_id and s.material_id = material_pontos_chave.material_id))
  );
revoke all on public.material_pontos_chave from anon;
grant select, insert, update, delete on public.material_pontos_chave to authenticated;

-- Faixas de páginas já processadas por seção (permite retomar uma geração interrompida).
alter table public.material_secoes add column pontos_paginas_processadas int[] not null default '{}';

-- Novo tipo de processamento de IA.
alter table public.processamentos_ia drop constraint processamentos_ia_tipo_check;
alter table public.processamentos_ia add constraint processamentos_ia_tipo_check check (tipo in (
  'gerar_questoes', 'validar_questao', 'classificar_material', 'tutor', 'analise_desempenho', 'gerar_flashcards',
  'gerar_simulado', 'relatorio', 'edital', 'pontos_chave'));
