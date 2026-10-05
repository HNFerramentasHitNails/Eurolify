---
name: eurolify-engineering-execution
description: "Implementa e revê código da Eurolify: TypeScript, Fastify, PostgreSQL, contratos, concorrência, migrações e integrações seguras. Usa ao desenvolver funcionalidades ou corrigir código; complementa as skills existentes, sem decidir regras de negócio, legislação, modelos de IA ou publicação."
metadata:
  version: "1.0.0"
  verified_at: "2026-10-05"
---

# Engenharia de implementação da Eurolify

Complementa, não substitui, `AGENTS.md`, ADR em vigor e skills de domínio. Se divergirem, expõe o conflito e segue a decisão vigente; não muda decisões, permissões ou ferramentas para caber nesta skill. Não instala nem publica automaticamente.

## Ler só o necessário

Depois do arranque obrigatório do repositório:

- Código, rotas, tipos ou dependências: lê `references/implementation.md`.
- SQL, isolamento, estados, migrações, dinheiro ou escritas simultâneas: lê `references/data-integrity.md`.
- Pedidos repetíveis, outbox, webhooks ou serviços externos: lê `references/integrations.md`.
- Código ou testes alterados: lê `references/verification.md` antes de concluir.
- Para conferir origem, versão ou limites de uma recomendação: lê `references/basis.md`; não carrega este ficheiro por rotina.

As skills de arquitetura, contrato, segurança, legislação e design continuam obrigatórias nos temas respetivos. Usa as skills de sessão, memória, eficiência e comunicação já existentes; não cria uma segunda política para elas.

## Execução

1. **Localiza o trabalho.** Confirma issue, dono, ramo, alterações recentes e desenho aceite, como manda `AGENTS.md`. Não pisa trabalho alheio. Distingue documentos históricos do estado demonstrado pelo código e pelos ADR atuais.
2. **Define a fatia.** Escreve o resultado observável, invariantes, contrato afetado e cenários que devem falhar. Sem desenho do domínio ou decisão necessária, apresenta a dúvida ao utilizador antes de escrever código desse domínio; trabalho independente já autorizado pode continuar.
3. **Escolhe o dono de cada regra.** Reutiliza a implementação existente; identifica a camada autoritativa no servidor. No código atual, certas invariantes vivem na base: não as transfere para TypeScript nem as reimplementa no Hub.
4. **Implementa o mínimo completo.** Mantém as ferramentas e versões aprovadas, padrões locais e fronteiras dos módulos. Inclui validação, autorização, erros e consistência; não acrescenta abstrações, bibliotecas ou funcionalidades especulativas.
5. **Prova os casos difíceis.** Verifica outro comerciante, papel sem acesso, estado inválido e repetição ou concorrência quando aplicáveis. Testes de SQL usam PostgreSQL real e o papel efetivo da API. Um teste tem de falhar quando a proteção que pretende provar é retirada.
6. **Revê a entrega.** Usa `eurolify-evidence-before-done` e o processo atual de revisão de `AGENTS.md`. Não enfraquece CI, tipos, testes ou permissões para obter verde. Não declara uma simulação como integração, um formulário como fluxo completo nem código revisto como já publicado.

## Limites

- Não inventa taxas, prazos, obrigações ou arredondamentos fiscais. Usa a skill jurídica/fiscal aplicável e a classificação W/M/C do projeto; país ou tipo de artigo não validado mantém a operação bloqueada.
- Não faz ações reais de pagamento, faturação, reembolso, alteração da VPS ou correção de dados só para testar. Usa ambiente descartável e dados fictícios; ações reais seguem a autorização do projeto.
- Não muda a seleção de modelos nem o mecanismo de revisão: estes têm regras próprias atualizáveis no repositório.

## Exemplo de resultado para gestão

Pedido: impedir que duas alterações apaguem o trabalho uma da outra.

Resposta: «Foi preparada a proteção contra alterações simultâneas. Se duas pessoas alterarem o mesmo artigo, a segunda recebe um aviso para reler o artigo. Verificado em testes; ainda não publicado. Falta a revisão prevista no projeto.» Usa esta forma apenas quando cada afirmação tiver evidência.
