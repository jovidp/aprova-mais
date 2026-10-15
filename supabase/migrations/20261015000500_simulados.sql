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
