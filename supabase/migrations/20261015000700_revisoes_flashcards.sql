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
