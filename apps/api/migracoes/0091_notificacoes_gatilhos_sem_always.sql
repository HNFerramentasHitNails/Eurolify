-- Os gatilhos que criam notificações deixam de ser `ALWAYS` (issue #435;
-- revisão do #389, P3-7; docs/34 §12). Regra da 0053: um gatilho que escreve
-- não fica `ALWAYS`, porque uma cópia reposta em modo `replica` tem de
-- guardar as linhas como estão. Com `ALWAYS`, repor as devoluções, o rasto das
-- atribuições ou as ligações à faturação voltava a criar notificações (e
-- e-mails aos donos) que a cópia já trazia, ou que nunca deviam sair. Ex.: uma
-- reposição da base de ensaio depois de uma ligação ao Moloni ter ficado com
-- erro mandava outra vez o e-mail `invoicing.connection_error`.
--
-- Também o índice das tarefas das notificações (`notificacao_tarefa`, 0067):
-- escreve em `tarefa_notificacao` e, numa reposição que traga a `notificacao`
-- antes dela, a cópia desta falharia por chave repetida (revisão do #441,
-- P2-1). Os outros `ALWAYS` das notificações ficam: são guardas (recusam ou
-- validam, não escrevem). A 0087 (envios) já nasceu sem `ALWAYS`.
SET LOCAL lock_timeout = '10s';

ALTER TABLE devolucao ENABLE TRIGGER devolucao_prazo_notificacao;
ALTER TABLE atribuicao_rasto ENABLE TRIGGER atribuicao_vencida_notificacao;
ALTER TABLE ligacao_faturacao ENABLE TRIGGER ligacao_faturacao_com_erro_notificacao;
ALTER TABLE notificacao ENABLE TRIGGER notificacao_tarefa;
