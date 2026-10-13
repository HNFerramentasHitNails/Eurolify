-- Os gatilhos que criam notificações deixam de ser `ALWAYS` (issue #435;
-- revisão do #389, P3-7; docs/34 §12). Regra da 0053: um gatilho que escreve
-- não fica `ALWAYS`, porque uma cópia reposta em modo `replica` tem de
-- guardar as linhas como estão. Com `ALWAYS`, repor as devoluções, o rasto das
-- atribuições ou as ligações à faturação voltava a criar notificações (e
-- e-mails aos donos) que a cópia já trazia, ou que nunca deviam sair. Ex.: uma
-- reposição da base de ensaio depois de uma ligação ao Moloni ter ficado com
-- erro mandava outra vez o e-mail `invoicing.connection_error`.
--
-- Os outros `ALWAYS` das notificações ficam: são guardas (recusam ou validam,
-- não escrevem noutras tabelas) ou o índice das tarefas, que não cria
-- notificações. A 0087 (envios) já nasceu sem `ALWAYS`.
SET LOCAL lock_timeout = '10s';

ALTER TABLE devolucao ENABLE TRIGGER devolucao_prazo_notificacao;
ALTER TABLE atribuicao_rasto ENABLE TRIGGER atribuicao_vencida_notificacao;
ALTER TABLE ligacao_faturacao ENABLE TRIGGER ligacao_faturacao_com_erro_notificacao;
