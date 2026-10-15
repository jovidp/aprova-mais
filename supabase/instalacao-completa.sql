-- Gerado por scripts/gerar-sql-unico.ts. Não edite à mão.
-- Execute uma única vez em um projeto vazio (Supabase → SQL Editor → New query → Run).
begin;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);

-- >>> 20261015000100_base.sql

-- =====================================================================
-- Base: extensões, funções utilitárias, perfis e preferências
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Configuração de busca textual em português, sem acentos.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_sem_acento') then
    create text search configuration public.pt_sem_acento (copy = pg_catalog.portuguese);
    alter text search configuration public.pt_sem_acento
      alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;
  end if;
end $$;

-- unaccent() não é imutável; este invólucro permite usá-lo em índices.
create or replace function public.sem_acento(texto text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, texto) $$;

create or replace function public.definir_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Perfis
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '' check (char_length(nome) <= 120),
  papel text not null default 'aluno' check (papel in ('aluno', 'admin')),
  onboarding_concluido boolean not null default false,
  concurso_alvo_id uuid,
  data_prova date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.definir_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and papel = 'admin'
  );
$$;

-- O próprio usuário não pode se promover a administrador.
create or replace function public.proteger_papel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.papel is distinct from old.papel
     and current_user in ('authenticated', 'anon')
     and not public.is_admin() then
    raise exception 'Somente administradores podem alterar papéis' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_proteger_papel before update on public.profiles
  for each row execute function public.proteger_papel();

alter table public.profiles enable row level security;

create policy "perfil: leitura própria" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "perfil: atualização própria" on public.profiles
  for update to authenticated using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------
-- Preferências
-- ---------------------------------------------------------------------
create table public.preferencias_usuario (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tema text not null default 'sistema' check (tema in ('claro', 'escuro', 'sistema')),
  fuso_horario text not null default 'America/Sao_Paulo',
  intervalos_revisao_dias int[] not null default '{1,7,15,30}',
  pomodoro_foco_min int not null default 25 check (pomodoro_foco_min between 5 and 120),
  pomodoro_pausa_min int not null default 5 check (pomodoro_pausa_min between 1 and 60),
  pomodoro_pausa_longa_min int not null default 15 check (pomodoro_pausa_longa_min between 1 and 90),
  gamificacao boolean not null default true,
  preferencias_estudo text[] not null default '{pdf,questoes}'
    check (preferencias_estudo <@ array['pdf', 'videoaula', 'questoes', 'flashcards', 'resumos']),
  dias_descanso smallint[] not null default '{}',
  notificacoes jsonb not null default
    '{"atividades": true, "simulados": true, "revisoes": true, "metas": true, "processamento": true}',
  ia_habilitada boolean not null default true,
  orcamento_ia_mensal_usd numeric(10, 2) not null default 0 check (orcamento_ia_mensal_usd >= 0),
  limite_questoes_ia_dia int not null default 50 check (limite_questoes_ia_dia between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_length(intervalos_revisao_dias, 1) between 1 and 12),
  check (dias_descanso <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

create trigger preferencias_updated_at before update on public.preferencias_usuario
  for each row execute function public.definir_updated_at();

alter table public.preferencias_usuario enable row level security;

create policy "preferências: leitura própria" on public.preferencias_usuario
  for select to authenticated using (user_id = (select auth.uid()));
create policy "preferências: inserção própria" on public.preferencias_usuario
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "preferências: atualização própria" on public.preferencias_usuario
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Criação automática de perfil e preferências no cadastro
-- ---------------------------------------------------------------------
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'nome', 120), ''))
  on conflict (id) do nothing;
  insert into public.preferencias_usuario (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000100', 'base') on conflict do nothing;

-- >>> 20261015000200_taxonomia.sql

-- =====================================================================
-- Taxonomia: bancas, concursos, editais, disciplinas, assuntos
-- Registros com owner_id nulo são globais (mantidos por administradores);
-- os demais pertencem a um usuário.
-- =====================================================================

create table public.bancas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  sigla text not null unique,
  descricao_estilo text,
  created_at timestamptz not null default now()
);

alter table public.bancas enable row level security;
create policy "bancas: leitura" on public.bancas for select to authenticated using (true);
create policy "bancas: escrita admin" on public.bancas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table public.concursos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 200),
  orgao text,
  cargo text,
  banca_id uuid references public.bancas (id) on delete set null,
  data_prova date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index concursos_owner_idx on public.concursos (owner_id);
create trigger concursos_updated_at before update on public.concursos
  for each row execute function public.definir_updated_at();

alter table public.profiles
  add constraint profiles_concurso_alvo_fk foreign key (concurso_alvo_id)
  references public.concursos (id) on delete set null;

create table public.disciplinas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  cor text check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (owner_id, slug)
);
create trigger disciplinas_updated_at before update on public.disciplinas
  for each row execute function public.definir_updated_at();

create table public.assuntos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  disciplina_id uuid not null references public.disciplinas (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (owner_id, disciplina_id, slug)
);
create index assuntos_disciplina_idx on public.assuntos (disciplina_id);
create trigger assuntos_updated_at before update on public.assuntos
  for each row execute function public.definir_updated_at();

create table public.subassuntos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  assunto_id uuid not null references public.assuntos (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 240),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (owner_id, assunto_id, slug)
);
create index subassuntos_assunto_idx on public.subassuntos (assunto_id);
create trigger subassuntos_updated_at before update on public.subassuntos
  for each row execute function public.definir_updated_at();

create table public.editais (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  concurso_id uuid references public.concursos (id) on delete cascade,
  titulo text not null,
  ano int check (ano between 1990 and 2100),
  material_id uuid,
  -- Regras verificadas pelo usuário (duração, pontuação); nada é presumido.
  regras jsonb not null default '{}',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index editais_owner_idx on public.editais (owner_id);
create trigger editais_updated_at before update on public.editais
  for each row execute function public.definir_updated_at();

create table public.edital_disciplinas (
  edital_id uuid not null references public.editais (id) on delete cascade,
  disciplina_id uuid not null references public.disciplinas (id) on delete cascade,
  peso numeric(6, 2) not null default 1 check (peso > 0),
  quantidade_questoes int check (quantidade_questoes is null or quantidade_questoes > 0),
  conteudo_programatico text,
  primary key (edital_id, disciplina_id)
);

-- Configuração pessoal de cada disciplina estudada.
create table public.usuario_disciplinas (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  disciplina_id uuid not null references public.disciplinas (id) on delete cascade,
  dificuldade smallint not null default 3 check (dificuldade between 1 and 5),
  prioridade smallint not null default 3 check (prioridade between 1 and 5),
  peso numeric(6, 2) not null default 1 check (peso > 0),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, disciplina_id)
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.concursos enable row level security;
alter table public.disciplinas enable row level security;
alter table public.assuntos enable row level security;
alter table public.subassuntos enable row level security;
alter table public.editais enable row level security;
alter table public.edital_disciplinas enable row level security;
alter table public.usuario_disciplinas enable row level security;

-- Itens globais ou próprios
create policy "concursos: leitura" on public.concursos for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "concursos: inserção" on public.concursos for insert to authenticated
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));
create policy "concursos: atualização" on public.concursos for update to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));
create policy "concursos: exclusão" on public.concursos for delete to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));

create policy "disciplinas: leitura" on public.disciplinas for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "disciplinas: inserção" on public.disciplinas for insert to authenticated
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));
create policy "disciplinas: atualização" on public.disciplinas for update to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));
create policy "disciplinas: exclusão" on public.disciplinas for delete to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));

-- Um assunto próprio só pode ficar sob uma disciplina visível ao dono.
create policy "assuntos: leitura" on public.assuntos for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "assuntos: inserção" on public.assuntos for insert to authenticated
  with check (
    (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
    and exists (select 1 from public.disciplinas d where d.id = disciplina_id
                and (d.owner_id is null or d.owner_id = (select auth.uid())))
  );
create policy "assuntos: atualização" on public.assuntos for update to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
  with check (
    (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
    and exists (select 1 from public.disciplinas d where d.id = disciplina_id
                and (d.owner_id is null or d.owner_id = (select auth.uid())))
  );
create policy "assuntos: exclusão" on public.assuntos for delete to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));

create policy "subassuntos: leitura" on public.subassuntos for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "subassuntos: inserção" on public.subassuntos for insert to authenticated
  with check (
    (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
    and exists (select 1 from public.assuntos a where a.id = assunto_id
                and (a.owner_id is null or a.owner_id = (select auth.uid())))
  );
create policy "subassuntos: atualização" on public.subassuntos for update to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
  with check (
    (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
    and exists (select 1 from public.assuntos a where a.id = assunto_id
                and (a.owner_id is null or a.owner_id = (select auth.uid())))
  );
create policy "subassuntos: exclusão" on public.subassuntos for delete to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));

create policy "editais: dono" on public.editais for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "edital_disciplinas: dono do edital" on public.edital_disciplinas for all to authenticated
  using (exists (select 1 from public.editais e where e.id = edital_id and e.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.editais e where e.id = edital_id and e.owner_id = (select auth.uid())));

create policy "usuario_disciplinas: dono" on public.usuario_disciplinas for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000200', 'taxonomia') on conflict do nothing;

-- >>> 20261015000300_materiais.sql

-- =====================================================================
-- Materiais: importações, arquivos, páginas, seções, anotações, leitura
-- =====================================================================

create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nome_arquivo text not null,
  tamanho_bytes bigint not null check (tamanho_bytes >= 0),
  status text not null default 'pendente'
    check (status in ('pendente', 'extraindo', 'processando', 'concluida', 'concluida_com_erros', 'cancelada', 'falhou')),
  total_arquivos int not null default 0 check (total_arquivos >= 0),
  arquivos_processados int not null default 0,
  arquivos_com_erro int not null default 0,
  arquivos_duplicados int not null default 0,
  arquivos_ignorados int not null default 0,
  erro text,
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index importacoes_user_idx on public.importacoes (user_id, created_at desc);
create trigger importacoes_updated_at before update on public.importacoes
  for each row execute function public.definir_updated_at();

create table public.materiais (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 300),
  nome_arquivo text not null,
  caminho_original text,
  storage_path text not null unique,
  tipo text not null check (tipo in ('pdf', 'docx', 'txt', 'md')),
  mime text not null,
  tamanho_bytes bigint not null check (tamanho_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  total_paginas int not null default 0 check (total_paginas >= 0),
  paginas_processadas int not null default 0 check (paginas_processadas >= 0),
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'processado', 'erro', 'requer_ocr')),
  erro text,
  disciplina_id uuid references public.disciplinas (id) on delete set null,
  concurso_detectado text,
  autor text,
  aula_numero int,
  aula_rotulo text,
  data_material date,
  origem text not null default 'upload' check (origem in ('importacao_zip', 'upload', 'edital')),
  importacao_id uuid references public.importacoes (id) on delete set null,
  favorito boolean not null default false,
  ultimo_acesso_em timestamptz,
  possivelmente_desatualizado boolean not null default false,
  observacao_atualizacao text,
  metadados jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sha256)
);
create index materiais_user_idx on public.materiais (user_id, disciplina_id, aula_numero);
create index materiais_recentes_idx on public.materiais (user_id, ultimo_acesso_em desc nulls last);
create index materiais_titulo_trgm on public.materiais using gin (public.sem_acento(titulo) extensions.gin_trgm_ops);
create trigger materiais_updated_at before update on public.materiais
  for each row execute function public.definir_updated_at();

alter table public.editais
  add constraint editais_material_fk foreign key (material_id) references public.materiais (id) on delete set null;

create table public.importacao_arquivos (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.importacoes (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  caminho_original text not null,
  nome_arquivo text not null,
  tipo text not null check (tipo in ('pdf', 'docx', 'txt', 'md', 'outro')),
  tamanho_bytes bigint check (tamanho_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pendente'
    check (status in ('pendente', 'enviando', 'enviado', 'processando', 'concluido', 'duplicado', 'ignorado', 'erro')),
  motivo text,
  material_id uuid references public.materiais (id) on delete set null,
  tentativas int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (importacao_id, caminho_original)
);
create index importacao_arquivos_user_idx on public.importacao_arquivos (user_id);
create trigger importacao_arquivos_updated_at before update on public.importacao_arquivos
  for each row execute function public.definir_updated_at();

create table public.material_secoes (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materiais (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  ordem int not null,
  titulo text not null,
  pagina_inicio int not null check (pagina_inicio >= 1),
  pagina_fim int not null,
  tipo text not null default 'teoria'
    check (tipo in ('apresentacao', 'teoria', 'questoes_comentadas', 'lista_questoes', 'gabarito', 'resumo', 'outro')),
  assunto_id uuid references public.assuntos (id) on delete set null,
  subassunto_id uuid references public.subassuntos (id) on delete set null,
  banca text,
  classificacao_origem text not null default 'indice'
    check (classificacao_origem in ('indice', 'titulos', 'documento_inteiro', 'ia', 'manual')),
  confianca numeric(3, 2) check (confianca between 0 and 1),
  revisado_manualmente boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, ordem),
  check (pagina_fim >= pagina_inicio)
);
create index material_secoes_assunto_idx on public.material_secoes (assunto_id);
create index material_secoes_user_idx on public.material_secoes (user_id);
create trigger material_secoes_updated_at before update on public.material_secoes
  for each row execute function public.definir_updated_at();

create table public.material_paginas (
  material_id uuid not null references public.materiais (id) on delete cascade,
  numero int not null check (numero >= 1),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  texto text not null default '' check (char_length(texto) <= 60000),
  caracteres int generated always as (char_length(texto)) stored,
  secao_id uuid references public.material_secoes (id) on delete set null,
  tsv tsvector generated always as (to_tsvector('public.pt_sem_acento'::regconfig, texto)) stored,
  primary key (material_id, numero)
);
create index material_paginas_tsv_idx on public.material_paginas using gin (tsv);
create index material_paginas_user_idx on public.material_paginas (user_id);
create index material_paginas_secao_idx on public.material_paginas (secao_id);

create table public.anotacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  material_id uuid not null references public.materiais (id) on delete cascade,
  pagina int not null check (pagina >= 1),
  tipo text not null default 'nota' check (tipo in ('nota', 'marcador', 'destaque')),
  texto text check (char_length(texto) <= 10000),
  trecho text check (char_length(trecho) <= 4000),
  cor text check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index anotacoes_material_idx on public.anotacoes (user_id, material_id, pagina);
create index anotacoes_texto_trgm on public.anotacoes using gin (public.sem_acento(coalesce(texto, '') || ' ' || coalesce(trecho, '')) extensions.gin_trgm_ops);
create trigger anotacoes_updated_at before update on public.anotacoes
  for each row execute function public.definir_updated_at();

create table public.progresso_leitura (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  material_id uuid not null references public.materiais (id) on delete cascade,
  ultima_pagina int not null default 1 check (ultima_pagina >= 1),
  paginas_lidas int[] not null default '{}',
  concluido boolean not null default false,
  tempo_leitura_seg bigint not null default 0 check (tempo_leitura_seg >= 0),
  iniciado_em timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, material_id)
);

-- ---------------------------------------------------------------------
-- RLS: tudo é privado do dono
-- ---------------------------------------------------------------------
alter table public.importacoes enable row level security;
alter table public.importacao_arquivos enable row level security;
alter table public.materiais enable row level security;
alter table public.material_secoes enable row level security;
alter table public.material_paginas enable row level security;
alter table public.anotacoes enable row level security;
alter table public.progresso_leitura enable row level security;

do $$
declare
  tabela text;
begin
  foreach tabela in array array['importacoes', 'importacao_arquivos', 'materiais', 'material_secoes',
                                'material_paginas', 'anotacoes', 'progresso_leitura']
  loop
    execute format('create policy "%1$s: leitura própria" on public.%1$I for select to authenticated using (user_id = (select auth.uid()))', tabela);
    execute format('create policy "%1$s: inserção própria" on public.%1$I for insert to authenticated with check (user_id = (select auth.uid()))', tabela);
    execute format('create policy "%1$s: atualização própria" on public.%1$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', tabela);
    execute format('create policy "%1$s: exclusão própria" on public.%1$I for delete to authenticated using (user_id = (select auth.uid()))', tabela);
  end loop;
end $$;

-- Filhos só podem apontar para materiais do próprio usuário.
create or replace function public.validar_material_do_usuario()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.materiais m where m.id = new.material_id and m.user_id = new.user_id) then
    raise exception 'Material não pertence ao usuário' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger material_secoes_dono before insert or update on public.material_secoes
  for each row execute function public.validar_material_do_usuario();
create trigger material_paginas_dono before insert or update of material_id, user_id on public.material_paginas
  for each row execute function public.validar_material_do_usuario();
create trigger anotacoes_dono before insert or update on public.anotacoes
  for each row execute function public.validar_material_do_usuario();
create trigger progresso_leitura_dono before insert or update of material_id, user_id on public.progresso_leitura
  for each row execute function public.validar_material_do_usuario();

-- Registra leitura de uma página sem condição de corrida (união do conjunto de páginas).
create or replace function public.registrar_leitura(p_material_id uuid, p_pagina int, p_segundos int default 0)
returns public.progresso_leitura
language plpgsql
set search_path = ''
as $$
declare
  v_total int;
  v_resultado public.progresso_leitura;
begin
  if p_pagina < 1 or p_segundos < 0 or p_segundos > 3600 then
    raise exception 'Parâmetros de leitura inválidos' using errcode = '22023';
  end if;
  select total_paginas into v_total from public.materiais
  where id = p_material_id and user_id = (select auth.uid());
  if not found then
    raise exception 'Material não encontrado' using errcode = 'P0002';
  end if;
  if v_total > 0 and p_pagina > v_total then
    raise exception 'Página fora do documento' using errcode = '22023';
  end if;

  insert into public.progresso_leitura as p (user_id, material_id, ultima_pagina, paginas_lidas, tempo_leitura_seg)
  values ((select auth.uid()), p_material_id, p_pagina, array[p_pagina], p_segundos)
  on conflict (user_id, material_id) do update set
    ultima_pagina = excluded.ultima_pagina,
    paginas_lidas = case when p_pagina = any (p.paginas_lidas) then p.paginas_lidas
                         else (select array_agg(x order by x) from unnest(p.paginas_lidas || p_pagina) x) end,
    tempo_leitura_seg = p.tempo_leitura_seg + excluded.tempo_leitura_seg,
    updated_at = now()
  returning * into v_resultado;

  if v_total > 0 and cardinality(v_resultado.paginas_lidas) >= v_total and not v_resultado.concluido then
    update public.progresso_leitura set concluido = true
    where user_id = v_resultado.user_id and material_id = p_material_id
    returning * into v_resultado;
  end if;

  update public.materiais set ultimo_acesso_em = now() where id = p_material_id;
  return v_resultado;
end;
$$;

-- ---------------------------------------------------------------------
-- Storage: bucket privado, uma pasta por usuário ("<uid>/...")
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materiais', 'materiais', false, 52428800,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'text/plain', 'text/markdown'])
on conflict (id) do nothing;

create policy "materiais: leitura própria" on storage.objects for select to authenticated
  using (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "materiais: envio próprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "materiais: atualização própria" on storage.objects for update to authenticated
  using (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "materiais: exclusão própria" on storage.objects for delete to authenticated
  using (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000300', 'materiais') on conflict do nothing;

-- >>> 20261015000400_questoes.sql

-- =====================================================================
-- Banco de questões
--
-- Segurança do gabarito: a resposta correta, a explicação e as justificativas
-- ficam em questao_gabaritos, sem política de leitura para usuários. Elas só
-- saem por funções que verificam se o usuário já respondeu a questão.
-- =====================================================================

create table public.questoes (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = questão global (cadastrada por administrador).
  owner_id uuid references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('multipla_escolha', 'certo_errado')),
  estilo text not null default 'conceitual'
    check (estilo in ('conceitual', 'interpretacao', 'aplicacao', 'situacao_hipotetica', 'analise_juridica')),
  enunciado text not null check (char_length(enunciado) between 10 and 8000),
  texto_apoio text check (char_length(texto_apoio) <= 12000),
  dificuldade text not null check (dificuldade in ('facil', 'medio', 'dificil')),
  disciplina_id uuid not null references public.disciplinas (id) on delete restrict,
  assunto_id uuid references public.assuntos (id) on delete set null,
  subassunto_id uuid references public.subassuntos (id) on delete set null,
  -- Questão autoral inspirada no estilo de uma banca (nunca é oficial).
  banca_estilo_id uuid references public.bancas (id) on delete set null,
  -- Somente questões oficiais importadas de base licenciada.
  banca_oficial_id uuid references public.bancas (id) on delete set null,
  ano int check (ano between 1990 and 2100),
  cargo text,
  concurso_id uuid references public.concursos (id) on delete set null,
  origem text not null check (origem in ('ia', 'manual', 'importada_licenciada')),
  licenca text,
  status text not null default 'pendente_revisao'
    check (status in ('rascunho', 'pendente_revisao', 'aprovada', 'rejeitada', 'arquivada')),
  hash_conteudo text not null,
  possivelmente_desatualizada boolean not null default false,
  processamento_ia_id uuid,
  criado_por uuid default auth.uid() references public.profiles (id) on delete set null,
  aprovada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (banca_oficial_id is null or origem = 'importada_licenciada'),
  check (origem <> 'importada_licenciada' or licenca is not null)
);
create unique index questoes_hash_unico on public.questoes (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), hash_conteudo)
  where status <> 'arquivada';
create index questoes_filtro_idx on public.questoes (disciplina_id, assunto_id, dificuldade, status);
create index questoes_owner_idx on public.questoes (owner_id, status);
create index questoes_enunciado_trgm on public.questoes using gin (public.sem_acento(enunciado) extensions.gin_trgm_ops);
create trigger questoes_updated_at before update on public.questoes
  for each row execute function public.definir_updated_at();

create table public.alternativas (
  id uuid primary key default gen_random_uuid(),
  questao_id uuid not null references public.questoes (id) on delete cascade,
  letra text not null check (letra in ('A', 'B', 'C', 'D', 'E')),
  texto text not null check (char_length(texto) between 1 and 3000),
  ordem smallint not null check (ordem between 1 and 5),
  unique (questao_id, letra),
  unique (questao_id, ordem)
);

create table public.questao_gabaritos (
  questao_id uuid primary key references public.questoes (id) on delete cascade,
  alternativa_correta_id uuid not null references public.alternativas (id),
  explicacao text not null check (char_length(explicacao) between 1 and 12000),
  -- { "<alternativa_id>": "por que está certa/errada" }
  justificativas jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.questao_fontes (
  id uuid primary key default gen_random_uuid(),
  questao_id uuid not null references public.questoes (id) on delete cascade,
  tipo text not null default 'material' check (tipo in ('material', 'legislacao', 'jurisprudencia', 'outro')),
  material_id uuid references public.materiais (id) on delete set null,
  pagina int check (pagina >= 1),
  secao_id uuid references public.material_secoes (id) on delete set null,
  trecho text check (char_length(trecho) <= 600),
  descricao text check (char_length(descricao) <= 600),
  created_at timestamptz not null default now()
);
create index questao_fontes_questao_idx on public.questao_fontes (questao_id);
create index questao_fontes_material_idx on public.questao_fontes (material_id, pagina);

-- Auditoria de qualidade
create table public.questao_validacoes (
  id uuid primary key default gen_random_uuid(),
  questao_id uuid not null references public.questoes (id) on delete cascade,
  verificador text not null check (verificador in ('estrutural', 'duplicidade', 'referencia', 'ia', 'humano')),
  resultado text not null check (resultado in ('aprovada', 'reprovada', 'alerta')),
  problemas jsonb not null default '[]',
  detalhes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index questao_validacoes_questao_idx on public.questao_validacoes (questao_id, created_at desc);

create table public.questao_eventos (
  id uuid primary key default gen_random_uuid(),
  questao_id uuid not null references public.questoes (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  acao text not null check (acao in ('criada', 'editada', 'aprovada', 'rejeitada', 'arquivada', 'enviada_revisao', 'reportada')),
  motivo text,
  dados jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index questao_eventos_questao_idx on public.questao_eventos (questao_id, created_at desc);

-- ---------------------------------------------------------------------
-- Uso pelo aluno
-- ---------------------------------------------------------------------
create table public.sessoes_questoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nome text not null default 'Sessão de questões',
  modo text not null default 'pratica' check (modo in ('pratica', 'revisao_erros', 'diagnostico')),
  filtros jsonb not null default '{}',
  questao_ids uuid[] not null check (cardinality(questao_ids) between 1 and 500),
  posicao int not null default 0 check (posicao >= 0),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluida', 'abandonada')),
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessoes_questoes_user_idx on public.sessoes_questoes (user_id, status, updated_at desc);
create trigger sessoes_questoes_updated_at before update on public.sessoes_questoes
  for each row execute function public.definir_updated_at();

create table public.respostas_usuario (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- NO ACTION: questões respondidas não podem ser apagadas (arquive-as), mas a exclusão
  -- da conta remove questões e respostas na mesma cascata.
  questao_id uuid not null references public.questoes (id),
  alternativa_id uuid references public.alternativas (id),
  alternativa_correta_id uuid not null references public.alternativas (id),
  correta boolean not null,
  tempo_seg int not null default 0 check (tempo_seg between 0 and 86400),
  tentativa_numero int not null check (tentativa_numero >= 1),
  contexto text not null default 'pratica' check (contexto in ('pratica', 'simulado', 'revisao', 'diagnostico')),
  sessao_id uuid references public.sessoes_questoes (id) on delete set null,
  simulado_tentativa_id uuid,
  chave_idempotencia uuid,
  -- Cópia para estatísticas históricas, mesmo se a questão for reclassificada depois.
  disciplina_id uuid,
  assunto_id uuid,
  subassunto_id uuid,
  dificuldade text,
  created_at timestamptz not null default now(),
  unique (user_id, questao_id, tentativa_numero),
  unique (user_id, chave_idempotencia)
);
create index respostas_usuario_user_idx on public.respostas_usuario (user_id, created_at desc);
create index respostas_usuario_questao_idx on public.respostas_usuario (user_id, questao_id, tentativa_numero desc);
create index respostas_usuario_assunto_idx on public.respostas_usuario (user_id, assunto_id);

create table public.favoritos (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  questao_id uuid not null references public.questoes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, questao_id)
);

create table public.questao_marcacoes (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  questao_id uuid not null references public.questoes (id) on delete cascade,
  marcada_revisao boolean not null default false,
  duvida text check (char_length(duvida) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, questao_id)
);

create table public.caderno_erros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  questao_id uuid not null references public.questoes (id),
  primeira_ocorrencia_em timestamptz not null default now(),
  ultima_ocorrencia_em timestamptz not null default now(),
  total_erros int not null default 1 check (total_erros >= 0),
  acertos_seguidos int not null default 0 check (acertos_seguidos >= 0),
  ultima_alternativa_errada_id uuid references public.alternativas (id),
  causa text not null default 'nao_classificado'
    check (causa in ('falta_conhecimento', 'confusao_conceitos', 'falta_atencao', 'interpretacao', 'memorizacao', 'nao_classificado')),
  observacoes text check (char_length(observacoes) <= 4000),
  status text not null default 'ativo' check (status in ('ativo', 'superado', 'arquivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, questao_id)
);
create index caderno_erros_user_idx on public.caderno_erros (user_id, status, ultima_ocorrencia_em desc);
create trigger caderno_erros_updated_at before update on public.caderno_erros
  for each row execute function public.definir_updated_at();

-- Resultados registrados manualmente de plataformas externas (sem copiar questões).
create table public.resultados_externos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  plataforma text not null check (plataforma in ('estrategia', 'qconcursos', 'gran', 'outra')),
  data date not null default current_date,
  disciplina_id uuid references public.disciplinas (id) on delete set null,
  assunto_id uuid references public.assuntos (id) on delete set null,
  questoes_respondidas int not null check (questoes_respondidas > 0),
  acertos int not null check (acertos >= 0),
  tempo_min int check (tempo_min >= 0),
  observacoes text check (char_length(observacoes) <= 2000),
  created_at timestamptz not null default now(),
  check (acertos <= questoes_respondidas)
);
create index resultados_externos_user_idx on public.resultados_externos (user_id, data desc);

-- Agregado diário por assunto, mantido por gatilho (base dos dashboards).
create table public.historico_desempenho (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  data date not null,
  disciplina_id uuid,
  assunto_id uuid,
  respondidas int not null default 0,
  acertos int not null default 0,
  tempo_seg bigint not null default 0,
  respondidas_facil int not null default 0,
  acertos_facil int not null default 0,
  respondidas_medio int not null default 0,
  acertos_medio int not null default 0,
  respondidas_dificil int not null default 0,
  acertos_dificil int not null default 0,
  unique nulls not distinct (user_id, data, disciplina_id, assunto_id)
);
create index historico_desempenho_user_idx on public.historico_desempenho (user_id, data);

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------
create or replace function public.normalizar_texto(texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(lower(public.sem_acento(coalesce(texto, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.hash_questao(p_enunciado text, p_alternativas text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(public.normalizar_texto(p_enunciado) || '|' ||
             coalesce((select string_agg(public.normalizar_texto(a), '|' order by public.normalizar_texto(a))
                       from unnest(p_alternativas) a), ''));
$$;

create or replace function public.pode_ver_questao(p_owner uuid, p_status text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_owner is null and p_status = 'aprovada')
      or p_owner = (select auth.uid())
      or public.is_admin();
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.questoes enable row level security;
alter table public.alternativas enable row level security;
alter table public.questao_gabaritos enable row level security;
alter table public.questao_fontes enable row level security;
alter table public.questao_validacoes enable row level security;
alter table public.questao_eventos enable row level security;
alter table public.sessoes_questoes enable row level security;
alter table public.respostas_usuario enable row level security;
alter table public.favoritos enable row level security;
alter table public.questao_marcacoes enable row level security;
alter table public.caderno_erros enable row level security;
alter table public.resultados_externos enable row level security;
alter table public.historico_desempenho enable row level security;

-- Escrita em questões, alternativas, gabaritos e fontes apenas por funções.
create policy "questões: leitura" on public.questoes for select to authenticated
  using (public.pode_ver_questao(owner_id, status));
create policy "alternativas: leitura" on public.alternativas for select to authenticated
  using (exists (select 1 from public.questoes q where q.id = questao_id and public.pode_ver_questao(q.owner_id, q.status)));
create policy "gabaritos: somente admin" on public.questao_gabaritos for select to authenticated
  using (public.is_admin());
create policy "fontes: leitura" on public.questao_fontes for select to authenticated
  using (exists (select 1 from public.questoes q where q.id = questao_id and public.pode_ver_questao(q.owner_id, q.status)));
create policy "validações: dono ou admin" on public.questao_validacoes for select to authenticated
  using (public.is_admin() or exists (select 1 from public.questoes q where q.id = questao_id and q.owner_id = (select auth.uid())));
create policy "validações: registro pelo dono" on public.questao_validacoes for insert to authenticated
  with check (public.is_admin() or exists (select 1 from public.questoes q where q.id = questao_id and q.owner_id = (select auth.uid())));
create policy "eventos: dono ou admin" on public.questao_eventos for select to authenticated
  using (public.is_admin() or exists (select 1 from public.questoes q where q.id = questao_id and q.owner_id = (select auth.uid())));

create policy "sessões: dono" on public.sessoes_questoes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Histórico imutável: o aluno só lê; a gravação é feita por responder_questao().
create policy "respostas: leitura própria" on public.respostas_usuario for select to authenticated
  using (user_id = (select auth.uid()));

create policy "favoritos: dono" on public.favoritos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "marcações: dono" on public.questao_marcacoes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "caderno: leitura própria" on public.caderno_erros for select to authenticated
  using (user_id = (select auth.uid()));
create policy "caderno: atualização própria" on public.caderno_erros for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.caderno_erros from authenticated;
grant update (causa, observacoes, status) on public.caderno_erros to authenticated;

create policy "resultados externos: dono" on public.resultados_externos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "histórico: leitura própria" on public.historico_desempenho for select to authenticated
  using (user_id = (select auth.uid()));

-- Favoritar/marcar só questões visíveis.
create or replace function public.validar_questao_visivel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.questoes q where q.id = new.questao_id and public.pode_ver_questao(q.owner_id, q.status)) then
    raise exception 'Questão indisponível' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger favoritos_visivel before insert on public.favoritos
  for each row execute function public.validar_questao_visivel();
create trigger marcacoes_visivel before insert or update on public.questao_marcacoes
  for each row execute function public.validar_questao_visivel();

-- ---------------------------------------------------------------------
-- Cadastro e manutenção de questões
-- ---------------------------------------------------------------------
create or replace function public.salvar_questao(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_global boolean := coalesce((p_dados ->> 'global')::boolean, false);
  v_owner uuid;
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_tipo text := p_dados ->> 'tipo';
  v_origem text := coalesce(p_dados ->> 'origem', 'manual');
  v_status text := coalesce(p_dados ->> 'status', 'pendente_revisao');
  v_disciplina uuid := (p_dados ->> 'disciplina_id')::uuid;
  v_assunto uuid := nullif(p_dados ->> 'assunto_id', '')::uuid;
  v_subassunto uuid := nullif(p_dados ->> 'subassunto_id', '')::uuid;
  v_alts jsonb := p_dados -> 'alternativas';
  v_qtd int;
  v_corretas int;
  v_letras text[];
  v_textos text[];
  v_hash text;
  v_existente uuid;
  v_alt jsonb;
  v_alt_id uuid;
  v_correta_id uuid;
  v_justificativas jsonb := '{}';
  v_fonte jsonb;
  v_total_paginas int;
  i int := 0;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;
  if v_global and not public.is_admin() then
    raise exception 'Somente administradores criam questões globais' using errcode = '42501';
  end if;
  v_owner := case when v_global then null else v_uid end;

  if v_status not in ('rascunho', 'pendente_revisao', 'aprovada') then
    raise exception 'Status inicial inválido' using errcode = '22023';
  end if;
  if v_origem not in ('ia', 'manual', 'importada_licenciada') then
    raise exception 'Origem inválida' using errcode = '22023';
  end if;
  if v_origem = 'importada_licenciada' and coalesce(p_dados ->> 'licenca', '') = '' then
    raise exception 'Questões importadas exigem a descrição da licença' using errcode = '22023';
  end if;
  if nullif(p_dados ->> 'banca_oficial_id', '') is not null and v_origem <> 'importada_licenciada' then
    raise exception 'Apenas questões importadas de base licenciada podem ser marcadas como oficiais' using errcode = '22023';
  end if;
  if coalesce(trim(p_dados ->> 'explicacao'), '') = '' then
    raise exception 'A explicação da resposta é obrigatória' using errcode = '22023';
  end if;

  -- Taxonomia coerente e visível ao dono
  if not exists (select 1 from public.disciplinas d where d.id = v_disciplina
                 and (d.owner_id is null or d.owner_id = v_owner)) then
    raise exception 'Disciplina inválida' using errcode = '22023';
  end if;
  if v_assunto is not null and not exists (
       select 1 from public.assuntos a where a.id = v_assunto and a.disciplina_id = v_disciplina
       and (a.owner_id is null or a.owner_id = v_owner)) then
    raise exception 'Assunto não pertence à disciplina' using errcode = '22023';
  end if;
  if v_subassunto is not null and (v_assunto is null or not exists (
       select 1 from public.subassuntos s where s.id = v_subassunto and s.assunto_id = v_assunto
       and (s.owner_id is null or s.owner_id = v_owner))) then
    raise exception 'Subassunto não pertence ao assunto' using errcode = '22023';
  end if;

  -- Alternativas
  if jsonb_typeof(v_alts) <> 'array' then
    raise exception 'Alternativas ausentes' using errcode = '22023';
  end if;
  v_qtd := jsonb_array_length(v_alts);
  select count(*) filter (where coalesce((a ->> 'correta')::boolean, false)),
         array_agg(upper(a ->> 'letra') order by ord),
         array_agg(public.normalizar_texto(a ->> 'texto'))
    into v_corretas, v_letras, v_textos
  from jsonb_array_elements(v_alts) with ordinality as t(a, ord);

  if v_tipo = 'multipla_escolha' then
    if v_qtd < 2 or v_qtd > 5 or v_letras <> (array['A', 'B', 'C', 'D', 'E'])[1:v_qtd] then
      raise exception 'Múltipla escolha exige de 2 a 5 alternativas com letras em sequência (A, B, ...)' using errcode = '22023';
    end if;
  elsif v_tipo = 'certo_errado' then
    if v_qtd <> 2 or v_letras <> array['C', 'E'] then
      raise exception 'Certo/errado exige exatamente as alternativas C (Certo) e E (Errado)' using errcode = '22023';
    end if;
  else
    raise exception 'Tipo de questão inválido' using errcode = '22023';
  end if;
  if v_corretas <> 1 then
    raise exception 'A questão deve ter exatamente uma alternativa correta' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_textos) t where t = '') then
    raise exception 'Alternativa sem texto' using errcode = '22023';
  end if;
  if (select count(distinct t) from unnest(v_textos) t) <> v_qtd then
    raise exception 'Alternativas repetidas' using errcode = '22023';
  end if;

  v_hash := public.hash_questao(p_dados ->> 'enunciado',
              array(select a ->> 'texto' from jsonb_array_elements(v_alts) a));

  select id into v_existente from public.questoes
  where coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(v_owner, '00000000-0000-0000-0000-000000000000'::uuid)
    and hash_conteudo = v_hash and status <> 'arquivada'
    and (v_id is null or id <> v_id)
  limit 1;
  if v_existente is not null then
    raise exception 'Questão duplicada' using errcode = '23505', detail = v_existente::text;
  end if;

  if v_id is null then
    insert into public.questoes (owner_id, tipo, estilo, enunciado, texto_apoio, dificuldade, disciplina_id,
      assunto_id, subassunto_id, banca_estilo_id, banca_oficial_id, ano, cargo, concurso_id, origem, licenca,
      status, hash_conteudo, possivelmente_desatualizada, processamento_ia_id, criado_por, aprovada_em)
    values (v_owner, v_tipo, coalesce(p_dados ->> 'estilo', 'conceitual'), p_dados ->> 'enunciado',
      nullif(p_dados ->> 'texto_apoio', ''), p_dados ->> 'dificuldade', v_disciplina, v_assunto, v_subassunto,
      nullif(p_dados ->> 'banca_estilo_id', '')::uuid, nullif(p_dados ->> 'banca_oficial_id', '')::uuid,
      nullif(p_dados ->> 'ano', '')::int, nullif(p_dados ->> 'cargo', ''), nullif(p_dados ->> 'concurso_id', '')::uuid,
      v_origem, nullif(p_dados ->> 'licenca', ''), v_status, v_hash,
      coalesce((p_dados ->> 'possivelmente_desatualizada')::boolean, false),
      nullif(p_dados ->> 'processamento_ia_id', '')::uuid, v_uid,
      case when v_status = 'aprovada' then now() end)
    returning id into v_id;
    insert into public.questao_eventos (questao_id, user_id, acao, dados)
    values (v_id, v_uid, 'criada', jsonb_build_object('origem', v_origem, 'status', v_status));
  else
    -- Edição: só do dono (ou admin) e sem histórico de respostas/simulados.
    if not exists (select 1 from public.questoes q where q.id = v_id
                   and (q.owner_id = v_uid or public.is_admin())) then
      raise exception 'Questão não encontrada' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.respostas_usuario r where r.questao_id = v_id)
       or exists (select 1 from public.simulados_questoes s where s.questao_id = v_id) then
      raise exception 'Questão já utilizada; arquive-a e crie uma nova versão' using errcode = '55000';
    end if;
    update public.questoes set
      tipo = v_tipo, estilo = coalesce(p_dados ->> 'estilo', 'conceitual'), enunciado = p_dados ->> 'enunciado',
      texto_apoio = nullif(p_dados ->> 'texto_apoio', ''), dificuldade = p_dados ->> 'dificuldade',
      disciplina_id = v_disciplina, assunto_id = v_assunto, subassunto_id = v_subassunto,
      banca_estilo_id = nullif(p_dados ->> 'banca_estilo_id', '')::uuid,
      banca_oficial_id = nullif(p_dados ->> 'banca_oficial_id', '')::uuid,
      ano = nullif(p_dados ->> 'ano', '')::int, cargo = nullif(p_dados ->> 'cargo', ''),
      concurso_id = nullif(p_dados ->> 'concurso_id', '')::uuid, origem = v_origem,
      licenca = nullif(p_dados ->> 'licenca', ''), status = v_status, hash_conteudo = v_hash,
      possivelmente_desatualizada = coalesce((p_dados ->> 'possivelmente_desatualizada')::boolean, false),
      aprovada_em = case when v_status = 'aprovada' then now() end
    where id = v_id;
    delete from public.questao_gabaritos where questao_id = v_id;
    delete from public.alternativas where questao_id = v_id;
    delete from public.questao_fontes where questao_id = v_id;
    insert into public.questao_eventos (questao_id, user_id, acao) values (v_id, v_uid, 'editada');
  end if;

  for v_alt in select a from jsonb_array_elements(v_alts) a loop
    i := i + 1;
    insert into public.alternativas (questao_id, letra, texto, ordem)
    values (v_id, upper(v_alt ->> 'letra'), trim(v_alt ->> 'texto'), i)
    returning id into v_alt_id;
    if coalesce((v_alt ->> 'correta')::boolean, false) then
      v_correta_id := v_alt_id;
    end if;
    if coalesce(trim(v_alt ->> 'justificativa'), '') <> '' then
      v_justificativas := v_justificativas || jsonb_build_object(v_alt_id::text, trim(v_alt ->> 'justificativa'));
    end if;
  end loop;

  insert into public.questao_gabaritos (questao_id, alternativa_correta_id, explicacao, justificativas)
  values (v_id, v_correta_id, trim(p_dados ->> 'explicacao'), v_justificativas);

  for v_fonte in select f from jsonb_array_elements(coalesce(p_dados -> 'fontes', '[]')) f loop
    if nullif(v_fonte ->> 'material_id', '') is not null then
      select total_paginas into v_total_paginas from public.materiais m
      where m.id = (v_fonte ->> 'material_id')::uuid and (m.user_id = v_owner or public.is_admin());
      if not found then
        raise exception 'Material de referência inválido' using errcode = '22023';
      end if;
      if nullif(v_fonte ->> 'pagina', '') is not null
         and ((v_fonte ->> 'pagina')::int < 1 or (v_total_paginas > 0 and (v_fonte ->> 'pagina')::int > v_total_paginas)) then
        raise exception 'Página de referência inexistente' using errcode = '22023';
      end if;
    end if;
    insert into public.questao_fontes (questao_id, tipo, material_id, pagina, secao_id, trecho, descricao)
    values (v_id, coalesce(v_fonte ->> 'tipo', 'material'), nullif(v_fonte ->> 'material_id', '')::uuid,
            nullif(v_fonte ->> 'pagina', '')::int, nullif(v_fonte ->> 'secao_id', '')::uuid,
            left(v_fonte ->> 'trecho', 600), left(v_fonte ->> 'descricao', 600));
  end loop;

  return v_id;
end;
$$;

create or replace function public.definir_status_questao(p_questao_id uuid, p_status text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_atual text;
  v_acao text;
begin
  select status into v_atual from public.questoes
  where id = p_questao_id and (owner_id = v_uid or public.is_admin());
  if not found then
    raise exception 'Questão não encontrada' using errcode = 'P0002';
  end if;
  if p_status not in ('pendente_revisao', 'aprovada', 'rejeitada', 'arquivada') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  if p_status = 'rejeitada' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da rejeição' using errcode = '22023';
  end if;
  v_acao := case p_status when 'aprovada' then 'aprovada' when 'rejeitada' then 'rejeitada'
                          when 'arquivada' then 'arquivada' else 'enviada_revisao' end;
  update public.questoes set status = p_status,
    aprovada_em = case when p_status = 'aprovada' then now() else aprovada_em end
  where id = p_questao_id;
  insert into public.questao_eventos (questao_id, user_id, acao, motivo, dados)
  values (p_questao_id, v_uid, v_acao, p_motivo, jsonb_build_object('de', v_atual, 'para', p_status));
end;
$$;

-- Gabarito para revisão de questões ainda não aprovadas (dono) ou para administradores.
create or replace function public.obter_gabarito_revisao(p_questao_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q public.questoes;
  v_res jsonb;
begin
  select * into v_q from public.questoes where id = p_questao_id;
  if not found then
    raise exception 'Questão não encontrada' using errcode = 'P0002';
  end if;
  if not (public.is_admin()
          or (v_q.owner_id = v_uid and (v_q.status <> 'aprovada' or (v_q.origem = 'manual' and v_q.criado_por = v_uid)))) then
    raise exception 'Gabarito indisponível' using errcode = '42501';
  end if;
  select jsonb_build_object('alternativa_correta_id', g.alternativa_correta_id, 'explicacao', g.explicacao,
                            'justificativas', g.justificativas)
    into v_res from public.questao_gabaritos g where g.questao_id = p_questao_id;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------
-- Resposta do aluno (prática)
-- ---------------------------------------------------------------------
create or replace function public.correcao_questao_json(p_questao_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'alternativa_correta_id', g.alternativa_correta_id,
    'explicacao', g.explicacao,
    'justificativas', g.justificativas,
    'fontes', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'material_id', f.material_id, 'pagina', f.pagina,
                                          'trecho', f.trecho, 'descricao', f.descricao,
                                          'material_titulo', m.titulo) order by f.created_at)
      from public.questao_fontes f left join public.materiais m on m.id = f.material_id
      where f.questao_id = p_questao_id), '[]'::jsonb))
  from public.questao_gabaritos g where g.questao_id = p_questao_id;
$$;
revoke execute on function public.correcao_questao_json(uuid) from public, anon, authenticated;

create or replace function public.responder_questao(
  p_questao_id uuid,
  p_alternativa_id uuid,
  p_tempo_seg int default 0,
  p_sessao_id uuid default null,
  p_contexto text default 'pratica',
  p_chave uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q public.questoes;
  v_correta_id uuid;
  v_tentativa int;
  v_existente public.respostas_usuario;
  v_resp public.respostas_usuario;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;
  if p_contexto not in ('pratica', 'revisao', 'diagnostico') then
    raise exception 'Contexto inválido' using errcode = '22023';
  end if;

  -- Reenvio da mesma resposta (clique duplo, rede instável): devolve o registro original.
  if p_chave is not null then
    select * into v_existente from public.respostas_usuario where user_id = v_uid and chave_idempotencia = p_chave;
    if found then
      return jsonb_build_object('resposta_id', v_existente.id, 'correta', v_existente.correta,
               'tentativa_numero', v_existente.tentativa_numero, 'repetida', true)
             || public.correcao_questao_json(v_existente.questao_id);
    end if;
  end if;

  select * into v_q from public.questoes q
  where q.id = p_questao_id and q.status = 'aprovada' and (q.owner_id is null or q.owner_id = v_uid);
  if not found then
    raise exception 'Questão indisponível' using errcode = 'P0002';
  end if;
  if p_alternativa_id is null or not exists (select 1 from public.alternativas a where a.id = p_alternativa_id and a.questao_id = p_questao_id) then
    raise exception 'Alternativa inválida' using errcode = '22023';
  end if;
  if p_sessao_id is not null and not exists (
       select 1 from public.sessoes_questoes s where s.id = p_sessao_id and s.user_id = v_uid and p_questao_id = any (s.questao_ids)) then
    raise exception 'Sessão inválida' using errcode = '22023';
  end if;

  select alternativa_correta_id into v_correta_id from public.questao_gabaritos where questao_id = p_questao_id;
  if v_correta_id is null then
    raise exception 'Questão sem gabarito' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_questao_id::text, 0));
  select coalesce(max(tentativa_numero), 0) + 1 into v_tentativa
  from public.respostas_usuario where user_id = v_uid and questao_id = p_questao_id;

  insert into public.respostas_usuario (user_id, questao_id, alternativa_id, alternativa_correta_id, correta,
    tempo_seg, tentativa_numero, contexto, sessao_id, chave_idempotencia, disciplina_id, assunto_id, subassunto_id, dificuldade)
  values (v_uid, p_questao_id, p_alternativa_id, v_correta_id, p_alternativa_id = v_correta_id,
    least(greatest(coalesce(p_tempo_seg, 0), 0), 86400), v_tentativa, p_contexto, p_sessao_id, p_chave,
    v_q.disciplina_id, v_q.assunto_id, v_q.subassunto_id, v_q.dificuldade)
  returning * into v_resp;

  return jsonb_build_object('resposta_id', v_resp.id, 'correta', v_resp.correta,
           'tentativa_numero', v_resp.tentativa_numero, 'repetida', false)
         || public.correcao_questao_json(p_questao_id);
end;
$$;

-- Correção de uma questão já respondida (revisitar o comentário).
create or replace function public.obter_correcao_questao(p_questao_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or exists (
      select 1 from public.respostas_usuario r where r.user_id = auth.uid() and r.questao_id = p_questao_id)) then
    raise exception 'Responda a questão para ver o gabarito' using errcode = '42501';
  end if;
  return public.correcao_questao_json(p_questao_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Gatilhos: caderno de erros e histórico diário
-- ---------------------------------------------------------------------
create or replace function public.apos_resposta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fuso text;
  v_data date;
begin
  if new.correta then
    update public.caderno_erros set
      acertos_seguidos = acertos_seguidos + 1,
      status = case when status = 'ativo' and acertos_seguidos + 1 >= 2 then 'superado' else status end,
      updated_at = now()
    where user_id = new.user_id and questao_id = new.questao_id;
  else
    insert into public.caderno_erros (user_id, questao_id, ultima_alternativa_errada_id, primeira_ocorrencia_em, ultima_ocorrencia_em)
    values (new.user_id, new.questao_id, new.alternativa_id, new.created_at, new.created_at)
    on conflict (user_id, questao_id) do update set
      total_erros = public.caderno_erros.total_erros + 1,
      acertos_seguidos = 0,
      ultima_alternativa_errada_id = excluded.ultima_alternativa_errada_id,
      ultima_ocorrencia_em = excluded.ultima_ocorrencia_em,
      status = 'ativo',
      updated_at = now();
  end if;

  select coalesce(fuso_horario, 'America/Sao_Paulo') into v_fuso from public.preferencias_usuario where user_id = new.user_id;
  v_data := (new.created_at at time zone coalesce(v_fuso, 'America/Sao_Paulo'))::date;

  insert into public.historico_desempenho as h (user_id, data, disciplina_id, assunto_id, respondidas, acertos, tempo_seg,
    respondidas_facil, acertos_facil, respondidas_medio, acertos_medio, respondidas_dificil, acertos_dificil)
  values (new.user_id, v_data, new.disciplina_id, new.assunto_id, 1, new.correta::int, new.tempo_seg,
    (new.dificuldade = 'facil')::int, (new.dificuldade = 'facil' and new.correta)::int,
    (new.dificuldade = 'medio')::int, (new.dificuldade = 'medio' and new.correta)::int,
    (new.dificuldade = 'dificil')::int, (new.dificuldade = 'dificil' and new.correta)::int)
  on conflict (user_id, data, disciplina_id, assunto_id) do update set
    respondidas = h.respondidas + 1,
    acertos = h.acertos + excluded.acertos,
    tempo_seg = h.tempo_seg + excluded.tempo_seg,
    respondidas_facil = h.respondidas_facil + excluded.respondidas_facil,
    acertos_facil = h.acertos_facil + excluded.acertos_facil,
    respondidas_medio = h.respondidas_medio + excluded.respondidas_medio,
    acertos_medio = h.acertos_medio + excluded.acertos_medio,
    respondidas_dificil = h.respondidas_dificil + excluded.respondidas_dificil,
    acertos_dificil = h.acertos_dificil + excluded.acertos_dificil;
  return new;
end;
$$;

create trigger respostas_usuario_apos_inserir after insert on public.respostas_usuario
  for each row execute function public.apos_resposta();

-- O histórico de respostas não pode ser alterado nem apagado (exceto pela exclusão da conta).
create or replace function public.bloquear_alteracao_historico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'O histórico de respostas é imutável' using errcode = '55000';
  end if;
  if current_user in ('authenticated', 'anon') then
    raise exception 'O histórico de respostas é imutável' using errcode = '55000';
  end if;
  return old;
end;
$$;
create trigger respostas_usuario_imutavel before update or delete on public.respostas_usuario
  for each row execute function public.bloquear_alteracao_historico();

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000400', 'questoes') on conflict do nothing;

-- >>> 20261015000500_simulados.sql

-- =====================================================================
-- Simulados
--
-- Integridade:
--  * a prova é servida por obter_prova(), sem gabarito;
--  * cada simulado guarda uma cópia (snapshot) das questões, gabaritos e
--    regras de pontuação, preservada mesmo se as questões mudarem;
--  * prazo, respostas e nota são controlados e calculados no banco.
-- =====================================================================

create table public.simulados_regras_pontuacao (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  descricao text,
  pontos_acerto numeric(6, 2) not null default 1,
  pontos_erro numeric(6, 2) not null default 0,
  pontos_branco numeric(6, 2) not null default 0,
  nota_nao_negativa boolean not null default true,
  created_at timestamptz not null default now(),
  check (pontos_acerto > 0)
);
alter table public.simulados_regras_pontuacao enable row level security;
create policy "regras: leitura" on public.simulados_regras_pontuacao for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "regras: escrita própria" on public.simulados_regras_pontuacao for all to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()))
  with check (owner_id = (select auth.uid()) or (owner_id is null and public.is_admin()));

create table public.simulados_agendamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nome text not null,
  frequencia text not null check (frequencia in ('semanal', 'quinzenal', 'mensal', 'data_unica')),
  dia_semana smallint check (dia_semana between 0 and 6),
  dia_mes smallint check (dia_mes between 1 and 28),
  data_unica date,
  hora time not null default '08:00',
  config jsonb not null,
  permitir_ia boolean not null default false,
  ativo boolean not null default true,
  proxima_execucao_em timestamptz,
  ultima_execucao_em timestamptz,
  ultimo_simulado_id uuid,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequencia <> 'data_unica' or data_unica is not null),
  check (frequencia not in ('semanal', 'quinzenal') or dia_semana is not null),
  check (frequencia <> 'mensal' or dia_mes is not null)
);
create index simulados_agendamentos_execucao_idx on public.simulados_agendamentos (ativo, proxima_execucao_em);
create trigger simulados_agendamentos_updated_at before update on public.simulados_agendamentos
  for each row execute function public.definir_updated_at();
alter table public.simulados_agendamentos enable row level security;
create policy "agendamentos: dono" on public.simulados_agendamentos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.simulados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 200),
  tipo text not null check (tipo in ('geral', 'disciplina', 'assunto', 'erros', 'adaptativo', 'banca', 'concurso',
                                     'diagnostico', 'semanal', 'revisao_acumulada', 'personalizado')),
  concurso_id uuid references public.concursos (id) on delete set null,
  banca_estilo_id uuid references public.bancas (id) on delete set null,
  edital_id uuid references public.editais (id) on delete set null,
  config jsonb not null default '{}',
  total_questoes int not null check (total_questoes between 1 and 300),
  tempo_limite_seg int check (tempo_limite_seg is null or tempo_limite_seg between 60 and 43200),
  permite_pausa boolean not null default false,
  ordem text not null default 'aleatoria' check (ordem in ('aleatoria', 'organizada')),
  mostrar_gabarito_durante boolean not null default false,
  finalizar_ao_esgotar boolean not null default true,
  regra_pontuacao_id uuid references public.simulados_regras_pontuacao (id) on delete set null,
  -- Cópia imutável da regra usada.
  pontos_acerto numeric(6, 2) not null,
  pontos_erro numeric(6, 2) not null,
  pontos_branco numeric(6, 2) not null,
  nota_nao_negativa boolean not null,
  status text not null default 'pronto' check (status in ('pronto', 'arquivado')),
  agendamento_id uuid references public.simulados_agendamentos (id) on delete set null,
  observacoes_geracao jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pontos_acerto > 0)
);
create index simulados_user_idx on public.simulados (user_id, created_at desc);
create trigger simulados_updated_at before update on public.simulados
  for each row execute function public.definir_updated_at();

alter table public.simulados_agendamentos
  add constraint agendamentos_ultimo_simulado_fk foreign key (ultimo_simulado_id)
  references public.simulados (id) on delete set null;

create table public.simulados_questoes (
  simulado_id uuid not null references public.simulados (id) on delete cascade,
  ordem int not null check (ordem >= 1),
  questao_id uuid not null references public.questoes (id),
  disciplina_id uuid,
  assunto_id uuid,
  dificuldade text,
  primary key (simulado_id, ordem),
  unique (simulado_id, questao_id)
);
create index simulados_questoes_questao_idx on public.simulados_questoes (questao_id);

-- Sem política de leitura: acessado apenas pelas funções abaixo.
create table public.simulados_gabaritos (
  simulado_id uuid not null references public.simulados (id) on delete cascade,
  questao_id uuid not null,
  alternativa_correta_id uuid not null,
  snapshot jsonb not null,
  primary key (simulado_id, questao_id)
);

create table public.simulados_tentativas (
  id uuid primary key default gen_random_uuid(),
  simulado_id uuid not null references public.simulados (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  numero int not null check (numero >= 1),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'pausada', 'concluida', 'interrompida')),
  iniciada_em timestamptz not null default now(),
  prazo_em timestamptz,
  pausada_em timestamptz,
  tempo_pausado_seg int not null default 0 check (tempo_pausado_seg >= 0),
  finalizada_em timestamptz,
  finalizacao text check (finalizacao in ('manual', 'tempo_esgotado', 'interrompida')),
  questao_atual int not null default 1,
  ultima_atividade_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (simulado_id, numero)
);
create unique index simulados_tentativas_ativa_unica on public.simulados_tentativas (simulado_id)
  where status in ('em_andamento', 'pausada');
create index simulados_tentativas_user_idx on public.simulados_tentativas (user_id, created_at desc);

alter table public.respostas_usuario
  add constraint respostas_simulado_tentativa_fk foreign key (simulado_tentativa_id)
  references public.simulados_tentativas (id) on delete set null;

create table public.simulados_respostas (
  tentativa_id uuid not null references public.simulados_tentativas (id) on delete cascade,
  questao_id uuid not null,
  alternativa_id uuid,
  marcada_revisao boolean not null default false,
  tempo_seg int not null default 0 check (tempo_seg between 0 and 86400),
  respondida_em timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tentativa_id, questao_id)
);

create table public.simulados_resultados (
  tentativa_id uuid primary key references public.simulados_tentativas (id) on delete cascade,
  simulado_id uuid not null references public.simulados (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  total int not null,
  respondidas int not null,
  acertos int not null,
  erros int not null,
  brancos int not null,
  -- acertos ÷ respondidas (nulo se nada foi respondido)
  percentual_acerto numeric(5, 2),
  -- acertos ÷ total de questões
  percentual_acerto_total numeric(5, 2) not null,
  nota numeric(8, 2) not null,
  nota_maxima numeric(8, 2) not null,
  tempo_total_seg int not null,
  tempo_medio_seg numeric(8, 2) not null,
  por_disciplina jsonb not null default '[]',
  por_assunto jsonb not null default '[]',
  por_dificuldade jsonb not null default '[]',
  regra jsonb not null,
  created_at timestamptz not null default now(),
  check (acertos + erros + brancos = total),
  check (respondidas = acertos + erros)
);
create index simulados_resultados_user_idx on public.simulados_resultados (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- RLS: leitura do próprio; escrita somente por funções
-- ---------------------------------------------------------------------
alter table public.simulados enable row level security;
alter table public.simulados_questoes enable row level security;
alter table public.simulados_gabaritos enable row level security;
alter table public.simulados_tentativas enable row level security;
alter table public.simulados_respostas enable row level security;
alter table public.simulados_resultados enable row level security;

create policy "simulados: leitura própria" on public.simulados for select to authenticated
  using (user_id = (select auth.uid()));
create policy "simulados: atualização própria" on public.simulados for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "simulados: exclusão própria" on public.simulados for delete to authenticated
  using (user_id = (select auth.uid())
         and not exists (select 1 from public.simulados_tentativas t
                         where t.simulado_id = simulados.id and t.status in ('concluida', 'interrompida')));
revoke update on public.simulados from authenticated;
grant update (nome, status) on public.simulados to authenticated;

create policy "simulados_questoes: leitura própria" on public.simulados_questoes for select to authenticated
  using (exists (select 1 from public.simulados s where s.id = simulado_id and s.user_id = (select auth.uid())));
create policy "gabaritos de simulado: admin" on public.simulados_gabaritos for select to authenticated
  using (public.is_admin());
create policy "tentativas: leitura própria" on public.simulados_tentativas for select to authenticated
  using (user_id = (select auth.uid()));
create policy "respostas de simulado: leitura própria" on public.simulados_respostas for select to authenticated
  using (exists (select 1 from public.simulados_tentativas t where t.id = tentativa_id and t.user_id = (select auth.uid())));
create policy "resultados: leitura própria" on public.simulados_resultados for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Criação
-- ---------------------------------------------------------------------
create or replace function public.criar_simulado(p_dados jsonb, p_questoes uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total int := coalesce(cardinality(p_questoes), 0);
  v_validas int;
  v_regra public.simulados_regras_pontuacao;
  v_acerto numeric;
  v_erro numeric;
  v_branco numeric;
  v_nao_negativa boolean;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;
  if v_total < 1 or v_total > 300 then
    raise exception 'O simulado deve ter entre 1 e 300 questões' using errcode = '22023';
  end if;
  if (select count(distinct q) from unnest(p_questoes) q) <> v_total then
    raise exception 'Questões repetidas no simulado' using errcode = '22023';
  end if;

  select count(*) into v_validas from public.questoes q
  where q.id = any (p_questoes) and q.status = 'aprovada' and (q.owner_id is null or q.owner_id = v_uid)
    and exists (select 1 from public.questao_gabaritos g where g.questao_id = q.id);
  if v_validas <> v_total then
    raise exception 'Há questões indisponíveis ou não aprovadas na seleção' using errcode = '22023';
  end if;

  if nullif(p_dados ->> 'regra_pontuacao_id', '') is not null then
    select * into v_regra from public.simulados_regras_pontuacao r
    where r.id = (p_dados ->> 'regra_pontuacao_id')::uuid and (r.owner_id is null or r.owner_id = v_uid);
    if not found then
      raise exception 'Regra de pontuação inválida' using errcode = '22023';
    end if;
    v_acerto := v_regra.pontos_acerto; v_erro := v_regra.pontos_erro;
    v_branco := v_regra.pontos_branco; v_nao_negativa := v_regra.nota_nao_negativa;
  else
    v_acerto := coalesce((p_dados ->> 'pontos_acerto')::numeric, 1);
    v_erro := coalesce((p_dados ->> 'pontos_erro')::numeric, 0);
    v_branco := coalesce((p_dados ->> 'pontos_branco')::numeric, 0);
    v_nao_negativa := coalesce((p_dados ->> 'nota_nao_negativa')::boolean, true);
  end if;
  if v_acerto <= 0 then
    raise exception 'A pontuação por acerto deve ser positiva' using errcode = '22023';
  end if;

  insert into public.simulados (user_id, nome, tipo, concurso_id, banca_estilo_id, edital_id, config, total_questoes,
    tempo_limite_seg, permite_pausa, ordem, mostrar_gabarito_durante, finalizar_ao_esgotar, regra_pontuacao_id,
    pontos_acerto, pontos_erro, pontos_branco, nota_nao_negativa, agendamento_id, observacoes_geracao)
  values (v_uid, coalesce(nullif(trim(p_dados ->> 'nome'), ''), 'Simulado'), coalesce(p_dados ->> 'tipo', 'personalizado'),
    nullif(p_dados ->> 'concurso_id', '')::uuid, nullif(p_dados ->> 'banca_estilo_id', '')::uuid,
    nullif(p_dados ->> 'edital_id', '')::uuid, coalesce(p_dados -> 'config', '{}'), v_total,
    nullif(p_dados ->> 'tempo_limite_seg', '')::int, coalesce((p_dados ->> 'permite_pausa')::boolean, false),
    coalesce(p_dados ->> 'ordem', 'aleatoria'), coalesce((p_dados ->> 'mostrar_gabarito_durante')::boolean, false),
    coalesce((p_dados ->> 'finalizar_ao_esgotar')::boolean, true), v_regra.id,
    v_acerto, v_erro, v_branco, v_nao_negativa,
    (select a.id from public.simulados_agendamentos a where a.id = nullif(p_dados ->> 'agendamento_id', '')::uuid and a.user_id = v_uid),
    coalesce(p_dados -> 'observacoes_geracao', '[]'))
  returning id into v_id;

  insert into public.simulados_questoes (simulado_id, ordem, questao_id, disciplina_id, assunto_id, dificuldade)
  select v_id, o.ordem, q.id, q.disciplina_id, q.assunto_id, q.dificuldade
  from unnest(p_questoes) with ordinality as o(questao_id, ordem)
  join public.questoes q on q.id = o.questao_id;

  insert into public.simulados_gabaritos (simulado_id, questao_id, alternativa_correta_id, snapshot)
  select v_id, q.id, g.alternativa_correta_id,
    jsonb_build_object(
      'questao_id', q.id, 'tipo', q.tipo, 'enunciado', q.enunciado, 'texto_apoio', q.texto_apoio,
      'dificuldade', q.dificuldade, 'origem', q.origem, 'estilo', q.estilo,
      'disciplina', jsonb_build_object('id', d.id, 'nome', d.nome),
      'assunto', case when a.id is null then null else jsonb_build_object('id', a.id, 'nome', a.nome) end,
      'subassunto', case when sa.id is null then null else jsonb_build_object('id', sa.id, 'nome', sa.nome) end,
      'banca_estilo', b.sigla,
      'alternativas', (select jsonb_agg(jsonb_build_object('id', al.id, 'letra', al.letra, 'texto', al.texto) order by al.ordem)
                       from public.alternativas al where al.questao_id = q.id),
      'gabarito', jsonb_build_object('alternativa_correta_id', g.alternativa_correta_id,
                                     'explicacao', g.explicacao, 'justificativas', g.justificativas),
      'fontes', coalesce((select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'material_id', f.material_id, 'pagina', f.pagina,
                                                              'trecho', f.trecho, 'descricao', f.descricao, 'material_titulo', m.titulo))
                          from public.questao_fontes f left join public.materiais m on m.id = f.material_id
                          where f.questao_id = q.id), '[]'::jsonb))
  from public.questoes q
  join public.questao_gabaritos g on g.questao_id = q.id
  join public.disciplinas d on d.id = q.disciplina_id
  left join public.assuntos a on a.id = q.assunto_id
  left join public.subassuntos sa on sa.id = q.subassunto_id
  left join public.bancas b on b.id = q.banca_estilo_id
  where q.id = any (p_questoes);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Correção (interna)
-- ---------------------------------------------------------------------
create or replace function public.finalizar_tentativa_interna(p_tentativa_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.simulados_tentativas;
  v_s public.simulados;
  v_fim timestamptz;
  v_tempo int;
  v_total int;
  v_acertos int;
  v_erros int;
  v_brancos int;
  v_nota numeric;
  v_resultado public.simulados_resultados;
  v_itens jsonb;
  v_resp record;
  v_tentativa_numero int;
begin
  select * into v_t from public.simulados_tentativas where id = p_tentativa_id for update;
  if not found then
    raise exception 'Tentativa não encontrada' using errcode = 'P0002';
  end if;
  if v_t.status in ('concluida', 'interrompida') then
    select * into v_resultado from public.simulados_resultados where tentativa_id = p_tentativa_id;
    return to_jsonb(v_resultado);
  end if;
  select * into v_s from public.simulados where id = v_t.simulado_id;

  v_fim := now();
  if v_t.status = 'pausada' and v_t.pausada_em is not null then
    v_t.tempo_pausado_seg := v_t.tempo_pausado_seg + extract(epoch from (v_fim - v_t.pausada_em))::int;
  end if;
  if v_t.prazo_em is not null and v_fim > v_t.prazo_em then
    v_fim := v_t.prazo_em;
  end if;
  v_tempo := greatest(0, extract(epoch from (v_fim - v_t.iniciada_em))::int - v_t.tempo_pausado_seg);
  if v_s.tempo_limite_seg is not null then
    v_tempo := least(v_tempo, v_s.tempo_limite_seg);
  end if;

  -- Uma linha por questão: resposta dada × gabarito da cópia do simulado.
  select coalesce(jsonb_agg(jsonb_build_object(
           'questao_id', g.questao_id, 'alternativa_id', r.alternativa_id, 'correta_id', g.alternativa_correta_id,
           'resultado', case when r.alternativa_id is null then 'branco'
                             when r.alternativa_id = g.alternativa_correta_id then 'acerto' else 'erro' end,
           'tempo', coalesce(r.tempo_seg, 0),
           'disciplina_id', g.snapshot -> 'disciplina' ->> 'id', 'disciplina_nome', g.snapshot -> 'disciplina' ->> 'nome',
           'assunto_id', g.snapshot -> 'assunto' ->> 'id',
           'assunto_nome', coalesce(g.snapshot -> 'assunto' ->> 'nome', 'Sem assunto'),
           'subassunto_id', g.snapshot -> 'subassunto' ->> 'id',
           'dificuldade', g.snapshot ->> 'dificuldade')), '[]'::jsonb)
    into v_itens
  from public.simulados_gabaritos g
  left join public.simulados_respostas r on r.tentativa_id = p_tentativa_id and r.questao_id = g.questao_id
  where g.simulado_id = v_t.simulado_id;

  select count(*), count(*) filter (where i ->> 'resultado' = 'acerto'), count(*) filter (where i ->> 'resultado' = 'erro'),
         count(*) filter (where i ->> 'resultado' = 'branco')
    into v_total, v_acertos, v_erros, v_brancos
  from jsonb_array_elements(v_itens) i;

  v_nota := v_acertos * v_s.pontos_acerto + v_erros * v_s.pontos_erro + v_brancos * v_s.pontos_branco;
  if v_s.nota_nao_negativa and v_nota < 0 then
    v_nota := 0;
  end if;

  insert into public.simulados_resultados (tentativa_id, simulado_id, user_id, total, respondidas, acertos, erros, brancos,
    percentual_acerto, percentual_acerto_total, nota, nota_maxima, tempo_total_seg, tempo_medio_seg,
    por_disciplina, por_assunto, por_dificuldade, regra)
  values (p_tentativa_id, v_t.simulado_id, v_t.user_id, v_total, v_acertos + v_erros, v_acertos, v_erros, v_brancos,
    case when v_acertos + v_erros > 0 then round(100.0 * v_acertos / (v_acertos + v_erros), 2) end,
    case when v_total > 0 then round(100.0 * v_acertos / v_total, 2) else 0 end,
    round(v_nota, 2), round(v_total * v_s.pontos_acerto, 2), v_tempo,
    case when v_total > 0 then round(v_tempo::numeric / v_total, 2) else 0 end,
    coalesce((select jsonb_agg(x order by x ->> 'nome') from (
      select jsonb_build_object('id', i ->> 'disciplina_id', 'nome', i ->> 'disciplina_nome', 'total', count(*),
        'acertos', count(*) filter (where i ->> 'resultado' = 'acerto'),
        'erros', count(*) filter (where i ->> 'resultado' = 'erro'),
        'brancos', count(*) filter (where i ->> 'resultado' = 'branco')) x
      from jsonb_array_elements(v_itens) i group by i ->> 'disciplina_id', i ->> 'disciplina_nome') d), '[]'),
    coalesce((select jsonb_agg(x order by x ->> 'nome') from (
      select jsonb_build_object('id', i ->> 'assunto_id', 'nome', i ->> 'assunto_nome', 'disciplina_id', i ->> 'disciplina_id',
        'total', count(*),
        'acertos', count(*) filter (where i ->> 'resultado' = 'acerto'),
        'erros', count(*) filter (where i ->> 'resultado' = 'erro'),
        'brancos', count(*) filter (where i ->> 'resultado' = 'branco')) x
      from jsonb_array_elements(v_itens) i group by i ->> 'assunto_id', i ->> 'assunto_nome', i ->> 'disciplina_id') a), '[]'),
    coalesce((select jsonb_agg(x order by x ->> 'dificuldade') from (
      select jsonb_build_object('dificuldade', i ->> 'dificuldade', 'total', count(*),
        'acertos', count(*) filter (where i ->> 'resultado' = 'acerto'),
        'erros', count(*) filter (where i ->> 'resultado' = 'erro'),
        'brancos', count(*) filter (where i ->> 'resultado' = 'branco')) x
      from jsonb_array_elements(v_itens) i group by i ->> 'dificuldade') f), '[]'),
    jsonb_build_object('pontos_acerto', v_s.pontos_acerto, 'pontos_erro', v_s.pontos_erro,
                       'pontos_branco', v_s.pontos_branco, 'nota_nao_negativa', v_s.nota_nao_negativa))
  returning * into v_resultado;

  update public.simulados_tentativas set
    status = case when p_motivo = 'interrompida' then 'interrompida' else 'concluida' end,
    finalizacao = p_motivo, finalizada_em = now(), pausada_em = null,
    tempo_pausado_seg = v_t.tempo_pausado_seg, ultima_atividade_em = now()
  where id = p_tentativa_id;

  -- As respostas entram no histórico geral (caderno de erros e desempenho via gatilho).
  for v_resp in select i from jsonb_array_elements(v_itens) i where i ->> 'resultado' <> 'branco' loop
    perform pg_advisory_xact_lock(hashtextextended(v_t.user_id::text || (v_resp.i ->> 'questao_id'), 0));
    select coalesce(max(tentativa_numero), 0) + 1 into v_tentativa_numero
    from public.respostas_usuario where user_id = v_t.user_id and questao_id = (v_resp.i ->> 'questao_id')::uuid;
    insert into public.respostas_usuario (user_id, questao_id, alternativa_id, alternativa_correta_id, correta, tempo_seg,
      tentativa_numero, contexto, simulado_tentativa_id, disciplina_id, assunto_id, subassunto_id, dificuldade)
    values (v_t.user_id, (v_resp.i ->> 'questao_id')::uuid, (v_resp.i ->> 'alternativa_id')::uuid,
      (v_resp.i ->> 'correta_id')::uuid, v_resp.i ->> 'resultado' = 'acerto', (v_resp.i ->> 'tempo')::int,
      v_tentativa_numero, 'simulado', p_tentativa_id, (v_resp.i ->> 'disciplina_id')::uuid,
      (v_resp.i ->> 'assunto_id')::uuid, (v_resp.i ->> 'subassunto_id')::uuid, v_resp.i ->> 'dificuldade');
  end loop;

  return to_jsonb(v_resultado);
end;
$$;
revoke execute on function public.finalizar_tentativa_interna(uuid, text) from public, anon, authenticated;

-- Encerra tentativas cujo prazo acabou (com tolerância de rede de 20 s).
create or replace function public.verificar_expiracao(p_tentativa_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.simulados_tentativas;
  v_auto boolean;
begin
  select * into v_t from public.simulados_tentativas where id = p_tentativa_id;
  if not found then
    return false;
  end if;
  select finalizar_ao_esgotar into v_auto from public.simulados where id = v_t.simulado_id;
  -- Pausada não expira: o prazo é estendido ao retomar.
  if v_t.status = 'em_andamento' and v_t.prazo_em is not null and v_auto
     and now() > v_t.prazo_em + interval '20 seconds' then
    perform public.finalizar_tentativa_interna(p_tentativa_id, 'tempo_esgotado');
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.verificar_expiracao(uuid) from public, anon, authenticated;

-- Para o agendador: finaliza todas as tentativas expiradas.
create or replace function public.finalizar_tentativas_expiradas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  for v_id in select t.id from public.simulados_tentativas t join public.simulados s on s.id = t.simulado_id
              where t.status = 'em_andamento' and t.prazo_em is not null and s.finalizar_ao_esgotar
                and now() > t.prazo_em + interval '20 seconds' loop
    perform public.finalizar_tentativa_interna(v_id, 'tempo_esgotado');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.finalizar_tentativas_expiradas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- API do aluno
-- ---------------------------------------------------------------------
create or replace function public.iniciar_tentativa(p_simulado_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.simulados;
  v_ativa uuid;
  v_id uuid;
begin
  select * into v_s from public.simulados where id = p_simulado_id and user_id = v_uid;
  if not found then
    raise exception 'Simulado não encontrado' using errcode = 'P0002';
  end if;
  if v_s.status = 'arquivado' then
    raise exception 'Simulado arquivado' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_simulado_id::text, 0));
  select id into v_ativa from public.simulados_tentativas
  where simulado_id = p_simulado_id and status in ('em_andamento', 'pausada');
  if v_ativa is not null then
    if not public.verificar_expiracao(v_ativa) then
      return v_ativa;
    end if;
  end if;

  insert into public.simulados_tentativas (simulado_id, user_id, numero, prazo_em)
  values (p_simulado_id, v_uid,
    (select coalesce(max(numero), 0) + 1 from public.simulados_tentativas where simulado_id = p_simulado_id),
    case when v_s.tempo_limite_seg is not null then now() + make_interval(secs => v_s.tempo_limite_seg) end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.obter_prova(p_tentativa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_t public.simulados_tentativas;
  v_s public.simulados;
begin
  select * into v_t from public.simulados_tentativas where id = p_tentativa_id and user_id = v_uid;
  if not found then
    raise exception 'Tentativa não encontrada' using errcode = 'P0002';
  end if;
  perform public.verificar_expiracao(p_tentativa_id);
  select * into v_t from public.simulados_tentativas where id = p_tentativa_id;
  select * into v_s from public.simulados where id = v_t.simulado_id;

  return jsonb_build_object(
    'agora', now(),
    'tentativa', to_jsonb(v_t),
    'simulado', jsonb_build_object('id', v_s.id, 'nome', v_s.nome, 'tipo', v_s.tipo, 'total_questoes', v_s.total_questoes,
      'tempo_limite_seg', v_s.tempo_limite_seg, 'permite_pausa', v_s.permite_pausa,
      'mostrar_gabarito_durante', v_s.mostrar_gabarito_durante, 'finalizar_ao_esgotar', v_s.finalizar_ao_esgotar,
      'pontos_acerto', v_s.pontos_acerto, 'pontos_erro', v_s.pontos_erro, 'pontos_branco', v_s.pontos_branco),
    'questoes', (
      select jsonb_agg((g.snapshot - 'gabarito' - 'fontes') || jsonb_build_object('ordem', sq.ordem) order by sq.ordem)
      from public.simulados_questoes sq
      join public.simulados_gabaritos g on g.simulado_id = sq.simulado_id and g.questao_id = sq.questao_id
      where sq.simulado_id = v_s.id),
    'respostas', coalesce((
      select jsonb_agg(jsonb_build_object('questao_id', r.questao_id, 'alternativa_id', r.alternativa_id,
        'marcada_revisao', r.marcada_revisao, 'tempo_seg', r.tempo_seg)
        || case when v_s.mostrar_gabarito_durante and r.alternativa_id is not null
                then jsonb_build_object('gabarito', g.snapshot -> 'gabarito') else '{}'::jsonb end)
      from public.simulados_respostas r
      join public.simulados_gabaritos g on g.simulado_id = v_s.id and g.questao_id = r.questao_id
      where r.tentativa_id = p_tentativa_id), '[]'::jsonb));
end;
$$;

create or replace function public.salvar_resposta_simulado(
  p_tentativa_id uuid,
  p_questao_id uuid,
  p_alternativa_id uuid,
  p_marcada_revisao boolean default false,
  p_tempo_seg int default 0,
  p_questao_atual int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_t public.simulados_tentativas;
  v_s public.simulados;
  v_g public.simulados_gabaritos;
  v_anterior uuid;
begin
  select * into v_t from public.simulados_tentativas where id = p_tentativa_id and user_id = v_uid for update;
  if not found then
    raise exception 'Tentativa não encontrada' using errcode = 'P0002';
  end if;
  -- Retorna em vez de lançar erro: uma exceção desfaria a entrega automática.
  if public.verificar_expiracao(p_tentativa_id) then
    return jsonb_build_object('salvo', false, 'expirado', true, 'agora', now());
  end if;
  if v_t.status <> 'em_andamento' then
    raise exception 'A prova não está em andamento' using errcode = '55000';
  end if;
  select * into v_s from public.simulados where id = v_t.simulado_id;

  select * into v_g from public.simulados_gabaritos where simulado_id = v_s.id and questao_id = p_questao_id;
  if not found then
    raise exception 'Questão não pertence ao simulado' using errcode = '22023';
  end if;
  if p_alternativa_id is not null and not exists (
       select 1 from jsonb_array_elements(v_g.snapshot -> 'alternativas') a where (a ->> 'id')::uuid = p_alternativa_id) then
    raise exception 'Alternativa inválida' using errcode = '22023';
  end if;

  select alternativa_id into v_anterior from public.simulados_respostas
  where tentativa_id = p_tentativa_id and questao_id = p_questao_id;
  -- Com gabarito exibido durante a prova, a resposta não pode ser trocada depois de vista.
  if v_s.mostrar_gabarito_durante and v_anterior is not null and p_alternativa_id is distinct from v_anterior then
    raise exception 'Resposta já corrigida; não pode ser alterada' using errcode = '55000';
  end if;

  insert into public.simulados_respostas as r (tentativa_id, questao_id, alternativa_id, marcada_revisao, tempo_seg, respondida_em)
  values (p_tentativa_id, p_questao_id, p_alternativa_id, coalesce(p_marcada_revisao, false),
          least(greatest(coalesce(p_tempo_seg, 0), 0), 86400), case when p_alternativa_id is not null then now() end)
  on conflict (tentativa_id, questao_id) do update set
    alternativa_id = excluded.alternativa_id,
    marcada_revisao = excluded.marcada_revisao,
    tempo_seg = greatest(r.tempo_seg, excluded.tempo_seg),
    respondida_em = coalesce(excluded.respondida_em, r.respondida_em),
    updated_at = now();

  update public.simulados_tentativas set ultima_atividade_em = now(),
    questao_atual = coalesce(p_questao_atual, questao_atual)
  where id = p_tentativa_id;

  return jsonb_build_object('salvo', true, 'expirado', false, 'agora', now())
    || case when v_s.mostrar_gabarito_durante and p_alternativa_id is not null
            then jsonb_build_object('gabarito', v_g.snapshot -> 'gabarito') else '{}'::jsonb end;
end;
$$;

create or replace function public.pausar_tentativa(p_tentativa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permite boolean;
begin
  select s.permite_pausa into v_permite from public.simulados_tentativas t join public.simulados s on s.id = t.simulado_id
  where t.id = p_tentativa_id and t.user_id = auth.uid() and t.status = 'em_andamento';
  if not found then
    raise exception 'Tentativa não está em andamento' using errcode = '55000';
  end if;
  if not v_permite then
    raise exception 'Este simulado não permite pausa' using errcode = '55000';
  end if;
  if public.verificar_expiracao(p_tentativa_id) then
    return jsonb_build_object('pausada', false, 'expirado', true);
  end if;
  update public.simulados_tentativas set status = 'pausada', pausada_em = now() where id = p_tentativa_id;
  return jsonb_build_object('pausada', true, 'expirado', false);
end;
$$;

create or replace function public.retomar_tentativa(p_tentativa_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.simulados_tentativas;
  v_pausa int;
begin
  select * into v_t from public.simulados_tentativas
  where id = p_tentativa_id and user_id = auth.uid() and status = 'pausada' for update;
  if not found then
    raise exception 'Tentativa não está pausada' using errcode = '55000';
  end if;
  v_pausa := greatest(0, extract(epoch from (now() - v_t.pausada_em))::int);
  update public.simulados_tentativas set
    status = 'em_andamento', pausada_em = null,
    tempo_pausado_seg = tempo_pausado_seg + v_pausa,
    prazo_em = case when prazo_em is not null then prazo_em + make_interval(secs => v_pausa) end,
    ultima_atividade_em = now()
  where id = p_tentativa_id;
end;
$$;

create or replace function public.finalizar_tentativa(p_tentativa_id uuid, p_interromper boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.simulados_tentativas where id = p_tentativa_id and user_id = auth.uid()) then
    raise exception 'Tentativa não encontrada' using errcode = 'P0002';
  end if;
  if public.verificar_expiracao(p_tentativa_id) then
    return (select to_jsonb(r) from public.simulados_resultados r where r.tentativa_id = p_tentativa_id);
  end if;
  return public.finalizar_tentativa_interna(p_tentativa_id, case when p_interromper then 'interrompida' else 'manual' end);
end;
$$;

-- Correção comentada: disponível somente depois da entrega.
create or replace function public.obter_correcao_simulado(p_tentativa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.simulados_tentativas;
begin
  select * into v_t from public.simulados_tentativas where id = p_tentativa_id and user_id = auth.uid();
  if not found then
    raise exception 'Tentativa não encontrada' using errcode = 'P0002';
  end if;
  if v_t.status not in ('concluida', 'interrompida') then
    raise exception 'A correção fica disponível após a entrega' using errcode = '55000';
  end if;
  return jsonb_build_object(
    'tentativa', to_jsonb(v_t),
    'resultado', (select to_jsonb(r) from public.simulados_resultados r where r.tentativa_id = p_tentativa_id),
    'questoes', (
      select jsonb_agg(g.snapshot || jsonb_build_object(
          'ordem', sq.ordem,
          'resposta', jsonb_build_object('alternativa_id', r.alternativa_id, 'marcada_revisao', coalesce(r.marcada_revisao, false),
                                         'tempo_seg', coalesce(r.tempo_seg, 0)),
          'resultado', case when r.alternativa_id is null then 'branco'
                            when r.alternativa_id = g.alternativa_correta_id then 'acerto' else 'erro' end)
        order by sq.ordem)
      from public.simulados_questoes sq
      join public.simulados_gabaritos g on g.simulado_id = sq.simulado_id and g.questao_id = sq.questao_id
      left join public.simulados_respostas r on r.tentativa_id = p_tentativa_id and r.questao_id = sq.questao_id
      where sq.simulado_id = v_t.simulado_id));
end;
$$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000500', 'simulados') on conflict do nothing;

-- >>> 20261015000600_planejamento.sql

-- =====================================================================
-- Planejamento: cronograma, disponibilidade, atividades, sessões e metas
-- =====================================================================

create table public.cronogramas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nome text not null default 'Meu cronograma',
  concurso_id uuid references public.concursos (id) on delete set null,
  data_inicio date not null default current_date,
  data_fim date,
  ativo boolean not null default true,
  -- Parâmetros usados pelo gerador (distribuição, duração dos blocos etc.).
  parametros jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_fim is null or data_fim >= data_inicio)
);
create unique index cronogramas_um_ativo on public.cronogramas (user_id) where ativo;
create trigger cronogramas_updated_at before update on public.cronogramas
  for each row execute function public.definir_updated_at();

-- Janelas semanais em minutos desde 00:00 (0–1440).
create table public.disponibilidade_semanal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  inicio_min smallint not null check (inicio_min between 0 and 1439),
  fim_min smallint not null check (fim_min between 1 and 1440),
  created_at timestamptz not null default now(),
  check (fim_min > inicio_min),
  constraint disponibilidade_sem_sobreposicao exclude using gist (
    user_id with =, dia_semana with =, int4range(inicio_min, fim_min) with &&)
);

-- Indisponibilidades pontuais (viagem, compromisso, descanso extra).
create table public.bloqueios_agenda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text,
  created_at timestamptz not null default now(),
  check (fim > inicio)
);
create index bloqueios_agenda_user_idx on public.bloqueios_agenda (user_id, inicio);

create table public.atividades_planejadas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- set null: apagar um cronograma não apaga estudos já feitos.
  cronograma_id uuid references public.cronogramas (id) on delete set null,
  tipo text not null check (tipo in ('leitura', 'questoes', 'revisao', 'flashcards', 'simulado', 'correcao_erros', 'outro')),
  titulo text not null check (char_length(titulo) between 1 and 200),
  descricao text,
  disciplina_id uuid references public.disciplinas (id) on delete set null,
  assunto_id uuid references public.assuntos (id) on delete set null,
  material_id uuid references public.materiais (id) on delete set null,
  pagina_inicio int check (pagina_inicio >= 1),
  pagina_fim int,
  simulado_id uuid references public.simulados (id) on delete set null,
  quantidade_questoes int check (quantidade_questoes > 0),
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'planejada'
    check (status in ('planejada', 'em_andamento', 'concluida', 'parcial', 'nao_realizada', 'cancelada', 'reagendada')),
  prioridade smallint not null default 3 check (prioridade between 1 and 5),
  origem text not null default 'gerador'
    check (origem in ('gerador', 'replanejamento', 'manual', 'recomendacao', 'simulado', 'revisao')),
  reagendada_de uuid references public.atividades_planejadas (id) on delete set null,
  concluida_em timestamptz,
  tempo_realizado_seg int not null default 0 check (tempo_realizado_seg >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fim > inicio),
  check (fim - inicio <= interval '12 hours'),
  check (pagina_fim is null or pagina_inicio is null or pagina_fim >= pagina_inicio),
  -- Regra de negócio: o cronograma não pode ter horários sobrepostos.
  constraint atividades_sem_sobreposicao exclude using gist (
    user_id with =, tstzrange(inicio, fim) with &&) where (status in ('planejada', 'em_andamento'))
);
create index atividades_user_periodo_idx on public.atividades_planejadas (user_id, inicio);
create index atividades_status_idx on public.atividades_planejadas (user_id, status, inicio);
create trigger atividades_updated_at before update on public.atividades_planejadas
  for each row execute function public.definir_updated_at();

-- Estudos concluídos não podem ser apagados por alterações no planejamento.
create or replace function public.proteger_atividade_concluida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('concluida', 'parcial') and current_user in ('authenticated', 'anon') then
    raise exception 'Atividades concluídas não podem ser excluídas' using errcode = '55000';
  end if;
  return old;
end;
$$;
create trigger atividades_proteger_concluida before delete on public.atividades_planejadas
  for each row execute function public.proteger_atividade_concluida();

create table public.sessoes_estudo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  atividade_id uuid references public.atividades_planejadas (id) on delete set null,
  tipo text not null check (tipo in ('leitura', 'questoes', 'revisao', 'flashcards', 'simulado', 'pomodoro', 'outro')),
  disciplina_id uuid references public.disciplinas (id) on delete set null,
  assunto_id uuid references public.assuntos (id) on delete set null,
  material_id uuid references public.materiais (id) on delete set null,
  inicio timestamptz not null,
  fim timestamptz not null,
  duracao_seg int generated always as (extract(epoch from (fim - inicio))::int) stored,
  pomodoros smallint not null default 0 check (pomodoros >= 0),
  origem text not null default 'manual' check (origem in ('pomodoro', 'manual', 'leitor', 'questoes', 'simulado', 'revisao')),
  notas text check (char_length(notas) <= 2000),
  created_at timestamptz not null default now(),
  check (fim > inicio),
  check (fim - inicio <= interval '16 hours')
);
create index sessoes_estudo_user_idx on public.sessoes_estudo (user_id, inicio);

create table public.metas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  periodo text not null check (periodo in ('diaria', 'semanal', 'mensal')),
  tipo text not null check (tipo in ('questoes', 'horas', 'simulados', 'revisoes', 'paginas', 'flashcards')),
  alvo numeric(10, 2) not null check (alvo > 0),
  disciplina_id uuid references public.disciplinas (id) on delete cascade,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index metas_unica_ativa on public.metas (user_id, periodo, tipo, coalesce(disciplina_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ativa;
create trigger metas_updated_at before update on public.metas
  for each row execute function public.definir_updated_at();

create table public.replanejamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  atividade_id uuid not null references public.atividades_planejadas (id) on delete cascade,
  motivo text not null,
  proposta_inicio timestamptz not null,
  proposta_fim timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'rejeitada', 'modificada', 'expirada')),
  resolvida_em timestamptz,
  created_at timestamptz not null default now(),
  check (proposta_fim > proposta_inicio)
);
create index replanejamentos_user_idx on public.replanejamentos (user_id, status);

-- ---------------------------------------------------------------------
-- RLS: dono
-- ---------------------------------------------------------------------
do $$
declare
  tabela text;
begin
  foreach tabela in array array['cronogramas', 'disponibilidade_semanal', 'bloqueios_agenda', 'atividades_planejadas',
                                'sessoes_estudo', 'metas', 'replanejamentos']
  loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('create policy "%1$s: dono" on public.%1$I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', tabela);
  end loop;
end $$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000600', 'planejamento') on conflict do nothing;

-- >>> 20261015000700_revisoes_flashcards.sql

-- =====================================================================
-- Revisões espaçadas e flashcards
-- O cálculo dos intervalos (SM-2 adaptado) fica em src/lib/estudo/srs.ts.
-- =====================================================================

create table public.revisoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('assunto', 'questao', 'secao')),
  assunto_id uuid references public.assuntos (id) on delete cascade,
  questao_id uuid references public.questoes (id) on delete cascade,
  secao_id uuid references public.material_secoes (id) on delete cascade,
  titulo text not null,
  facilidade numeric(4, 2) not null default 2.5 check (facilidade between 1.3 and 3.5),
  intervalo_dias int not null default 0 check (intervalo_dias between 0 and 3650),
  repeticoes int not null default 0 check (repeticoes >= 0),
  lapsos int not null default 0 check (lapsos >= 0),
  proxima_em date not null,
  ultima_em timestamptz,
  status text not null default 'ativa' check (status in ('ativa', 'suspensa', 'concluida')),
  origem text not null default 'manual' check (origem in ('manual', 'erro', 'simulado', 'leitura', 'cronograma')),
  alvo_chave text generated always as (alvo_tipo || ':' || coalesce(assunto_id, questao_id, secao_id)::text) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (alvo_tipo = 'assunto' and assunto_id is not null and questao_id is null and secao_id is null) or
    (alvo_tipo = 'questao' and questao_id is not null and secao_id is null) or
    (alvo_tipo = 'secao' and secao_id is not null and questao_id is null)
  )
);
-- Evita revisões duplicadas do mesmo alvo.
create unique index revisoes_alvo_ativo on public.revisoes (user_id, alvo_chave) where status = 'ativa';
create index revisoes_pendentes_idx on public.revisoes (user_id, status, proxima_em);
create trigger revisoes_updated_at before update on public.revisoes
  for each row execute function public.definir_updated_at();

create table public.revisao_historico (
  id uuid primary key default gen_random_uuid(),
  revisao_id uuid not null references public.revisoes (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  avaliacao text not null check (avaliacao in ('nao_lembrei', 'dificil', 'bom', 'facil')),
  intervalo_anterior int not null,
  intervalo_novo int not null,
  facilidade_nova numeric(4, 2) not null,
  created_at timestamptz not null default now()
);
create index revisao_historico_user_idx on public.revisao_historico (user_id, created_at);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  frente text not null check (char_length(frente) between 1 and 2000),
  verso text not null check (char_length(verso) between 1 and 4000),
  disciplina_id uuid references public.disciplinas (id) on delete set null,
  assunto_id uuid references public.assuntos (id) on delete set null,
  material_id uuid references public.materiais (id) on delete set null,
  pagina int check (pagina >= 1),
  questao_id uuid references public.questoes (id) on delete set null,
  origem text not null default 'manual' check (origem in ('manual', 'ia', 'trecho_pdf', 'questao', 'erro')),
  facilidade numeric(4, 2) not null default 2.5 check (facilidade between 1.3 and 3.5),
  intervalo_dias int not null default 0 check (intervalo_dias between 0 and 3650),
  repeticoes int not null default 0,
  lapsos int not null default 0,
  proxima_em date not null default current_date,
  ultima_em timestamptz,
  suspenso boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flashcards_pendentes_idx on public.flashcards (user_id, suspenso, proxima_em);
create index flashcards_assunto_idx on public.flashcards (user_id, disciplina_id, assunto_id);
create trigger flashcards_updated_at before update on public.flashcards
  for each row execute function public.definir_updated_at();

create table public.flashcard_revisoes (
  id uuid primary key default gen_random_uuid(),
  flashcard_id uuid not null references public.flashcards (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  avaliacao text not null check (avaliacao in ('nao_lembrei', 'dificil', 'bom', 'facil')),
  intervalo_anterior int not null,
  intervalo_novo int not null,
  tempo_ms int check (tempo_ms between 0 and 3600000),
  created_at timestamptz not null default now()
);
create index flashcard_revisoes_user_idx on public.flashcard_revisoes (user_id, created_at);

do $$
declare
  tabela text;
begin
  foreach tabela in array array['revisoes', 'revisao_historico', 'flashcards', 'flashcard_revisoes']
  loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('create policy "%1$s: dono" on public.%1$I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', tabela);
  end loop;
end $$;

-- Revisão de questão só para questões visíveis ao usuário.
create or replace function public.validar_alvo_revisao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.questao_id is not null and not exists (
       select 1 from public.questoes q where q.id = new.questao_id and public.pode_ver_questao(q.owner_id, q.status)) then
    raise exception 'Questão indisponível' using errcode = '42501';
  end if;
  if new.secao_id is not null and not exists (
       select 1 from public.material_secoes s where s.id = new.secao_id and s.user_id = new.user_id) then
    raise exception 'Seção indisponível' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger revisoes_validar_alvo before insert or update on public.revisoes
  for each row execute function public.validar_alvo_revisao();

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000700', 'revisoes_flashcards') on conflict do nothing;

-- >>> 20261015000800_inteligencia.sql

-- =====================================================================
-- Inteligência, relatórios, notificações, busca e consultas analíticas
-- =====================================================================

-- Toda chamada de IA é registrada (estado, tokens, custo estimado).
-- Escrita só pelo servidor (chave secreta), para que o orçamento não possa ser burlado.
create table public.processamentos_ia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('gerar_questoes', 'validar_questao', 'classificar_material', 'tutor',
                                     'analise_desempenho', 'gerar_flashcards', 'gerar_simulado', 'relatorio', 'edital')),
  status text not null default 'pendente' check (status in ('pendente', 'executando', 'concluido', 'falhou', 'cancelado')),
  provedor text,
  modelo text,
  parametros jsonb not null default '{}',
  entrada_hash text,
  resultado jsonb,
  progresso jsonb not null default '{}',
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  custo_estimado_usd numeric(12, 6) not null default 0,
  erro text,
  tentativas int not null default 0,
  iniciado_em timestamptz,
  concluido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index processamentos_ia_user_idx on public.processamentos_ia (user_id, created_at desc);
create index processamentos_ia_cache_idx on public.processamentos_ia (user_id, tipo, entrada_hash) where status = 'concluido';
create trigger processamentos_ia_updated_at before update on public.processamentos_ia
  for each row execute function public.definir_updated_at();
alter table public.processamentos_ia enable row level security;
create policy "processamentos: leitura própria" on public.processamentos_ia for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create table public.tutor_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  titulo text not null default 'Nova conversa',
  contexto jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tutor_conversas_user_idx on public.tutor_conversas (user_id, updated_at desc);
create trigger tutor_conversas_updated_at before update on public.tutor_conversas
  for each row execute function public.definir_updated_at();

create table public.tutor_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.tutor_conversas (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  papel text not null check (papel in ('user', 'assistant')),
  conteudo text not null check (char_length(conteudo) <= 40000),
  fontes jsonb not null default '[]',
  processamento_id uuid references public.processamentos_ia (id) on delete set null,
  created_at timestamptz not null default now()
);
create index tutor_mensagens_conversa_idx on public.tutor_mensagens (conversa_id, created_at);

create table public.recomendacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('revisar_material', 'resolver_questoes', 'fazer_simulado', 'revisao', 'ajuste_cronograma', 'flashcards')),
  titulo text not null,
  descricao text not null,
  prioridade smallint not null default 3 check (prioridade between 1 and 5),
  disciplina_id uuid references public.disciplinas (id) on delete cascade,
  assunto_id uuid references public.assuntos (id) on delete cascade,
  material_id uuid references public.materiais (id) on delete cascade,
  pagina_inicio int,
  pagina_fim int,
  origem_tipo text not null check (origem_tipo in ('simulado', 'desempenho', 'cronograma', 'revisoes', 'ia')),
  origem_id uuid,
  -- Evidência numérica usada para a recomendação (nunca inventada).
  evidencias jsonb not null default '{}',
  status text not null default 'ativa' check (status in ('ativa', 'aceita', 'descartada', 'concluida')),
  expira_em timestamptz,
  created_at timestamptz not null default now()
);
create index recomendacoes_user_idx on public.recomendacoes (user_id, status, prioridade desc, created_at desc);

create table public.relatorios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  periodo text not null check (periodo in ('semanal', 'mensal', 'personalizado')),
  inicio date not null,
  fim date not null,
  dados jsonb not null,
  analise_ia text,
  created_at timestamptz not null default now(),
  check (fim >= inicio)
);
create index relatorios_user_idx on public.relatorios (user_id, inicio desc);

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('atividade', 'simulado', 'revisao', 'meta', 'processamento', 'sistema')),
  titulo text not null,
  mensagem text not null,
  link text check (link is null or link ~ '^/'),
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
create index notificacoes_user_idx on public.notificacoes (user_id, lida, created_at desc);

-- Erros do servidor; sem acesso pelos clientes.
create table public.logs_erros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  origem text not null,
  mensagem text not null,
  detalhes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index logs_erros_data_idx on public.logs_erros (created_at desc);
alter table public.logs_erros enable row level security;
create policy "logs: admin" on public.logs_erros for select to authenticated using (public.is_admin());

do $$
declare
  tabela text;
begin
  foreach tabela in array array['tutor_conversas', 'tutor_mensagens', 'recomendacoes', 'relatorios', 'notificacoes']
  loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('create policy "%1$s: dono" on public.%1$I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', tabela);
  end loop;
end $$;

create or replace function public.validar_conversa_dono()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tutor_conversas c where c.id = new.conversa_id and c.user_id = new.user_id) then
    raise exception 'Conversa não pertence ao usuário' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tutor_mensagens_dono before insert on public.tutor_mensagens
  for each row execute function public.validar_conversa_dono();

-- =====================================================================
-- Consultas (security invoker: RLS se aplica)
-- =====================================================================

create or replace function public.uuid_array(p jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array'
              then array(select jsonb_array_elements_text(p)::uuid) end;
$$;

create or replace function public.text_array(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array'
              then array(select jsonb_array_elements_text(p)) end;
$$;

-- Banco de questões com filtros. Situações: ineditas, respondidas, erradas,
-- acertadas, favoritas, marcadas, caderno.
create or replace function public.listar_questoes(p_filtros jsonb default '{}', p_limite int default 20, p_offset int default 0)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_disc uuid[] := public.uuid_array(p_filtros -> 'disciplina_ids');
  v_ass uuid[] := public.uuid_array(p_filtros -> 'assunto_ids');
  v_sub uuid[] := public.uuid_array(p_filtros -> 'subassunto_ids');
  v_dif text[] := public.text_array(p_filtros -> 'dificuldades');
  v_tipos text[] := public.text_array(p_filtros -> 'tipos');
  v_origens text[] := public.text_array(p_filtros -> 'origens');
  v_status text[] := coalesce(public.text_array(p_filtros -> 'status'), array['aprovada']);
  v_banca uuid := nullif(p_filtros ->> 'banca_id', '')::uuid;
  v_concurso uuid := nullif(p_filtros ->> 'concurso_id', '')::uuid;
  v_material uuid := nullif(p_filtros ->> 'material_id', '')::uuid;
  v_ano int := nullif(p_filtros ->> 'ano', '')::int;
  v_cargo text := nullif(trim(p_filtros ->> 'cargo'), '');
  v_busca text := nullif(trim(p_filtros ->> 'busca'), '');
  v_situacao text := nullif(p_filtros ->> 'situacao', '');
  v_ids uuid[] := public.uuid_array(p_filtros -> 'ids');
  v_resultado jsonb;
begin
  with ultimas as (
    select distinct on (r.questao_id) r.questao_id, r.correta, r.created_at
    from public.respostas_usuario r where r.user_id = v_uid
    order by r.questao_id, r.tentativa_numero desc
  ), contagem as (
    select r.questao_id, count(*) as vezes from public.respostas_usuario r where r.user_id = v_uid group by r.questao_id
  ), base as (
    select q.*, u.correta as ultima_correta, coalesce(c.vezes, 0) as vezes,
           (f.questao_id is not null) as favorita, coalesce(m.marcada_revisao, false) as marcada,
           (ce.status = 'ativo') as no_caderno
    from public.questoes q
    left join ultimas u on u.questao_id = q.id
    left join contagem c on c.questao_id = q.id
    left join public.favoritos f on f.questao_id = q.id and f.user_id = v_uid
    left join public.questao_marcacoes m on m.questao_id = q.id and m.user_id = v_uid
    left join public.caderno_erros ce on ce.questao_id = q.id and ce.user_id = v_uid
    where q.status = any (v_status)
      and (v_ids is null or q.id = any (v_ids))
      and (v_disc is null or q.disciplina_id = any (v_disc))
      and (v_ass is null or q.assunto_id = any (v_ass))
      and (v_sub is null or q.subassunto_id = any (v_sub))
      and (v_dif is null or q.dificuldade = any (v_dif))
      and (v_tipos is null or q.tipo = any (v_tipos))
      and (v_origens is null or q.origem = any (v_origens))
      and (v_banca is null or q.banca_estilo_id = v_banca or q.banca_oficial_id = v_banca)
      and (v_concurso is null or q.concurso_id = v_concurso)
      and (v_ano is null or q.ano = v_ano)
      and (v_cargo is null or q.cargo ilike '%' || v_cargo || '%')
      and (v_material is null or exists (select 1 from public.questao_fontes qf where qf.questao_id = q.id and qf.material_id = v_material))
      and (v_busca is null or public.sem_acento(q.enunciado) ilike '%' || public.sem_acento(v_busca) || '%')
  ), filtrada as (
    select * from base b
    where v_situacao is null
       or (v_situacao = 'ineditas' and b.vezes = 0)
       or (v_situacao = 'respondidas' and b.vezes > 0)
       or (v_situacao = 'erradas' and b.ultima_correta = false)
       or (v_situacao = 'acertadas' and b.ultima_correta = true)
       or (v_situacao = 'favoritas' and b.favorita)
       or (v_situacao = 'marcadas' and b.marcada)
       or (v_situacao = 'caderno' and b.no_caderno)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'enunciado', left(f.enunciado, 500), 'tipo', f.tipo, 'dificuldade', f.dificuldade,
        'estilo', f.estilo, 'origem', f.origem, 'status', f.status, 'ano', f.ano, 'cargo', f.cargo,
        'proprietaria', f.owner_id is not null,
        'disciplina', jsonb_build_object('id', d.id, 'nome', d.nome),
        'assunto', case when a.id is null then null else jsonb_build_object('id', a.id, 'nome', a.nome) end,
        'banca_estilo', be.sigla, 'banca_oficial', bo.sigla,
        'vezes_respondida', f.vezes, 'ultima_correta', f.ultima_correta,
        'favorita', f.favorita, 'marcada', f.marcada, 'created_at', f.created_at)
        order by f.created_at desc, f.id)
      from (select * from filtrada order by created_at desc, id limit least(greatest(p_limite, 1), 200) offset greatest(p_offset, 0)) f
      join public.disciplinas d on d.id = f.disciplina_id
      left join public.assuntos a on a.id = f.assunto_id
      left join public.bancas be on be.id = f.banca_estilo_id
      left join public.bancas bo on bo.id = f.banca_oficial_id), '[]'::jsonb))
  into v_resultado;
  return v_resultado;
end;
$$;

-- Candidatas a simulado (dados enxutos; a escolha e a distribuição ficam no servidor).
create or replace function public.candidatas_simulado(p_filtros jsonb default '{}')
returns table (
  id uuid, disciplina_id uuid, assunto_id uuid, subassunto_id uuid, dificuldade text, tipo text,
  origem text, banca_estilo_id uuid, created_at timestamptz, vezes_respondida bigint, ultima_correta boolean
)
language sql
stable
set search_path = ''
as $$
  with ultimas as (
    select distinct on (r.questao_id) r.questao_id, r.correta
    from public.respostas_usuario r where r.user_id = auth.uid()
    order by r.questao_id, r.tentativa_numero desc
  ), contagem as (
    select r.questao_id, count(*) as vezes from public.respostas_usuario r where r.user_id = auth.uid() group by r.questao_id
  )
  select q.id, q.disciplina_id, q.assunto_id, q.subassunto_id, q.dificuldade, q.tipo, q.origem, q.banca_estilo_id,
         q.created_at, coalesce(c.vezes, 0), u.correta
  from public.questoes q
  left join ultimas u on u.questao_id = q.id
  left join contagem c on c.questao_id = q.id
  where q.status = 'aprovada'
    and (q.owner_id is null or q.owner_id = auth.uid())
    and (public.uuid_array(p_filtros -> 'disciplina_ids') is null or q.disciplina_id = any (public.uuid_array(p_filtros -> 'disciplina_ids')))
    and (public.uuid_array(p_filtros -> 'assunto_ids') is null or q.assunto_id = any (public.uuid_array(p_filtros -> 'assunto_ids')))
    and (public.text_array(p_filtros -> 'dificuldades') is null or q.dificuldade = any (public.text_array(p_filtros -> 'dificuldades')))
    and (public.text_array(p_filtros -> 'tipos') is null or q.tipo = any (public.text_array(p_filtros -> 'tipos')))
    and (nullif(p_filtros ->> 'banca_id', '') is null
         or q.banca_estilo_id = (p_filtros ->> 'banca_id')::uuid or q.banca_oficial_id = (p_filtros ->> 'banca_id')::uuid)
  limit 5000;
$$;

-- Evidências por assunto para o índice de domínio (classificação em src/lib/estudo/dominio.ts).
create or replace function public.dados_dominio()
returns table (
  disciplina_id uuid, assunto_id uuid, respondidas bigint, acertos bigint,
  respondidas_facil bigint, acertos_facil bigint, respondidas_medio bigint, acertos_medio bigint,
  respondidas_dificil bigint, acertos_dificil bigint, respondidas_30d bigint, acertos_30d bigint,
  respondidas_simulado bigint, acertos_simulado bigint, ultima_resposta_em timestamptz,
  revisoes_registradas bigint, revisoes_boas bigint
)
language sql
stable
set search_path = ''
as $$
  with r as (
    select * from public.respostas_usuario where user_id = auth.uid()
  ), agregados as (
    select r.disciplina_id, r.assunto_id, count(*) as respondidas, count(*) filter (where r.correta) as acertos,
      count(*) filter (where r.dificuldade = 'facil') as rf, count(*) filter (where r.dificuldade = 'facil' and r.correta) as af,
      count(*) filter (where r.dificuldade = 'medio') as rm, count(*) filter (where r.dificuldade = 'medio' and r.correta) as am,
      count(*) filter (where r.dificuldade = 'dificil') as rd, count(*) filter (where r.dificuldade = 'dificil' and r.correta) as ad,
      count(*) filter (where r.created_at >= now() - interval '30 days') as r30,
      count(*) filter (where r.created_at >= now() - interval '30 days' and r.correta) as a30,
      count(*) filter (where r.contexto = 'simulado') as rs,
      count(*) filter (where r.contexto = 'simulado' and r.correta) as asim,
      max(r.created_at) as ultima
    from r group by r.disciplina_id, r.assunto_id
  ), revs as (
    select v.assunto_id, count(h.*) as total, count(h.*) filter (where h.avaliacao in ('bom', 'facil')) as boas
    from public.revisoes v join public.revisao_historico h on h.revisao_id = v.id
    where v.user_id = auth.uid() and v.assunto_id is not null
    group by v.assunto_id
  )
  select a.disciplina_id, a.assunto_id, a.respondidas, a.acertos, a.rf, a.af, a.rm, a.am, a.rd, a.ad, a.r30, a.a30,
         a.rs, a.asim, a.ultima, coalesce(v.total, 0), coalesce(v.boas, 0)
  from agregados a left join revs v on v.assunto_id = a.assunto_id;
$$;

-- Resumo para dashboard e relatórios, no fuso do usuário.
create or replace function public.resumo_desempenho(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fuso text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_res jsonb;
begin
  select coalesce(fuso_horario, 'America/Sao_Paulo') into v_fuso from public.preferencias_usuario where user_id = v_uid;
  v_fuso := coalesce(v_fuso, 'America/Sao_Paulo');
  v_ini := p_inicio::timestamp at time zone v_fuso;
  v_fim := (p_fim + 1)::timestamp at time zone v_fuso;

  with resp as (
    select * from public.respostas_usuario where user_id = v_uid and created_at >= v_ini and created_at < v_fim
  ), unicas as (
    select distinct on (questao_id) questao_id, correta from resp order by questao_id, tentativa_numero desc
  ), sess as (
    select * from public.sessoes_estudo where user_id = v_uid and inicio >= v_ini and inicio < v_fim
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'fuso', v_fuso),
    'totais', jsonb_build_object(
      'respondidas', (select count(*) from resp),
      'acertos', (select count(*) filter (where correta) from resp),
      'questoes_unicas', (select count(*) from unicas),
      'acertos_unicos', (select count(*) filter (where correta) from unicas),
      'tempo_questoes_seg', (select coalesce(sum(tempo_seg), 0) from resp),
      'tempo_estudo_seg', (select coalesce(sum(duracao_seg), 0) from sess),
      'disciplinas_trabalhadas', (select count(distinct disciplina_id) from resp where disciplina_id is not null),
      'simulados_concluidos', (select count(*) from public.simulados_resultados sr
                               where sr.user_id = v_uid and sr.created_at >= v_ini and sr.created_at < v_fim),
      'revisoes_concluidas', (select count(*) from public.revisao_historico h
                              where h.user_id = v_uid and h.created_at >= v_ini and h.created_at < v_fim),
      'flashcards_revisados', (select count(*) from public.flashcard_revisoes h
                               where h.user_id = v_uid and h.created_at >= v_ini and h.created_at < v_fim),
      'paginas_lidas', (select coalesce(sum(cardinality(paginas_lidas)), 0) from public.progresso_leitura
                        where user_id = v_uid and updated_at >= v_ini and updated_at < v_fim)),
    'por_dia', coalesce((select jsonb_agg(x order by x ->> 'data') from (
        select jsonb_build_object('data', d::date,
          'respondidas', (select count(*) from resp where (created_at at time zone v_fuso)::date = d::date),
          'acertos', (select count(*) filter (where correta) from resp where (created_at at time zone v_fuso)::date = d::date),
          'estudo_seg', (select coalesce(sum(duracao_seg), 0) from sess where (inicio at time zone v_fuso)::date = d::date)) x
        from generate_series(p_inicio, p_fim, interval '1 day') d) t), '[]'),
    'por_disciplina', coalesce((select jsonb_agg(x order by (x ->> 'respondidas')::int desc) from (
        select jsonb_build_object('id', r.disciplina_id, 'nome', coalesce(d.nome, 'Sem disciplina'),
          'respondidas', count(*), 'acertos', count(*) filter (where r.correta)) x
        from resp r left join public.disciplinas d on d.id = r.disciplina_id
        group by r.disciplina_id, d.nome) t), '[]'),
    'por_assunto', coalesce((select jsonb_agg(x order by (x ->> 'respondidas')::int desc) from (
        select jsonb_build_object('id', r.assunto_id, 'nome', coalesce(a.nome, 'Sem assunto'), 'disciplina_id', r.disciplina_id,
          'respondidas', count(*), 'acertos', count(*) filter (where r.correta)) x
        from resp r left join public.assuntos a on a.id = r.assunto_id
        group by r.assunto_id, a.nome, r.disciplina_id) t), '[]'),
    'simulados', coalesce((select jsonb_agg(x order by x ->> 'data') from (
        select jsonb_build_object('tentativa_id', sr.tentativa_id, 'simulado_id', sr.simulado_id, 'nome', s.nome,
          'data', sr.created_at, 'nota', sr.nota, 'nota_maxima', sr.nota_maxima,
          'percentual_acerto', sr.percentual_acerto, 'percentual_acerto_total', sr.percentual_acerto_total) x
        from public.simulados_resultados sr join public.simulados s on s.id = sr.simulado_id
        where sr.user_id = v_uid and sr.created_at >= v_ini and sr.created_at < v_fim) t), '[]'),
    'erros_por_causa', coalesce((select jsonb_agg(jsonb_build_object('causa', causa, 'total', n)) from (
        select causa, count(*) as n from public.caderno_erros where user_id = v_uid and status = 'ativo' group by causa) t), '[]'),
    'revisoes_pendentes', (select count(*) from public.revisoes
                           where user_id = v_uid and status = 'ativa' and proxima_em <= (now() at time zone v_fuso)::date),
    'flashcards_pendentes', (select count(*) from public.flashcards
                             where user_id = v_uid and not suspenso and proxima_em <= (now() at time zone v_fuso)::date),
    'externos', coalesce((select jsonb_build_object('respondidas', sum(questoes_respondidas), 'acertos', sum(acertos))
                          from public.resultados_externos where user_id = v_uid and data between p_inicio and p_fim), '{}')
  ) into v_res;
  return v_res;
end;
$$;

-- Trechos de materiais para o Tutor (RAG por busca textual).
create or replace function public.buscar_trechos(
  p_consulta text,
  p_material_ids uuid[] default null,
  p_assunto_ids uuid[] default null,
  p_limite int default 6
)
returns table (material_id uuid, material_titulo text, pagina int, texto text, secao_titulo text, rank real)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_q tsquery := websearch_to_tsquery('public.pt_sem_acento', coalesce(p_consulta, ''));
  v_ou tsquery;
begin
  if numnode(v_q) = 0 then
    return;
  end if;
  return query
    select p.material_id, m.titulo, p.numero, p.texto, s.titulo, ts_rank_cd(p.tsv, v_q)
    from public.material_paginas p
    join public.materiais m on m.id = p.material_id
    left join public.material_secoes s on s.id = p.secao_id
    where p.user_id = auth.uid() and p.tsv @@ v_q
      and (p_material_ids is null or p.material_id = any (p_material_ids))
      and (p_assunto_ids is null or s.assunto_id = any (p_assunto_ids))
    order by ts_rank_cd(p.tsv, v_q) desc
    limit least(greatest(p_limite, 1), 20);
  if found then
    return;
  end if;
  -- Sem página com todos os termos: aceita qualquer termo.
  v_ou := replace(plainto_tsquery('public.pt_sem_acento', p_consulta)::text, '&', '|')::tsquery;
  return query
    select p.material_id, m.titulo, p.numero, p.texto, s.titulo, ts_rank_cd(p.tsv, v_ou)
    from public.material_paginas p
    join public.materiais m on m.id = p.material_id
    left join public.material_secoes s on s.id = p.secao_id
    where p.user_id = auth.uid() and p.tsv @@ v_ou
      and (p_material_ids is null or p.material_id = any (p_material_ids))
      and (p_assunto_ids is null or s.assunto_id = any (p_assunto_ids))
    order by ts_rank_cd(p.tsv, v_ou) desc
    limit least(greatest(p_limite, 1), 20);
end;
$$;

-- Busca global: materiais, páginas, questões, anotações e assuntos.
create or replace function public.buscar_global(p_termo text, p_limite int default 8)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_termo text := trim(coalesce(p_termo, ''));
  v_like text;
  v_q tsquery;
  v_lim int := least(greatest(p_limite, 1), 30);
begin
  if char_length(v_termo) < 2 then
    return jsonb_build_object('materiais', '[]'::jsonb, 'paginas', '[]'::jsonb, 'questoes', '[]'::jsonb,
                              'anotacoes', '[]'::jsonb, 'assuntos', '[]'::jsonb);
  end if;
  v_like := '%' || public.sem_acento(v_termo) || '%';
  v_q := websearch_to_tsquery('public.pt_sem_acento', v_termo);

  return jsonb_build_object(
    'materiais', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', m.id, 'titulo', m.titulo, 'aula', m.aula_numero) x
        from public.materiais m where m.user_id = v_uid and public.sem_acento(m.titulo) ilike v_like
        order by m.titulo limit v_lim) t), '[]'),
    'paginas', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('material_id', p.material_id, 'titulo', m.titulo, 'pagina', p.numero,
          'trecho', ts_headline('public.pt_sem_acento', p.texto, v_q,
                                'StartSel=<<, StopSel=>>, MaxWords=30, MinWords=12, MaxFragments=1')) x
        from public.material_paginas p join public.materiais m on m.id = p.material_id
        where p.user_id = v_uid and numnode(v_q) > 0 and p.tsv @@ v_q
        order by ts_rank_cd(p.tsv, v_q) desc limit v_lim) t), '[]'),
    'questoes', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', q.id, 'enunciado', left(q.enunciado, 200), 'status', q.status) x
        from public.questoes q
        where public.pode_ver_questao(q.owner_id, q.status) and public.sem_acento(q.enunciado) ilike v_like
        order by q.created_at desc limit v_lim) t), '[]'),
    'anotacoes', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', a.id, 'material_id', a.material_id, 'pagina', a.pagina,
          'texto', left(coalesce(a.texto, a.trecho), 200)) x
        from public.anotacoes a
        where a.user_id = v_uid
          and public.sem_acento(coalesce(a.texto, '') || ' ' || coalesce(a.trecho, '')) ilike v_like
        order by a.updated_at desc limit v_lim) t), '[]'),
    'assuntos', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', a.id, 'nome', a.nome, 'disciplina_id', a.disciplina_id, 'disciplina', d.nome) x
        from public.assuntos a join public.disciplinas d on d.id = a.disciplina_id
        where (a.owner_id is null or a.owner_id = v_uid) and public.sem_acento(a.nome) ilike v_like
        order by a.nome limit v_lim) t), '[]'));
end;
$$;

-- Verificação de saúde: consulta leve e somente leitura.
create or replace function public.verificar_saude()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'horario_banco', now(),
                            'bancas_cadastradas', (select count(*) from public.bancas));
$$;
grant execute on function public.verificar_saude() to anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000800', 'inteligencia') on conflict do nothing;

-- >>> 20261015000900_seed_e_permissoes.sql

-- =====================================================================
-- Dados de referência e permissões finais
-- =====================================================================

-- Descrições genéricas e conservadoras, usadas apenas para orientar questões
-- autorais "no estilo" da banca. Não são regras oficiais de nenhuma prova.
insert into public.bancas (nome, sigla, descricao_estilo) values
  ('Centro Brasileiro de Pesquisa em Avaliação e Seleção e de Promoção de Eventos', 'CEBRASPE',
   'Costuma usar itens de julgamento (certo ou errado) com afirmações objetivas e literalidade normativa.'),
  ('Fundação Getulio Vargas', 'FGV',
   'Costuma usar múltipla escolha com cinco alternativas, enunciados longos e casos práticos.'),
  ('Fundação Carlos Chagas', 'FCC',
   'Costuma usar múltipla escolha com cinco alternativas e cobrança próxima do texto legal.'),
  ('Fundação para o Vestibular da Universidade Estadual Paulista', 'VUNESP',
   'Costuma usar múltipla escolha com cinco alternativas e enunciados diretos.'),
  ('Instituto Brasileiro de Formação e Capacitação', 'IBFC',
   'Costuma usar múltipla escolha com quatro ou cinco alternativas e cobrança conceitual.'),
  ('Instituto AOCP', 'Instituto AOCP',
   'Costuma usar múltipla escolha com cinco alternativas e cobrança de literalidade.')
on conflict (sigla) do nothing;

insert into public.simulados_regras_pontuacao (owner_id, nome, descricao, pontos_acerto, pontos_erro, pontos_branco, nota_nao_negativa)
select null, v.nome, v.descricao, v.acerto, v.erro, v.branco, v.nao_negativa
from (values
  ('Padrão (+1 / 0 / 0)', 'Acerto vale 1 ponto; erro e branco não pontuam.', 1.0, 0.0, 0.0, true),
  ('Certo/errado com penalização (+1 / −1 / 0)',
   'Cada erro anula um acerto. Confira no edital a regra real da sua prova.', 1.0, -1.0, 0.0, false)
) as v(nome, descricao, acerto, erro, branco, nao_negativa)
where not exists (select 1 from public.simulados_regras_pontuacao r where r.owner_id is null and r.nome = v.nome);

-- Funções de escrita sensíveis: somente usuários autenticados.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.salvar_questao(jsonb)',
    'public.definir_status_questao(uuid, text, text)',
    'public.obter_gabarito_revisao(uuid)',
    'public.responder_questao(uuid, uuid, int, uuid, text, uuid)',
    'public.obter_correcao_questao(uuid)',
    'public.criar_simulado(jsonb, uuid[])',
    'public.iniciar_tentativa(uuid)',
    'public.obter_prova(uuid)',
    'public.salvar_resposta_simulado(uuid, uuid, uuid, boolean, int, int)',
    'public.pausar_tentativa(uuid)',
    'public.retomar_tentativa(uuid)',
    'public.finalizar_tentativa(uuid, boolean)',
    'public.obter_correcao_simulado(uuid)',
    'public.registrar_leitura(uuid, int, int)',
    'public.listar_questoes(jsonb, int, int)',
    'public.candidatas_simulado(jsonb)',
    'public.dados_dominio()',
    'public.resumo_desempenho(date, date)',
    'public.buscar_trechos(text, uuid[], uuid[], int)',
    'public.buscar_global(text, int)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Tabelas escritas apenas por funções: remove escrita direta dos clientes.
revoke insert, update, delete on public.respostas_usuario, public.questoes, public.alternativas,
  public.questao_gabaritos, public.questao_fontes, public.questao_eventos, public.simulados_questoes,
  public.simulados_gabaritos, public.simulados_tentativas, public.simulados_respostas,
  public.simulados_resultados, public.historico_desempenho, public.processamentos_ia, public.logs_erros
  from anon, authenticated;
revoke insert on public.simulados, public.caderno_erros from anon, authenticated;

-- Visitantes não autenticados não acessam nenhuma tabela.
revoke all on all tables in schema public from anon;

insert into supabase_migrations.schema_migrations (version, name) values ('20261015000900', 'seed_e_permissoes') on conflict do nothing;

-- >>> 20261015001000_exclusao_conta.sql

-- =====================================================================
-- Exclusão de conta
--
-- As chaves que protegem o histórico (questões respondidas, alternativas
-- referenciadas, questões em simulados) eram verificadas a cada passo da
-- cascata. Ao excluir a conta, as questões do usuário saíam antes dos
-- simulados/respostas que as referenciam e a exclusão falhava.
-- Com a verificação adiada para o fim da transação, a exclusão da conta
-- remove tudo de forma consistente, e apagar avulsamente uma questão já
-- respondida continua proibido (falha no commit).
-- =====================================================================

alter table public.respostas_usuario
  alter constraint respostas_usuario_questao_id_fkey deferrable initially deferred,
  alter constraint respostas_usuario_alternativa_id_fkey deferrable initially deferred,
  alter constraint respostas_usuario_alternativa_correta_id_fkey deferrable initially deferred;

alter table public.caderno_erros
  alter constraint caderno_erros_questao_id_fkey deferrable initially deferred,
  alter constraint caderno_erros_ultima_alternativa_errada_id_fkey deferrable initially deferred;

alter table public.simulados_questoes
  alter constraint simulados_questoes_questao_id_fkey deferrable initially deferred;

alter table public.questao_gabaritos
  alter constraint questao_gabaritos_alternativa_correta_id_fkey deferrable initially deferred;

insert into supabase_migrations.schema_migrations (version, name) values ('20261015001000', 'exclusao_conta') on conflict do nothing;

-- >>> 20261015001100_simulados_agendados_caderno.sql

-- =====================================================================
-- Simulados agendados, caderno manual e revisões a partir de resultados
-- =====================================================================

-- Núcleo da criação, parametrizado pelo usuário. Só o servidor (chave
-- secreta) chama diretamente; o aluno usa criar_simulado().
create or replace function public.criar_simulado_interno(p_uid uuid, p_dados jsonb, p_questoes uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int := coalesce(cardinality(p_questoes), 0);
  v_validas int;
  v_regra public.simulados_regras_pontuacao;
  v_acerto numeric;
  v_erro numeric;
  v_branco numeric;
  v_nao_negativa boolean;
  v_id uuid;
begin
  if p_uid is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;
  if v_total < 1 or v_total > 300 then
    raise exception 'O simulado deve ter entre 1 e 300 questões' using errcode = '22023';
  end if;
  if (select count(distinct q) from unnest(p_questoes) q) <> v_total then
    raise exception 'Questões repetidas no simulado' using errcode = '22023';
  end if;
  select count(*) into v_validas from public.questoes q
  where q.id = any (p_questoes) and q.status = 'aprovada' and (q.owner_id is null or q.owner_id = p_uid)
    and exists (select 1 from public.questao_gabaritos g where g.questao_id = q.id);
  if v_validas <> v_total then
    raise exception 'Há questões indisponíveis ou não aprovadas na seleção' using errcode = '22023';
  end if;

  if nullif(p_dados ->> 'regra_pontuacao_id', '') is not null then
    select * into v_regra from public.simulados_regras_pontuacao r
    where r.id = (p_dados ->> 'regra_pontuacao_id')::uuid and (r.owner_id is null or r.owner_id = p_uid);
    if not found then
      raise exception 'Regra de pontuação inválida' using errcode = '22023';
    end if;
    v_acerto := v_regra.pontos_acerto; v_erro := v_regra.pontos_erro;
    v_branco := v_regra.pontos_branco; v_nao_negativa := v_regra.nota_nao_negativa;
  else
    v_acerto := coalesce((p_dados ->> 'pontos_acerto')::numeric, 1);
    v_erro := coalesce((p_dados ->> 'pontos_erro')::numeric, 0);
    v_branco := coalesce((p_dados ->> 'pontos_branco')::numeric, 0);
    v_nao_negativa := coalesce((p_dados ->> 'nota_nao_negativa')::boolean, true);
  end if;
  if v_acerto <= 0 then
    raise exception 'A pontuação por acerto deve ser positiva' using errcode = '22023';
  end if;

  insert into public.simulados (user_id, nome, tipo, concurso_id, banca_estilo_id, edital_id, config, total_questoes,
    tempo_limite_seg, permite_pausa, ordem, mostrar_gabarito_durante, finalizar_ao_esgotar, regra_pontuacao_id,
    pontos_acerto, pontos_erro, pontos_branco, nota_nao_negativa, agendamento_id, observacoes_geracao)
  values (p_uid, coalesce(nullif(trim(p_dados ->> 'nome'), ''), 'Simulado'), coalesce(p_dados ->> 'tipo', 'personalizado'),
    (select c.id from public.concursos c where c.id = nullif(p_dados ->> 'concurso_id', '')::uuid and (c.owner_id is null or c.owner_id = p_uid)),
    nullif(p_dados ->> 'banca_estilo_id', '')::uuid,
    (select e.id from public.editais e where e.id = nullif(p_dados ->> 'edital_id', '')::uuid and e.owner_id = p_uid),
    coalesce(p_dados -> 'config', '{}'), v_total,
    nullif(p_dados ->> 'tempo_limite_seg', '')::int, coalesce((p_dados ->> 'permite_pausa')::boolean, false),
    coalesce(p_dados ->> 'ordem', 'aleatoria'), coalesce((p_dados ->> 'mostrar_gabarito_durante')::boolean, false),
    coalesce((p_dados ->> 'finalizar_ao_esgotar')::boolean, true), v_regra.id,
    v_acerto, v_erro, v_branco, v_nao_negativa,
    (select a.id from public.simulados_agendamentos a where a.id = nullif(p_dados ->> 'agendamento_id', '')::uuid and a.user_id = p_uid),
    coalesce(p_dados -> 'observacoes_geracao', '[]'))
  returning id into v_id;

  insert into public.simulados_questoes (simulado_id, ordem, questao_id, disciplina_id, assunto_id, dificuldade)
  select v_id, o.ordem, q.id, q.disciplina_id, q.assunto_id, q.dificuldade
  from unnest(p_questoes) with ordinality as o(questao_id, ordem)
  join public.questoes q on q.id = o.questao_id;

  insert into public.simulados_gabaritos (simulado_id, questao_id, alternativa_correta_id, snapshot)
  select v_id, q.id, g.alternativa_correta_id,
    jsonb_build_object(
      'questao_id', q.id, 'tipo', q.tipo, 'enunciado', q.enunciado, 'texto_apoio', q.texto_apoio,
      'dificuldade', q.dificuldade, 'origem', q.origem, 'estilo', q.estilo,
      'disciplina', jsonb_build_object('id', d.id, 'nome', d.nome),
      'assunto', case when a.id is null then null else jsonb_build_object('id', a.id, 'nome', a.nome) end,
      'subassunto', case when sa.id is null then null else jsonb_build_object('id', sa.id, 'nome', sa.nome) end,
      'banca_estilo', b.sigla, 'banca_oficial', bo.sigla, 'ano', q.ano,
      'alternativas', (select jsonb_agg(jsonb_build_object('id', al.id, 'letra', al.letra, 'texto', al.texto) order by al.ordem)
                       from public.alternativas al where al.questao_id = q.id),
      'gabarito', jsonb_build_object('alternativa_correta_id', g.alternativa_correta_id,
                                     'explicacao', g.explicacao, 'justificativas', g.justificativas),
      'fontes', coalesce((select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'material_id', f.material_id, 'pagina', f.pagina,
                                                              'trecho', f.trecho, 'descricao', f.descricao, 'material_titulo', m.titulo))
                          from public.questao_fontes f left join public.materiais m on m.id = f.material_id
                          where f.questao_id = q.id), '[]'::jsonb))
  from public.questoes q
  join public.questao_gabaritos g on g.questao_id = q.id
  join public.disciplinas d on d.id = q.disciplina_id
  left join public.assuntos a on a.id = q.assunto_id
  left join public.subassuntos sa on sa.id = q.subassunto_id
  left join public.bancas b on b.id = q.banca_estilo_id
  left join public.bancas bo on bo.id = q.banca_oficial_id
  where q.id = any (p_questoes);

  return v_id;
end;
$$;
revoke execute on function public.criar_simulado_interno(uuid, jsonb, uuid[]) from public, anon, authenticated;

create or replace function public.criar_simulado(p_dados jsonb, p_questoes uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.criar_simulado_interno(auth.uid(), p_dados, p_questoes);
end;
$$;
revoke execute on function public.criar_simulado(jsonb, uuid[]) from public, anon;
grant execute on function public.criar_simulado(jsonb, uuid[]) to authenticated;

-- Candidatas para um usuário específico (rotinas agendadas no servidor).
create or replace function public.candidatas_simulado_usuario(p_uid uuid, p_filtros jsonb default '{}')
returns table (
  id uuid, disciplina_id uuid, assunto_id uuid, subassunto_id uuid, dificuldade text, tipo text,
  origem text, banca_estilo_id uuid, created_at timestamptz, vezes_respondida bigint, ultima_correta boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with ultimas as (
    select distinct on (r.questao_id) r.questao_id, r.correta
    from public.respostas_usuario r where r.user_id = p_uid
    order by r.questao_id, r.tentativa_numero desc
  ), contagem as (
    select r.questao_id, count(*) as vezes from public.respostas_usuario r where r.user_id = p_uid group by r.questao_id
  )
  select q.id, q.disciplina_id, q.assunto_id, q.subassunto_id, q.dificuldade, q.tipo, q.origem, q.banca_estilo_id,
         q.created_at, coalesce(c.vezes, 0), u.correta
  from public.questoes q
  left join ultimas u on u.questao_id = q.id
  left join contagem c on c.questao_id = q.id
  where q.status = 'aprovada'
    and (q.owner_id is null or q.owner_id = p_uid)
    and (public.uuid_array(p_filtros -> 'disciplina_ids') is null or q.disciplina_id = any (public.uuid_array(p_filtros -> 'disciplina_ids')))
    and (public.uuid_array(p_filtros -> 'assunto_ids') is null or q.assunto_id = any (public.uuid_array(p_filtros -> 'assunto_ids')))
    and (public.text_array(p_filtros -> 'tipos') is null or q.tipo = any (public.text_array(p_filtros -> 'tipos')))
    and (nullif(p_filtros ->> 'banca_id', '') is null
         or q.banca_estilo_id = (p_filtros ->> 'banca_id')::uuid or q.banca_oficial_id = (p_filtros ->> 'banca_id')::uuid)
  limit 5000;
$$;
revoke execute on function public.candidatas_simulado_usuario(uuid, jsonb) from public, anon, authenticated;

-- A versão do aluno passa a não filtrar dificuldade no banco (a seleção trata a distribuição).
create or replace function public.candidatas_simulado(p_filtros jsonb default '{}')
returns table (
  id uuid, disciplina_id uuid, assunto_id uuid, subassunto_id uuid, dificuldade text, tipo text,
  origem text, banca_estilo_id uuid, created_at timestamptz, vezes_respondida bigint, ultima_correta boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.candidatas_simulado_usuario(auth.uid(), p_filtros) where auth.uid() is not null;
$$;
revoke execute on function public.candidatas_simulado(jsonb) from public, anon;
grant execute on function public.candidatas_simulado(jsonb) to authenticated;

-- Adiciona ao caderno de erros uma questão que o aluno respondeu ou viu em simulado
-- (útil para questões deixadas em branco ou acertadas "no chute").
create or replace function public.adicionar_ao_caderno(p_questao_id uuid, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;
  if not exists (select 1 from public.respostas_usuario r where r.user_id = v_uid and r.questao_id = p_questao_id)
     and not exists (select 1 from public.simulados_questoes sq join public.simulados s on s.id = sq.simulado_id
                     join public.simulados_tentativas t on t.simulado_id = s.id
                     where s.user_id = v_uid and sq.questao_id = p_questao_id and t.status in ('concluida', 'interrompida')) then
    raise exception 'Responda a questão antes de adicioná-la ao caderno' using errcode = '55000';
  end if;
  insert into public.caderno_erros (user_id, questao_id, total_erros, observacoes)
  values (v_uid, p_questao_id, 0, left(p_observacao, 4000))
  on conflict (user_id, questao_id) do update set status = 'ativo',
    observacoes = coalesce(excluded.observacoes, public.caderno_erros.observacoes), updated_at = now();
end;
$$;
revoke execute on function public.adicionar_ao_caderno(uuid, text) from public, anon;
grant execute on function public.adicionar_ao_caderno(uuid, text) to authenticated;

-- Agenda (ou antecipa) a revisão de um assunto sem criar duplicata.
create or replace function public.agendar_revisao_assunto(p_assunto_id uuid, p_titulo text, p_data date, p_origem text default 'simulado')
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.revisoes
  where user_id = (select auth.uid()) and alvo_tipo = 'assunto' and assunto_id = p_assunto_id and status = 'ativa';
  if v_id is not null then
    update public.revisoes set proxima_em = least(proxima_em, p_data) where id = v_id;
    return v_id;
  end if;
  insert into public.revisoes (user_id, alvo_tipo, assunto_id, titulo, proxima_em, origem)
  values ((select auth.uid()), 'assunto', p_assunto_id, left(p_titulo, 200), p_data, p_origem)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.agendar_revisao_assunto(uuid, text, date, text) from public, anon;
grant execute on function public.agendar_revisao_assunto(uuid, text, date, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261015001100', 'simulados_agendados_caderno') on conflict do nothing;
commit;
notify pgrst, 'reload schema';