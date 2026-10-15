-- =====================================================================
-- Exclusão de conta
--
-- As chaves que protegem o histórico (questões respondidas, alternativas
-- referenciadas, questões em simulados) eram verificadas a cada passo da
-- cascata. Ao excluir a conta, as questões do usuário saíam antes dos
-- simulados/respostas que as referenciam e a exclusão falhava.
-- Com a verificação adiada para o fim da transação, a exclusão da conta
-- remove tudo de forma consistente, e apagar avulsamente uma questão já
-- respondida continua proibido (falha no commit).
-- =====================================================================

alter table public.respostas_usuario
  alter constraint respostas_usuario_questao_id_fkey deferrable initially deferred,
  alter constraint respostas_usuario_alternativa_id_fkey deferrable initially deferred,
  alter constraint respostas_usuario_alternativa_correta_id_fkey deferrable initially deferred;

alter table public.caderno_erros
  alter constraint caderno_erros_questao_id_fkey deferrable initially deferred,
  alter constraint caderno_erros_ultima_alternativa_errada_id_fkey deferrable initially deferred;

alter table public.simulados_questoes
  alter constraint simulados_questoes_questao_id_fkey deferrable initially deferred;

alter table public.questao_gabaritos
  alter constraint questao_gabaritos_alternativa_correta_id_fkey deferrable initially deferred;
