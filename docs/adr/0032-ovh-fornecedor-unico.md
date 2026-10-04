# ADR-0032 · A OVH é o fornecedor único: as cópias do ensaio vão para o Object Storage da OVH e a Scaleway deixa de se usar

- **Estado:** aceite · ⚠️ **contentor em Paris, três zonas (`eu-west-par`), não em Gravelines** — criado assim pelo Diogo e mantido com o OK dele a 04/10/2026; `rclone` com `provider = Other` (a versão do Ubuntu não conhece `OVHcloud`) · muda o ponto 1 do
  [ADR-0027](0027-copias-alertas-registos-e-endereco-do-ensaio.md) e do
  [ADR-0029](0029-chave-do-age-tambem-na-vps.md) (Scaleway Object Storage) ·
  põe fim ao [ADR-0011](0011-preparacao-da-conta-scaleway.md) (conta da
  Scaleway, já sem efeito para o alojamento pelo ADR-0015) · fecha o
  `docs/11` §7, ponto 9
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** `docs/11-preparacao-da-vps.md` §7, ponto 9
  (o que se faz à conta da Scaleway)

## Contexto

O Diogo, a 04/10/2026, durante a Fase D: *«entretanto deixamos de usar o
scaleway e passamos a usar so o ovh, ja que a vps é de lá»*; e, à proposta do
Claude (Object Storage da OVH em Gravelines): *«usamos sempre o ovh para
centralizar tudo em um unico fornecedor»*.

Lido a 04/10/2026:

- `ovhcloud.com/en-ie/public-cloud/object-storage`: *«S3-compatible»*; classes
  numa zona (High Performance, Standard, Infrequent Access) e em três zonas;
  regiões em Gravelines, Estrasburgo, Roubaix, Frankfurt, Varsóvia, Paris,
  Milão e Londres; *«no hidden fees»* de entrada, saída ou chamadas.
- Catálogo público da OVH (`eu.api.ovh.com/v1/order/catalog/public/cloud`,
  subsidiária PT): `storage-standard.monthly.postpaid` **0,007 €** por mês;
  `storage-standard.consumption` 0,00001 € por hora (≈ 0,0073 € por mês);
  entrada e tráfego interno 0 €. A unidade (por GB) não vem escrita no
  catálogo: **presumida, não verificada**.
- Para comparar: Scaleway One Zone 0,00803 €/GB/mês (ADR-0027).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| Ficar com a Scaleway para as cópias | As cópias sobrevivem a um problema na conta da OVH | Dois fornecedores, duas contas, dois acordos de tratamento de dados |
| **A OVH para tudo** | Um fornecedor, uma conta, um acordo de tratamento de dados; o preço é da mesma ordem | VPS e cópias no mesmo fornecedor e na mesma conta |

## Decisão

1. **A OVH é o fornecedor único do Eurolify** (VPS, cópias e o que vier).
2. As cópias do ensaio vão para o **OVH Object Storage, classe Standard,
   ~~numa zona, em Gravelines (França, UE)~~ em três zonas, em Paris (França,
   UE)** (corrigido a 04/10/2026: o contentor foi criado em `eu-west-par` e
   ficou lá, com o OK do Diogo), num contentor privado com expiração aos
   14 dias, com um utilizador S3 que só acede a esse contentor (leitura e
   escrita: a reposição lê). Tudo o resto do ADR-0027 e do ADR-0029 mantém-se
   (pg_dump diário cifrado com `age`, reposição semanal, chave privada também
   na VPS).
3. **A Scaleway deixa de se usar:** o Diogo revoga a chave só de leitura
   `claude-leitura` (válida até 03/10/2027) e tira das definições do ambiente
   do Claude Code as variáveis `SCW_*` e o *setup script* do `scw`
   (ADR-0011), que vivem fora do repositório. Fechar a conta é decisão dele.

## Consequências

- No `infra/vps`, o remoto do `rclone` passa de `scaleway` a `ovh`
  (`ensaio.conf`, `LEIA-ME`, com o modelo do `rclone.conf`: ~~`provider =
  OVHcloud`, `region = gra`, `endpoint = s3.gra.io.cloud.ovh.net`~~ —
  `rclone.org/s3`, lido a 04/10/2026) → **na VPS:** `provider = Other`,
  `region = eu-west-par`, `endpoint = s3.eu-west-par.io.cloud.ovh.net` (o
  `rclone` 1.60.1 do Ubuntu 26.04 não conhece `OVHcloud`; ver o `LEIA-ME`).
- **Os 14 dias na OVH garante-os o `eurolify-copia`** (`rclone delete
  --min-age 14d`), não só uma regra do contentor: a revisão do pedido viu que
  a expiração dependia de uma *lifecycle* não confirmada. A documentação da
  OVH descreve regras com `Expiration`/`Days`; fica como segunda trava.
- O D5 da Fase D passa a ter: criar na OVH o contentor de Object Storage
  (~~Gravelines~~ Paris em três zonas, Standard — criado assim) e o
  utilizador S3 só com acesso a ele.
- Um só acordo de tratamento de dados a assinar antes do primeiro dado
  pessoal real (`docs/11` §4; skill `eu-gdpr-privacy`).
- **O que pode partir:**
  - **VPS e cópias no mesmo fornecedor e na mesma conta:** uma suspensão ou
    um comprometimento da conta da OVH leva as duas. Aceite para o ensaio (sem
    dados reais); **para a produção, a regra 1 aplica-se, mas onde ficam as
    cópias decide-se de novo** (`docs/11` §7, ponto 4) — o Claude disse-o uma
    vez, a 04/10/2026;
  - a unidade do preço não estar confirmada.

## O que ficou por verificar

- O preço por GB na página de preços da OVH (o catálogo não diz a unidade).
- Se o utilizador S3 da OVH se limita a um só contentor (política de acesso)
  ou a todo o projecto Public Cloud.
- O registador do `eurolify.eu` (se é a OVH).
