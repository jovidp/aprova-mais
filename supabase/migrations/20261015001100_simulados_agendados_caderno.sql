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
