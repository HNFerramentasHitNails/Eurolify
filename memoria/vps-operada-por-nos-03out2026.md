# Alojamento numa VPS operada por nós, com o Claude a operá-la (03/10/2026)

**Decisões do Diogo (03/10/2026, à noite):**
- *«o alojamento para uma VPS operada por vocês os dois — prepara tudo, todas
  as memorias, instruções e documentação para começarmos a preparar a vps»* —
  ADR-0015, decisão V em `docs/06`;
- *«O claude vai controlar tudo!! esta é uma decisão!!»* — ADR-0016, decisão W.

Substituem a Scaleway gerida (ADR-0003, ADR-0004) e o «Claude só lê»
(ADR-0005 pontos 2 e 3, ADR-0011). O ensaio único do ADR-0014 passa para a VPS.

## Como se chegou aqui

1. Pergunta sobre a publicação na Scaleway → um só ensaio (ADR-0014,
   `scaleway-publicacao-ensaio-03out2026.md`).
2. A DB-DEV-S ainda se cria, mas é de 1.ª geração; o Diogo quis máquina
   moderna (*«temos de pensar em escalabilidade»*). O Claude concordou pela
   igualdade com a produção, não pela escala.
3. O preço da POP2-2C-8G (≈ 106 €/mês) levou à pergunta *«comprar uma VPS na
   OVH instalar o supabase self host e vercel self hosted, não ficaria muito
   mais barato??»* e depois *«existe o Coolify»*.
4. O Claude disse que discordava para a produção (as faturas de outras empresas
   passam a depender de operação que ninguém na equipa faz, D-3) — uma vez — e
   perguntou. O Diogo decidiu a VPS e o controlo total do Claude.

## O que se fez (documentos; nada comprado, nada instalado)

- ADR-0015 e ADR-0016 novos; estados actualizados nos ADR-0001, 0003, 0004,
  0005, 0011 e 0014.
- `docs/11-preparacao-da-vps.md` novo: o que se compra, quem faz o quê, o que
  a preparação instala, antes do primeiro dado pessoal, como o Claude chega à
  máquina, decisões por tomar (§7).
- `AGENTS.md`: regra 4 (dados na UE) e a secção nova «🔴 Operar a VPS».
- Skills: `observability-security` (secção «Operar a VPS» e uma linha na
  lista final) e `eu-gdpr-privacy` (subcontratantes).
- `docs/00`, `02`, `05`, `06` (D-3, G, H, I, R, U, V, W), `09`, `10`, README.
- Varrimento: `grep -ril scaleway` deu **23 ficheiros** `.md` (sem as
  referências da skill de design). Mudados os documentos vivos acima; as
  memórias datadas ficam como registo, com uma nota no topo nas três da
  Scaleway e na do alojamento. O ADR-0008 (o Codex só lia a Scaleway) e o
  ADR-0009 (comprar os domínios na Scaleway) ficaram como estão: o Codex na
  VPS e a conta da Scaleway estão no `docs/11` §7.

## Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| VPS da OVH, «a partir de», sem IVA | VPS-1 3,81 € (2 vCores, 4 GB); VPS-2 7,21 € (4, 8 GB, 75 GB); VPS-3 10,40 € (6, 12 GB, 100 GB); VPS-4 19,96 € (8, 24 GB, 200 GB); todas com *«Backup automatizado 1 dia»* | ovhcloud.com/pt/vps, HTML descarregado e procurado a 03/10/2026, 21:45 UTC |
| Condições desse preço | 12 meses pagos adiantados | ovhcloud.com/en-ie/vps, **por resumo automático**; não conferido na página portuguesa |
| Coolify: mínimo | 2 núcleos, 2 GB, 10 GB de disco; só Linux | coolify.io/docs/get-started/installation, por resumo, 03/10/2026 |
| Coolify: responsabilidade | *«You remain responsible for… Operating system updates, SSH access, firewall rules»* | coolify.io/docs/get-started/introduction, por resumo |
| Coolify: aviso | quem chegar primeiro ao registo fica administrador com acesso à máquina | página de instalação, por resumo |
| Supabase instalada por nós | mínimo 4 GB, 2 núcleos, 40 GB; recomendado 8 GB+; registos desligados por omissão; actualizações à mão | supabase.com/docs/guides/self-hosting/docker, por resumo |
| Vercel instalada por nós | não existe; instala-se o Next.js (Node, Docker ou estático) | nextjs.org e vercel.com, por pesquisa |
| Arranque da produção na Scaleway gerida, para comparar | ≈ 234 €/mês (base com segunda máquina + 2 contentores) | `alojamento-e-custos-03out2026.md`, corrigido nesta noite |
| SSH a partir de uma sessão na cloud | ligação directa a `github.com:22` sem resposta em 8 s; o resto do teste bloqueado pelo sistema de permissões da sessão | `bash /dev/tcp`, 03/10/2026; o tráfego HTTPS passa pelo proxy da sessão (`/root/.ccr/README.md`) |
| `AGENTS.md` | 12.702 bytes (limite do Codex: 32 KiB) | `wc -c`, depois da secção nova |

## A máquina: VPS-3 da OVH (decisão X, ADR-0017)

Pergunta: *«para começar com o ensaio, fica a VPS-3 da OVH (6 vCores, 12 GB,
10,40 € + IVA/mês), num centro de dados na UE?»* Resposta do Diogo,
03/10/2026: *«sim, fica a VPS-3 da OVH»*. O centro de dados escolhe-se na
compra: o texto da página portuguesa não lista as localizações (procurei 13
nomes de cidades europeias da OVH no HTML: nenhum); estão só num mapa.

## O que ficou por verificar

- **Por onde o Claude chega à VPS** (`docs/11` §5): o Claude Code no
  computador do Diogo ou do Bruno, por SSH; ou um MCP na VPS por HTTPS com o
  endereço autorizado na rede do ambiente. Nenhum testado.
- Os centros de dados da UE das VPS da OVH; as condições do «a partir de».
- O preço do armazenamento das cópias fora da máquina.
- O acordo de tratamento de dados do fornecedor da VPS.
- A apresentação para o Bruno e a Cila ainda mostra a Scaleway (não aberta).
- As contas de custo (`docs/09`, `docs/10`) e o tempo de operar a máquina não
  foram recalculados para a VPS.

## A VPS comprada — e registada no Reino Unido (03/10/2026, noite)

O Diogo enviou o e-mail da OVH (captura no chat, 03/10/2026): *«O seu VPS foi
instalado com sucesso com o sistema operativo Ubuntu 26.04»*; nome
`vps-c01fa544.vps.ovh.net`, IPv4 `57.129.168.39`, IPv6
`2001:41d0:801:2000::2323`, utilizador `ubuntu`. A palavra-passe não veio para
o chat (nem deve vir). O repositório é privado (GitHub, `"private": true`,
03/10/2026), por isso o nome e os endereços ficam aqui; não são segredos.

### O que se fez (só leitura; nada instalado, nenhum login)

- Consultei o registo da RIPE (RDAP) dos dois endereços.
- Descarreguei o catálogo público das VPS da OVH para Portugal
  (`eu.api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=PT`).
- Testei se esta sessão na cloud chega à porta 22 da VPS.
- Confirmei na Canonical se o Ubuntu 26.04 é LTS.

### Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Registo do IPv4 | bloco `57.129.168.0/24`, nome **`VPS-UK2`**, país **GB**, titular «OVH Ltd», contacto técnico «OVH UK Technical Contact», registado a 02/10/2026 19:40 UTC | `rdap.db.ripe.net/ip/57.129.168.39`, 03/10/2026 |
| Registo do IPv6 | bloco `2001:41d0:801::/48`, nome `OVH-PCI-ERI`, país **GB**, titular «OVH Ltd» | `rdap.db.ripe.net/ip/2001:41d0:801:2000::2323`, 03/10/2026 |
| Centros de dados que o catálogo oferece ao VPS-3 | `DE`, `EU-SOUTH-MIL`, `EU-WEST-RBX`, `GRA`, `SBG`, `WAW` (na UE, pelo código); `UK`, `BHS`, `SGP`, `SYD`, `YNM` (fora da UE ou por identificar) | catálogo público da OVH (PT), campo `vps_datacenter` de todos os planos «VPS-3 2026», 03/10/2026 |
| SSH a partir desta sessão na cloud | `57.129.168.39:22` sem resposta em 10 s | `bash /dev/tcp`, 03/10/2026; não se distingue se o bloqueio é da rede da sessão ou da VPS |
| Ubuntu 26.04 | «26.04.1 LTS», *Supported: 1* | `changelogs.ubuntu.com/meta-release-lts`, 03/10/2026 |

**Leitura:** o registo da RIPE põe os dois endereços no Reino Unido, que não é
da UE — a regra 4 do `AGENTS.md` e o ADR-0017 pedem um centro de dados na UE.
O registo da RIPE é declarado pela OVH e não prova o sítio físico da máquina:
**a prova é a localização na consola da OVH**, que não vi.

### O que ficou por verificar

- A localização da VPS na consola da OVH (o Diogo).
- Se a OVH deixa mudar de centro de dados sem comprar outra VPS, e se há
  reembolso ou prazo para desistir (não li as condições).
- Se o preço do VPS-3 muda com o centro de dados.
- O significado dos códigos `DE` (cidade), `YNM` e `BHS` no catálogo — li-os
  pelo código, não numa lista da OVH.
- Se a rede desta sessão deixa passar SSH com alguma definição; a
  documentação do ambiente só fala de domínios autorizados no proxy.
- Se a VPS aceita entrar por palavra-passe (não tentei entrar).

## Fica no Reino Unido por agora; migra-se para Paris (decisão Y, ADR-0018)

Resposta do Diogo, 03/10/2026, depois de ver a consola: *«está em uk. mais
tarde faremos a migração para um servidor em paris. agora so havia esta
localidade para a vps»*.

### O que se fez

- ADR-0018 novo (excepção temporária, só para o ensaio, sem dados pessoais
  reais; a produção não vai para lá).
- Varrimento de «centro de dados na UE» (`grep -rn` em todos os `.md`, sem as
  referências da skill de design): mudados `AGENTS.md` (regra 4, linha da
  excepção), ADR-0015 e ADR-0017 (estado), `docs/06` (X e Y nova), `docs/11`
  (§1, §4, §7, §8 e cabeçalho), `docs/12` (descrição para o jurista) e a skill
  `eu-gdpr-privacy` (subcontratantes). As memórias datadas ficam como estão.

### Números (com data e como se contaram)

| O quê | Valor | Fonte e como |
|---|---|---|
| Disponibilidade do VPS-3 por centro | os 11 `out-of-stock`, incluindo o `UK` | `eu.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=PT&planCode=vps-2025-model3`, 03/10/2026, 23:10 UTC — depois da compra, não mostra o que havia antes |
| Códigos dos centros | `DE` = `eu-west-lim`, `UK` = `eu-west-eri`, `YNM` = `ap-south-mum`, `BHS` = `ca-east-bhs`; nenhum de Paris | a mesma consulta, campo `code` |
| `AGENTS.md` | 12.906 bytes (limite do Codex: 32 KiB) | `wc -c`, depois da linha da excepção |

### O que ficou por verificar

- ~~A data de fim da excepção~~ → **31/03/2027** (abaixo).
- Que produto da OVH é o servidor de Paris (não é uma VPS da gama actual),
  o preço e a disponibilidade.
- Se a OVH muda uma VPS de centro de dados, e o custo de sair desta antes do
  fim do período pago.
- A base de transferência do RGPD para o Reino Unido (não lida).
- Os IP nos registos da máquina (SSH, servidor web) são dados pessoais que
  ficam no Reino Unido mesmo sem clientes reais: retenção por decidir.

## A excepção acaba a 31/03/2027 (decisão Z, ADR-0019)

Pergunta: *«Que data de fim escrevo para a migração para Paris? Proponho
31/03/2027 (seis meses), ou antes disso, se algum dado de um cliente real
tiver de entrar.»* Resposta do Diogo, 03/10/2026: *«sim, 31/03/2027»*.

- Foi num ADR novo e não no ADR-0018 porque a skill `platform-architect`
  diz que um ADR aceite não se edita. **Erro meu:** o ADR-0018 nasceu aceite
  sem a data de fim, que a mesma skill dá como obrigatória numa decisão
  temporária. Devia ter perguntado a data antes de o escrever.
- Mudados: ADR-0018 (estado), `AGENTS.md` (regra 4), `docs/06` (Y e Z nova),
  `docs/11` (cabeçalho, §1, §3.8, §7) e o índice. Procurei «fim por decidir» e
  «data de fim» em todos os `.md`.
- Alarme a partir de 01/03/2027: proposta, nos alertas da máquina, que ainda
  não existem.

## O acesso: o Claude Code no computador do Diogo (decisão AA, ADR-0020)

Resposta do Diogo, 03/10/2026: *«vamos avançar com o acesso pelo meu
computador»* — o caminho a) do `docs/11` §5.

### O que se fez

- ADR-0020 novo; estados no ADR-0016 e no `docs/06` (W e AA nova); `docs/11`
  §5 (decidido), §5.1 novo (os 9 passos no Windows), §7 e §8.
- Os passos vêm de duas páginas lidas a 03/10/2026: Microsoft, *Key-based
  authentication in OpenSSH for Windows* (o `ssh-agent` *«is disabled»* por
  omissão; `Set-Service -StartupType Automatic`, `Start-Service ssh-agent`,
  `ssh-add`); Claude Code, `code.claude.com/docs/en/setup.md` (Windows 10
  1809+; `irm https://claude.ai/install.ps1 | iex`; o Git para Windows é
  recomendado para o Bash, sem ele usa o PowerShell).
- **Nada feito na máquina ainda.** A primeira alteração (pôr a chave pública)
  é do Diogo, no passo 4.

### O que ficou por verificar

- Se o computador do Diogo chega à porta 22 da VPS.
- Se a VPS aceita palavra-passe (passo 6).
- `-t ed25519` não está na página da Microsoft (o exemplo dela é `ecdsa`);
  se o `ssh-keygen` do Windows do Diogo recusar, usa-se `ecdsa`.
- ~~A data de troca da chave~~ → **31/03/2027** para a do Diogo (decisão AB;
  pergunta: *«A data de troca da tua chave fica 31/03/2027?»*, resposta do
  Diogo, 03/10/2026: *«sim, 31/03/2027»*). Registada no `docs/11` §3.1 e
  §3.8, no `docs/06` e no estado do ADR-0020 — sem ADR próprio, como as
  decisões K e L.
- O equivalente no macOS do Bruno (por escrever).
