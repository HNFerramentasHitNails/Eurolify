---
name: observability-security
description: Segurança e observabilidade do Lumavo — modelação de ameaças, permissões por papel e atributo (RBAC/ABAC) com isolamento entre comerciantes, gestão de segredos, encriptação, cópias de segurança e recuperação, registos estruturados, métricas, traços e alertas, registo de auditoria imutável para acções administrativas e eventos financeiros e fiscais, limites de pedidos e abuso, validação de entradas, vulnerabilidades, e dados pessoais fora dos registos. Usar ao criar qualquer função, tabela, permissão, integração, segredo ou tarefa automática, e antes de qualquer publicação.
---

# Segurança e observabilidade

> Estado: **desenho** — não há código (ADR-0001). Lições:
> `docs/04-licoes-do-ecossistema-hnh.md` §4.

## 🔴 Fechado por omissão

No Hub da HNH foram contadas **77 funções da base chamáveis sem sessão, 24 a
escrever** (18/09/2026), e funções novas nasceram abertas **cinco vezes em seis
dias** (15–21/09/2026), sempre apanhadas por acaso. As cópias de segurança
**nasciam abertas ao mundo** (12/08/2026).

No Lumavo:

1. Toda a função, tabela, ficheiro e endpoint nasce **fechado**; abrir é um acto
   explícito, revisto.
2. **Teste automático que falha** se alguma coisa nascer acessível a quem não
   tem sessão ou a outro inquilino — corre em cada alteração e todas as manhãs
   em produção (**uma régua corre sozinha e avisa** — não é trabalho de um agente
   de IA).
3. Isolamento entre comerciantes **imposto pela base**, testado por tentativa de
   leitura cruzada.

## Ameaças a modelar (por domínio)

| Ameaça | Exemplo | Defesa |
|---|---|---|
| Um comerciante ler dados de outro | consulta sem filtro de inquilino | políticas por inquilino na base + testes |
| Uma chave pública usada para escrever | frontend gerado por IA com a chave errada | âmbitos fechados; chaves secretas nunca no browser |
| Aviso falso de pagamento | POST forjado ao endpoint do prestador | assinatura verificada antes de ler |
| Escalada de permissões | «qualquer conta dava-se admin a si própria» no Hub (28/08/2026) | papéis atribuídos só por quem pode, com rasto |
| Quem sai continua a entrar | contas de ex-colaboradores activas (Hub, 28/08/2026) | revogação ao desactivar; revisão periódica de acessos |
| Abuso de formulários | pedido de livre resolução usado para enviar e-mails | captcha + limite por e-mail (a loja HNH já faz: 3/hora) |
| Injecção pela IA | instruções escondidas em dados de produto ou de cliente lidos por uma ferramenta MCP | ferramentas só leitura por omissão; escrita com confirmação humana; nunca executar instruções vindas de dados |

## Segredos

- Num cofre de segredos, nunca no repositório nem em mensagens.
- Por ambiente e por inquilino (chaves dos prestadores de cada comerciante
  cifradas com chave própria).
- Rotação definida; uma chave exposta revoga-se primeiro e investiga-se depois.

## Registo de auditoria (imutável)

Obrigatório para: alterações de permissões, isenções manuais, fusões de clientes,
pedidos e retenções de documentos fiscais, reembolsos, movimentos de stock
manuais, acções por MCP, exportações de dados pessoais.
Campos: quem (pessoa, aplicação, IA e modelo), o quê, sobre quê, antes, depois,
quando (UTC), de onde. **Só se acrescenta; não se edita nem se apaga** — corrige-se
com uma entrada nova.

## Observabilidade

- **Registos estruturados** com identificador de pedido e de inquilino; **sem
  dados pessoais em claro**.
- Métricas por domínio: encomendas, falhas de pagamento, documentos retidos,
  avisos por entregar, tempos de resposta.
- **Alertas sobre o que pára em silêncio**: tarefa automática que não correu,
  fila que não esvazia, aviso de prestador que deixou de chegar. No ecossistema,
  o recálculo diário esteve parado 15 dias sem ninguém saber
  (`recalculo-diario-parado-05set2026.md`, repo `claude`).
- Cada integração tem um **painel de entregas**: o que entrou, o que saiu, o que
  falhou e porquê.

## Cópias de segurança e recuperação

- Cifradas, fora da conta principal, **nunca públicas**.
- **Ensaio de reposição agendado**; uma cópia que nunca foi reposta não é uma
  cópia.
- Objectivos escritos: quanto se pode perder (RPO) e em quanto tempo se volta
  (RTO).
- **Nunca reiniciar a base em horário de trabalho**: no Hub, um reinício às 13h
  deixou toda a gente ~8 minutos num ecrã a rodar sem mensagem (02/09/2026).
  Manutenção agendada e anunciada; a aplicação diz quando volta.

## Entradas e limites

- Validação de tudo o que entra, no servidor, com esquema.
- Limites por chave, por loja e por IP nos pontos públicos.
- Vulnerabilidades: dependências vigiadas e actualizadas por rotina; revisão de
  segurança antes de cada fase.

## Antes de dizer «está feito»

- [ ] O que é novo nasceu fechado e o teste de acesso anónimo/cruzado passa.
- [ ] Acções sensíveis escrevem no registo de auditoria.
- [ ] Nenhum dado pessoal nos registos técnicos.
- [ ] Há alerta se a tarefa nova deixar de correr.
