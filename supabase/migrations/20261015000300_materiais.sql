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
