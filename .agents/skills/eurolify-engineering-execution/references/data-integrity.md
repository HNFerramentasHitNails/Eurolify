# Dados, concorrência e migrações

Lê quando a alteração afeta SQL, isolamento, estados, dinheiro ou escritas simultâneas. Consulta também `platform-architect` e `observability-security`.

## Isolamento real

- Obtém o comerciante a partir do contexto autenticado e autorizado, não de um identificador arbitrário no corpo do pedido. Resolve separadamente quem opera, por qual loja e por qual entidade.
- Reutiliza `comComerciante` e o contexto transacional existente. No padrão atual, `set_config(..., true)` é local à transação; não usa `false` nem configuração persistente que passe ao próximo pedido do pool.
- Usa RLS e permissões da base, além da autorização da aplicação. Testa SELECT, INSERT, UPDATE e DELETE permitidos pelo desenho; testa ausência de contexto e ligações reutilizadas.
- O papel usado nos testes de isolamento deve ser o da API, não o dono das tabelas ou um superutilizador. `FORCE ROW LEVEL SECURITY` não impede superutilizadores ou `BYPASSRLS` de ignorarem RLS ([PostgreSQL 18: segurança por linha](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)).
- Relações entre dados de comerciantes devem ter chaves/restrições que impeçam referências cruzadas. Revê `USING`, `WITH CHECK`, permissões de funções e qualquer `SECURITY DEFINER`; não abre privilégios para facilitar testes.
- Considera também ficheiros, exportações, tarefas, caches, índices de pesquisa e páginas seguintes. Não revela a existência de dados de outro comerciante através de mensagens ou conflitos únicos.

## Uma autoridade por invariante

Identifica onde a regra já é imposta. Em Comerciante e Catálogo, há invariantes implementadas em restrições e triggers; o código chama-as e traduz erros. Não cria uma segunda lista de transições no frontend ou uma cópia concorrente em TypeScript.

Para uma regra nova, escreve primeiro dono, camada autoritativa, transições permitidas e efeitos; aprova o desenho necessário. A base continua a proteger consistência estrutural, mas não recebe uma regra jurídica inventada.

## Operações simultâneas

1. Enumera o que pode disputar o mesmo recurso: duas edições, reserva, cancelamento, reembolso ou resgate.
2. Define a invariante e o ponto atómico: restrição única, atualização condicional, versão esperada ou bloqueio, conforme o desenho.
3. Confere a versão e grava na mesma transação; não faz “ler, verificar, escrever” em operações independentes.
4. Usa ordem estável ao bloquear vários registos; define limites e tratamento de deadlocks/conflitos.
5. Testa dois clientes reais da base, sincronizados por barreiras ou observação do bloqueio. Um `Promise.all` ou uma espera fixa não prova que houve sobreposição.

Retries são limitados e reexecutam uma unidade segura e idempotente. Não repete indiscriminadamente uma transação que inclui cobrança externa.

## Dinheiro, quantidades e tempo

- Preserva o contrato monetário atual de `headless-commerce`: inteiro em cêntimos e moeda. Se uma moeda exigir outra escala, bloqueia o caso e pede desenho; não aplica uma conversão silenciosa nem muda o contrato nesta skill.
- Confere limites de representação entre JSON/TypeScript/PostgreSQL. Não usa ponto flutuante para calcular valores monetários; percentagens e resultados intermédios precisam de representação exata e arredondamento aprovado.
- Descontos, impostos, portes, totais e reembolsos devem reconciliar segundo as regras verificadas do domínio. Não inventa o método fiscal de arredondamento.
- Quantidades fracionárias precisam de escala e unidade explícitas. Stock, saldo e documento fiscal não são apenas campos editáveis: têm movimentos/estados e permissões segundo o desenho.
- Usa instantes com fuso e relógio controlável em testes; uma data civil não é um instante UTC. Testa limites de vigência e mudança de hora quando afetarem o caso.

## Migrações sem surpresas

- Não reescreve uma migração já aplicada: cria a seguinte e atualiza o esquema tipado correspondente.
- Ensaios em base vazia e base com a versão anterior e dados fictícios: inclui dados que contrariem a nova restrição.
- Uma deteção de duplicados apresenta a evidência para decisão; não escolhe automaticamente o “melhor” cliente, SKU ou documento.
- Separa alterações compatíveis de remoções que quebram uma publicação anterior. Revê locks, duração, volumes, permissões e compatibilidade com o rollback da aplicação.
- Não promete que toda a migração é transacional ou reversível. Documenta operações não transacionais e o modo de recuperação.
- Testa falha a meio e saída do processo, sem dados pessoais nos logs. Ações sobre dados reais seguem cópia, filtro e confirmação definidos no projeto.
