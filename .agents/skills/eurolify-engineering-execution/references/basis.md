# Origem, compatibilidade e limites

Lê este ficheiro para auditar origem ou confirmar uma referência; não o carregues por rotina. Consulta feita a 05/10/2026; volta a ler o repositório antes de executar uma tarefa.

## Base do projeto

Esta skill é uma proposta complementar, autorizada pelo utilizador, para uso com o Claude Code e o Codex. Não foi instalada no repositório nem aprovada como novo ADR.

A governação, a localização partilhada das skills e as condições de revisão/alteração vêm do [AGENTS.md](https://github.com/HNFerramentasHitNails/Eurolify/blob/main/AGENTS.md). As ferramentas escolhidas constam do [ADR-0025](https://github.com/HNFerramentasHitNails/Eurolify/blob/main/docs/adr/0025-ferramentas-do-codigo.md), os comandos do [package.json](https://github.com/HNFerramentasHitNails/Eurolify/blob/main/package.json) e o gate consultado do [workflow verificar](https://github.com/HNFerramentasHitNails/Eurolify/blob/main/.github/workflows/verificar.yml).

Foram lidas também as skills atuais `platform-architect`, `headless-commerce`, `observability-security`, `eurolify-efficient-workflow` e `eurolify-evidence-before-done`, bem como código de Comerciante, Catálogo, configuração TypeScript, migração inicial e a memória de Catálogo. Não se fez uma auditoria de todos os ficheiros do produto.

O padrão transacional de contexto está no [repositório do domínio Comerciante](https://github.com/HNFerramentasHitNails/Eurolify/blob/main/apps/api/src/comerciante/repositorio.ts). A skill manda reutilizá-lo, não instalar um concorrente.

## Referências técnicas consultadas

- **RLS:** a distinção entre dono, superutilizador, `BYPASSRLS`, `FORCE RLS`, `USING` e `WITH CHECK` foi conferida na [documentação PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
- **Esquemas:** esquemas tratados como código de confiança, validação antes de trabalho caro e serialização de resposta foram conferidos em [Fastify, validação e serialização v5.10.x](https://fastify.dev/docs/v5.10.x/Reference/Validation-and-Serialization/). É documentação de referência próxima, não garantia sobre cada comportamento da versão instalada.
- **Tipos:** a família de verificações strict foi conferida na [documentação TypeScript](https://www.typescriptlang.org/tsconfig/strict.html). Preservar as opções atuais é uma regra da proposta, não uma recomendação de atualizar o compilador.
- **Segurança verificável:** o [OWASP ASVS](https://owasp.org/projects/asvs) fornece requisitos técnicos e recomenda identificadores com versão. Se o projeto adotar um requisito ASVS, regista versão e identificador efetivamente conferidos; não inventa IDs nem afirma certificação.

Estas referências são técnicas. Não introduzem legislação de fora da UE nem substituem fontes oficiais da UE/Estados-membros.

## O que esta proposta não decide

Não altera modelos de IA, prazos de revisão, versões de API, ferramentas, fases, países ativados, regras de emissão fiscal ou exceções de alojamento. Não estabelece metas arbitrárias de cobertura, capacidade ou latência.

As regras de implementação adicionadas, incluindo testes discriminatórios, gestão de dados concorrentes e migrações compatíveis, são recomendações de engenharia adaptadas ao projeto. Não são uma declaração de conformidade legal ou de produção pronta.
