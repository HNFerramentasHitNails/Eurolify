# ADR-0004 · O fornecedor de alojamento é a Scaleway

- **Estado:** aceite · a publicação ficou decidida no [ADR-0005](0005-publicacao-pelo-github.md) · a conta, as chaves e o acesso do Claude ficaram preparados pelo [ADR-0011](0011-preparacao-da-conta-scaleway.md)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-3 (`docs/06-decisoes-em-aberto.md`);
  completa o [ADR-0003](0003-alojamento-europeu-gerido.md)

## Contexto

O ADR-0003 decidiu o alojamento num fornecedor europeu com serviços geridos e
deixou o fornecedor por escolher: a Scaleway (Paris), com preços lidos a
03/10/2026, ou a OVHcloud, que não foi verificada. Números e fontes em
`memoria/alojamento-e-custos-03out2026.md` e
`memoria/scaleway-mcp-e-deploy-03out2026.md`.

Pergunta feita ao Diogo: *«A Scaleway fica como o fornecedor escolhido, ou
compara-se primeiro com a OVHcloud?»* Resposta, a 03/10/2026: *«fica a
scaleway»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **Scaleway** | Preços lidos (PostgreSQL gerido desde ≈ €105/mês, com segunda máquina desde ≈ €55/mês — corrigido a 03/10/2026: era ≈ €44, a coluna Multi-AZ, que só vale para réplicas de leitura; contentores ≈ €37/mês cada sempre ligado); MCP oficial (`scw mcp`) que pode ficar só de leitura; a API chega às sessões do Claude | O preço do tráfego e o do armazenamento de ficheiros não foram lidos |
| OVHcloud | Europeia | Não verificada |

## Decisão

O Eurolify fica alojado na **Scaleway**, com serviços geridos: PostgreSQL gerido
com máquina de reserva, contentores para a API e os processos sempre ligados, e
armazenamento de ficheiros. Sem comparação com a OVHcloud.

## Consequências

- **Não é o OK para código.** Abrir a conta, criar chaves e configurar
  serviços ou o MCP espera pelo OK escrito do Bruno ou do Diogo (ADR-0001).
- A proposta de como se publica (pelo GitHub, com o MCP da Scaleway só de
  leitura para o Claude e escrita só num projecto de ensaio) continua **por
  decidir**.
- Ficam por ver na Scaleway: a região (só Paris foi lida), o preço do tráfego e
  do armazenamento, as certificações, o contrato de tratamento de dados e as
  permissões das chaves (IAM).

## O que ficou por verificar

- A OVHcloud não foi vista: não se sabe se seria mais barata ou mais adequada.
- Os pontos da Scaleway listados acima.
