# ADR-0015 · O Eurolify fica alojado numa VPS operada pelo Diogo e pelo Bruno

- **Estado:** aceite · substitui o [ADR-0003](0003-alojamento-europeu-gerido.md)
  e o [ADR-0004](0004-fornecedor-scaleway.md); deixa sem efeito o
  [ADR-0011](0011-preparacao-da-conta-scaleway.md) quanto ao alojamento; muda
  o sítio do ensaio do [ADR-0014](0014-um-so-ensaio.md). Quem opera é o
  Claude: [ADR-0016](0016-o-claude-opera-a-vps.md) · a máquina é uma VPS-3 da OVH:
  [ADR-0017](0017-vps-3-da-ovh.md) · a do ensaio está, por agora, no Reino
  Unido: [ADR-0018](0018-vps-do-ensaio-no-reino-unido.md)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-3 (`docs/06-decisoes-em-aberto.md`),
  revista

## Contexto

A 03/10/2026 o alojamento estava decidido num fornecedor europeu com serviços
geridos, a Scaleway (ADR-0003, ADR-0004). Na mesma noite, depois de ver o
preço da base do ensaio (POP2-2C-8G ≈ 106 €/mês), o Diogo perguntou:
*«alternativamente comprar uma VPS na OVH instalar o supabase self host e
vercel self hosted, não ficaria muito mais barato??»*, e depois: *«se comprar
uma vps consegues gerar o script para instalar tudo na maquina necessário para
fazer deploy automatico a partir do github, postgresql, e mcp para conectar o
claude para tudo funcionar. Assim comprava so a VPS e ficavamos nos a
controlar tudo!»*

Lido nesse dia (pormenor em `memoria/vps-operada-por-nos-03out2026.md`):

- **Preços.** VPS da OVH, página portuguesa: VPS-2 (4 vCores, 8 GB, 75 GB)
  *«a partir de 7,21 € + IVA/mês»*; VPS-3 (6 vCores, 12 GB, 100 GB) *«a partir
  de 10,40 € + IVA/mês»*; com *«Backup automatizado 1 dia»*. Na Scaleway
  gerida, o arranque da produção estava contado em ≈ 234 €/mês (base com
  segunda máquina e 2 contentores).
- **O que a máquina não traz.** A documentação da Coolify diz: *«You remain
  responsible for… Operating system updates, SSH access, firewall rules»*. A
  Vercel não tem versão para instalar; o que se instala é o Next.js. A
  Supabase instalada por nós pede 4 GB de RAM no mínimo e não traz os registos
  ligados.

O Claude disse que discordava para a produção (as faturas de outras empresas
passam a depender de operação que a D-3 escreveu que ninguém na equipa faz) e
perguntou: *«mudas o alojamento para uma VPS operada por vocês os dois, ou fica
a Scaleway gerida?»* Resposta do Diogo, a 03/10/2026: *«o alojamento para uma
VPS operada por vocês os dois — prepara tudo, todas as memorias, instruções e
documentação para começarmos a preparar a vps»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Scaleway, serviços geridos (ADR-0003/0004) | A segunda máquina da base, as cópias e as actualizações são da Scaleway | ≈ 234 €/mês no arranque; menos controlo da máquina |
| **b) VPS operada pelo Diogo e pelo Bruno, com o Claude** | Dezenas de euros por mês; controlo total da máquina | A segunda máquina, as cópias, as actualizações, a firewall e os alertas passam a ser nossos |

## Decisão

1. O Eurolify (núcleo, Hub, base de dados, ensaio) fica numa **VPS operada pelo
   Diogo e pelo Bruno**, num centro de dados **na UE**. Quem opera é o Claude
   (ADR-0016).
2. **Publica-se pelo GitHub**, como no ADR-0005: o pedido de alteração revisto
   (ADR-0013) entra no `main` e o mesmo caminho põe no ar.
3. Mantém-se do ADR-0014: **um só ensaio, actualizado a cada entrada no
   `main`** — agora na VPS.
4. **Abre o ADR-0001 só para a preparação da VPS**, como o ADR-0011 fez para a
   Scaleway: o script de instalação e a configuração da máquina. O código do
   produto continua fechado. O script é código: entra no `main` com as duas
   revisões do ADR-0013.

## Consequências

- **Passa a ser nosso**, e está no guia `docs/11-preparacao-da-vps.md`:
  actualizações do sistema, firewall, acesso por SSH, PostgreSQL, cópias fora da
  máquina com ensaio de reposição, segunda máquina para a base (se a houver),
  certificados, alertas e o registo do que se faz na máquina.
- **Os dados continuam na UE** (regra 4 do `AGENTS.md`): o centro de dados tem
  de ser na UE e o fornecedor da VPS passa a subcontratante (acordo de
  tratamento de dados e registo de tratamentos antes do primeiro dado pessoal
  real — skill `eu-gdpr-privacy`).
- **Por decidir** (lista no `docs/11` §7): o fornecedor e o plano (a OVH foi a
  proposta do Diogo); quantas máquinas (ensaio e produção juntos ou separados);
  onde ficam as cópias; a ferramenta de publicação (Coolify ou o GitHub por
  SSH); o que se faz à conta da Scaleway (a chave só de leitura do Diogo vale
  até 03/10/2027, e o ADR-0009 propunha lá comprar os domínios).
- As contas de custo do `docs/09` e do `docs/10` estavam feitas para a
  Scaleway gerida: **não foram recalculadas** para a VPS. E o tempo de operar a
  máquina não está no tempo do Diogo e do Bruno do `docs/10` §9.
- **O que pode partir:**
  - com uma só máquina e só a cópia diária da OVH, uma avaria às 18h perde o
    que entrou desde a última cópia — encomendas e pedidos de fatura de outras
    empresas;
  - uma actualização de segurança que ninguém aplica, uma cópia que deixa de
    correr ou um disco cheio só se vêem se os alertas existirem e alguém os ler
    (lição: o recálculo diário esteve parado 15 dias sem ninguém saber, repo
    `claude`, 05/09/2026);
  - a apresentação para o Bruno e a Cila ainda mostra a Scaleway.

## O que ficou por verificar

- Os centros de dados da UE disponíveis para as VPS da OVH e as condições do
  preço «a partir de» (a página irlandesa, lida por resumo, fala de 12 meses
  adiantados).
- O preço do armazenamento para as cópias fora da máquina.
- O acordo de tratamento de dados do fornecedor da VPS.
