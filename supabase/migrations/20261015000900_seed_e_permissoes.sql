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
