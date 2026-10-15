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
