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
