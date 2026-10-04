# ADR-0027 · O ensaio: cópias na Scaleway, alertas pelo Healthchecks.io, IP guardados 14 dias, acesso por túnel SSH

- **Estado:** aceite · as cópias passam para o OVH Object Storage e a chave da Scaleway deixa de existir: [ADR-0032](0032-ovh-fornecedor-unico.md) · ponto 1 mudado pelo
  [ADR-0029](0029-chave-do-age-tambem-na-vps.md) (a chave privada do `age`
  também na VPS) · **só para o ensaio** (a VPS-1 do
  [ADR-0021](0021-vps-1-ate-a-migracao.md)); para a produção, os pontos 4 e 7
  do `docs/11` §7 continuam por decidir · completa o
  [ADR-0014](0014-um-so-ensaio.md) (endereço) e o
  [ADR-0018](0018-vps-do-ensaio-no-reino-unido.md) (retenção dos IP)
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** `docs/11-preparacao-da-vps.md` §7, pontos 4
  e 7; ADR-0018 («quanto tempo se guardam»); ADR-0014 (o endereço); A5 do
  pedido de 04/10/2026

## Contexto

- O ensaio não tem dados pessoais reais (ADR-0018); os registos técnicos
  guardam endereços IP, que são dados pessoais (skill `eu-gdpr-privacy`).
- Scaleway Object Storage, lido a 04/10/2026 (`scaleway.com/en/pricing/storage`):
  «Standard One Zone» 0,00803 €/GB/mês, «Standard Multi-AZ» 0,01606 €,
  «Glacier» 0,00254 €; saída: 75 GB grátis por mês; regiões Paris, Amesterdão
  e Varsóvia. A conta da Scaleway existe, com chaves só de leitura (ADR-0011).
  O preço do Object Storage da OVH: a página lida não o mostrou — **não
  verificado**.
- Healthchecks.io, lido a 04/10/2026: empresa SIA Monkey See Monkey Do,
  Riga, **Letónia**; servidores *«Hetzner bare metal»* (país não dito);
  plano «Hobbyist» 0 $/mês, 20 tarefas vigiadas, 100 registos por tarefa.
- RGPD, art. 5.º, n.º 1, al. e) (limitação da conservação): dá o princípio,
  não um prazo para registos de segurança.
- O Diogo comprou o domínio `eurolify.eu` a 04/10/2026 (registador não dito);
  o DNS público respondia «não existe» nessa altura.

Pergunta feita ao Diogo, com as quatro peças abaixo: *«Fica assim a A5?»*
Resposta, a 04/10/2026: *«sim»*.

## Opções consideradas

| Peça | Escolhida | Deixada |
|---|---|---|
| Cópias | `pg_dump` diário cifrado com `age` → Scaleway Object Storage Paris, One Zone, 14 dias | só a cópia diária da OVH (não sai da máquina); Object Storage da OVH (preço não lido) |
| Alertas | Healthchecks.io (UE) a vigiar as tarefas + verificação diária na VPS | servidor de e-mail na VPS; nenhum |
| IP nos registos | 14 dias | o que o sistema guardar por omissão |
| Endereço | portas 80/443 fechadas, túnel SSH; `ensaio.eurolify.eu` mais tarde | endereço público já |

## Decisão

1. **Cópias do ensaio:** `pg_dump` diário às 03:00 UTC, cifrado com `age` (só
   a chave pública na VPS; a privada fora, com o Diogo), enviado para um
   contentor **privado** no ~~**Scaleway Object Storage, Paris, One Zone**~~ **OVH Object Storage, Standard, Paris em três zonas** (ADR-0032; ~~Gravelines~~), com
   expiração aos **14 dias**. **Ensaio de reposição semanal** automático numa
   base temporária da própria VPS, que confere tabelas e linhas. Pode perder-se
   até 24 h de dados do ensaio.
2. **Alertas:** cada tarefa (cópia, reposição, verificação) avisa o
   **Healthchecks.io**; se não avisar, ou avisar «falhou», segue um e-mail para
   o Diogo (e o Bruno, quando tiver conta). A **verificação diária** na VPS
   avisa «falhou» com: disco acima de 80 %, memória, serviços em baixo,
   actualizações de segurança por aplicar, certificado a expirar, token do
   GHCR a expirar (ADR-0026), e as datas **01/03/2027** (fim do Reino Unido,
   ADR-0019) e **28/10/2026** (Node 26, ADR-0025).
3. **Endereços IP nos registos: 14 dias** — journal (`MaxRetentionSec=14d`),
   registos do `ufw` e base do `fail2ban` (`dbpurgeage = 14d`).
4. **Endereço do ensaio:** as portas 80 e 443 **ficam fechadas**; a API ouve
   só em `127.0.0.1`; o ensaio vê-se por túnel SSH
   (`ssh -L 8080:127.0.0.1:8080 eurolify-ensaio`). `ensaio.eurolify.eu`, com o
   Caddy e certificado, é uma decisão própria quando o DNS responder (abre as
   portas 80 e 443).

## Consequências

- **O Diogo cria:** na ~~Scaleway~~ OVH (ADR-0032), uma chave ~~que só escreve~~ **de leitura e
  escrita só nesse contentor** (corrigido a 04/10/2026, revisão do #10: a
  reposição semanal lista e lê as cópias; com uma chave só de escrita falhava
  todas as semanas); no
  Healthchecks.io, a conta com o e-mail dele. Os segredos vão para a VPS pelo
  script, nunca pelo chat (`AGENTS.md`).
- O script de preparação (C3) faz tudo isto e reproduz o que se fez à mão.
- O Healthchecks.io e a ~~Scaleway~~ OVH (ADR-0032) passam a fornecedores do ensaio; não recebem
  dados pessoais (os avisos não levam conteúdo; as cópias vão cifradas e o
  ensaio não tem dados reais).
- **O que pode partir:**
  - se o Healthchecks.io falhar, os alertas falham com ele;
  - uma reposição só na própria VPS não prova a reposição numa máquina nova
    (a migração para Paris);
  - perder a chave privada do `age` torna as cópias ilegíveis;
  - 14 dias de registos podem não chegar para investigar um incidente
    descoberto tarde.

## O que ficou por verificar

- O país dos servidores do Healthchecks.io; se o plano gratuito manda e-mail
  (a página de preços não o diz).
- O preço do Object Storage da OVH.
- O registador do `eurolify.eu` e quando o DNS responde.
