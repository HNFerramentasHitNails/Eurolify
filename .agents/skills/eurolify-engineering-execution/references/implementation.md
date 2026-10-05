# Implementação, tipos e contratos

Lê antes de modificar código, rotas, tipos ou dependências. Confirma os ficheiros atuais; os caminhos seguintes foram consultados a 05/10/2026, não são uma autorização para os substituir.

## Usa o que já existe

- Consulta `docs/adr/0025-ferramentas-do-codigo.md`, `package.json`, `apps/api/package.json`, `pnpm-lock.yaml` e `tsconfig.base.json`. Preserva Node/pnpm, TypeScript, Fastify, `typebox`, Kysely/pg e Vitest aprovados; não troca o pacote `typebox` pelo antigo `@sinclair/typebox`.
- Não instala “latest”, não muda o lockfile fora de uma atualização deliberada e não assume que uma versão de documentação corresponde exatamente à instalada.
- Segue nomes, módulos e organização locais. Uma rota adapta o contrato; o domínio decide; o repositório persiste. Não cria um endpoint privativo do Hub que contorne a API.
- Usa composição simples e dependências explícitas. Extrai código quando há repetição efetiva ou uma fronteira clara; não cria fábricas, camadas genéricas ou serviços distribuídos por antecipação.
- Mantém funções pequenas pela responsabilidade, não por um limite arbitrário de linhas. Nomeia efeitos laterais e separa-os dos cálculos puros quando a fronteira existente o permitir.

## Tipos não dispensam validação

- Preserva `strict`, `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes` existentes. Não resolve erros com `any`, `as unknown as`, `!` ou supressões generalizadas.
- Trata dados externos como desconhecidos até validar. Uma asserção de tipo não prova um pedido HTTP, um JSON ou a resposta de um prestador.
- Define esquemas de entrada e de resposta compatíveis com o contrato. Enumera os campos permitidos e rejeita ou ignora campos adicionais segundo uma política escrita e testada; não espalha `request.body` para a base.
- Distingue campo omitido, `null`, vazio e zero. Em PATCH, não transforma omissão em apagamento nem ignora uma mudança para zero.
- Autoriza campos e objetos antes de serializar. Não devolve custo, margem, dados pessoais ou campos internos e depois os esconde no browser.
- Não compila esquemas recebidos de comerciantes ou extensões como código. Mantém limites de tamanho e tipos de conteúdo; valida a sintaxe antes de trabalho assíncrono caro ([Fastify: validação e serialização](https://fastify.dev/docs/v5.10.x/Reference/Validation-and-Serialization/)).

## Erros e recursos

- Traduz falhas conhecidas para códigos estáveis do domínio, preservando a causa para diagnóstico seguro. Não confunde indisponibilidade com “não encontrado” nem captura tudo para devolver sucesso.
- Não envia stack traces, SQL, credenciais ou o objeto bruto do erro ao cliente. O `detail` de PostgreSQL e a saída do processo também podem expor dados: testa a saída completa, não só a função de sanitização.
- Usa `await` ou uma fila durável para trabalho obrigatório. Não deixa uma promessa de envio, gravação ou auditoria esquecida depois da resposta.
- Garante fecho e limpeza de ligações, processos, ficheiros e temporizadores também no caminho de erro. Falha de limpeza não deve ocultar a falha original.
- Mantém cursor, ordenação estável e limites conforme `headless-commerce`; testa a continuação da lista, não apenas a primeira página.

## Interface e extensões

No Hub, consulta também `eurolify-design`: carregamento, vazio, erro, conflito, acesso recusado e confirmação sensível fazem parte do fluxo. Validação do browser ajuda o utilizador, mas nunca decide preço, IVA, permissões ou stock.

Extensões passam pelos contratos de `third-party-extensions`. Não obtêm acesso direto às tabelas, poder de executar esquemas arbitrários nem autoridade para alterar regras fiscais/legais.

## Desempenho

Não promete capacidade sem medir. Limita listas, cargas e concorrência; procura N+1 e consultas sem índices adequados. Para alterações de consulta, usa `EXPLAIN`/medição num ambiente autorizado com dados representativos e anonimização. Um teste de resultado não prova que o índice foi usado.

Base técnica: [modo strict do TypeScript](https://www.typescriptlang.org/tsconfig/strict.html) e [Fastify: validação e serialização](https://fastify.dev/docs/v5.10.x/Reference/Validation-and-Serialization/). Estas são referências técnicas, não regras jurídicas da UE.
