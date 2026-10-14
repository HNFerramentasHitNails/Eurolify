# Envios: a Sendcloud não aceita contas com faturação em Portugal (14/10/2026)

Pergunta do Diogo, 14/10/2026: *«o sendcloud nao tem portugal?!»*, ao ir
criar a conta de teste para verificar a Sendcloud no ensaio (`docs/36` §11,
V6; issue #393).

## O que se fez

- Pesquisa na Web (14/10/2026). O resumo da pesquisa cita a página de ajuda
  da Sendcloud «How to ship from Portugal using Sendcloud»
  (`support.sendcloud.com/hc/en-us/articles/36317556679569`). Segundo esse
  resumo (**W, não lido**: a página recusa o acesso automático, 403):
  - não se cria uma conta com morada de faturação em Portugal;
  - as faturações aceites são Áustria, Bélgica, França, Alemanha, Itália,
    Países Baixos, Espanha e Reino Unido;
  - o país de faturação fica fixo depois do registo;
  - para expedir de Portugal, a morada de origem tem de ser em Portugal e o
    comerciante precisa do seu próprio contrato com uma transportadora
    suportada (DHL Express, DHL Parcel Iberia, FedEx, GLS Spain, MRW, Paack,
    Tipsa, UPS), a partir da assinatura Lite.
- Registado no `docs/36` §11, V6.

## Números (com data e como se contaram)

- 8 países de faturação aceites, contados no resumo da pesquisa de
  14/10/2026; Portugal não está entre eles.

## O que ficou por verificar

- Ler a página da Sendcloud directamente, num navegador, e confirmar o texto
  e a data.
- O que isto muda na Q2 do `docs/36` (a Sendcloud a seguir aos CTT): um
  comerciante português só usaria a Sendcloud com faturação noutro país e
  contrato próprio. Decisão do Diogo ou do Bruno.
- O adaptador (`apps/api/src/envios/sendcloud.ts`) e os testes continuam
  válidos para comerciantes dos países aceites; não se mudou código.
