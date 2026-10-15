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
