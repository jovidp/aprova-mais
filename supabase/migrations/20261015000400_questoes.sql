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
