-- Tira a coluna `loja.lingua_origem` (tarefa #109; Diogo, 06/10/2026: «sim,
-- avança com a #109»). É a rede temporária da 0009, com data de fim
-- 31/10/2026 (AGENTS.md, «Não se erra em documentos fiscais», regra 2): a
-- língua de origem do catálogo passou para o comerciante (`docs/14` §9, P13)
-- e a coluna da loja ficou, sem obrigação e sem uso, só para a versão
-- anterior da aplicação poder voltar (revisão do #105, P2-4).
--
-- Porque já pode sair (`infra/vps/LEIA-ME.md`, «Migrações compatíveis com a
-- versão anterior»: acrescentar primeiro, tirar só numa publicação seguinte):
-- - nenhum código a lê nem a escreve desde o #105 (5d1f4af, publicado na VPS
--   a 06/10/2026); a versão anterior desta, a que o `eurolify-publicar`
--   repõe se o /health falhar, é a do #110 (fbed701), também sem ela;
-- - na VPS o `api.env` está vazio: nenhuma versão da API lá abre a base.
--
-- O que fica: `comerciante.lingua_origem` e a função que a põe por omissão
-- (0009), que o comando do operador usa ao registar um comerciante.
--
-- Ex.: depois desta migração, `select lingua_origem from loja` dá erro
-- (coluna inexistente); `select lingua_origem from comerciante` continua.

-- Como a 0006, a 0008 e a 0009: desiste ao fim de 10 s à espera de um
-- bloqueio, em vez de pôr os pedidos todos em fila atrás dela.
SET LOCAL lock_timeout = '10s';

ALTER TABLE loja DROP COLUMN lingua_origem;
