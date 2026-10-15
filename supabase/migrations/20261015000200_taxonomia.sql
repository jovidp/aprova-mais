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
