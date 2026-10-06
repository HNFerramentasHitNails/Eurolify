# ADR-0033 · Um servidor MCP na VPS, por HTTPS, para o Claude desktop ler e operar o ensaio

- **Estado:** aceite · muda o [ADR-0027](0027-copias-alertas-registos-e-endereco-do-ensaio.md),
  ponto 4 (a porta 443 deixa de estar fechada: abre-se só ao intervalo da
  Anthropic) · completa o [ADR-0028](0028-a-vps-opera-se-pelo-github.md)
  (operações fixas também pelo MCP; a configuração continua só por pedido
  revisto) · escolhe o caminho b) do `docs/11` §5, deixado de lado a 03/10/2026
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** pedido do Diogo de 04/10/2026: *«Podemos
  desenvolver algum mcp para o claude desktop aceder à vps sem ser necessário
  voltar aqui ao claude code terminal»*

## Contexto

O Claude apresentou três opções: a) usar o separador Code da aplicação (é o
Claude Code; nada a construir); b) um MCP local, só de leitura, pelo GitHub
(recomendada); c) um MCP na própria VPS, por HTTPS. Resposta do Diogo: *«c»*.
À pergunta seguinte (só leitura, recomendado, ou acções): *«quero açoes»*, e
escolheu as quatro propostas: cópia e reposição já; reiniciar a API; voltar a
uma publicação; actualizar e reiniciar a VPS.

Documentação oficial dos *connectors* da Anthropic
(`claude.com/docs/connectors/building/authentication` e `…/troubleshooting`,
lidas a 04/10/2026):

- os pedidos a um MCP remoto saem da **infraestrutura da Anthropic**, também
  na aplicação de computador, do intervalo **`160.79.104.0/21`**, só IPv4; o
  nome tem de ter registo A público e responder por HTTPS;
- autenticação: OAuth 2.0 com registo dinâmico (`oauth_dcr`) ou CIMD
  (`oauth_cimd`), PKCE S256 obrigatório, *callback*
  `https://claude.ai/api/mcp/auth_callback`; cabeçalho fixo só em beta para
  algumas organizações; sem autenticação é possível, mas o intervalo da
  Anthropic é partilhado por todos os utilizadores do Claude.

DNS, 04/10/2026: `eurolify.eu` e `www.eurolify.eu` apontam para a VPS;
servidores de nomes da OVH (`ns200`/`dns200.anycast.me`).

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Separador Code da aplicação | Nada a construir | Só no separador Code |
| b) MCP local, só leitura, pelo GitHub | Sem portas abertas; respeita o ADR-0028 | Depende do computador com o `gh` |
| **c) MCP na VPS, por HTTPS, com acções** | Funciona no Claude desktop, na web e no telemóvel, sem computador | A primeira porta aberta do Eurolify, com acções sobre a máquina |

## Decisão

1. **Endereço:** `https://mcp.eurolify.eu` (registo A para a VPS, criado pelo
   Diogo na zona da OVH). Certificado Let's Encrypt pelo **desafio DNS** com a
   API da OVH (chave só para a zona `eurolify.eu`), sem abrir a porta 80.
2. **Porta 443 aberta só a `160.79.104.0/21`** no `ufw`. Tudo o resto continua
   fechado.
3. **Autenticação OAuth 2.0 com o GitHub como porteiro:** o servidor MCP é o
   seu próprio servidor de autorização (DCR, PKCE S256), e o login faz-se no
   GitHub por uma aplicação OAuth do Diogo; **só as contas
   `HNFerramentasHitNails` e `bruno-88` entram**. Sem palavras-passe próprias.
4. **Ferramentas de leitura:** as mesmas medições do fluxo `medir` (estado,
   serviços, contentores, `/health`, firewall, `fail2ban`, actualizações,
   últimas publicações, cópias e acções), sem endereços IP.
5. **Acções de operação** (um conjunto fixo, sem consola nem comandos
   livres; cada uma marcada como destrutiva, para o Claude pedir confirmação,
   e — desde 05/10/2026, #92 — **confirmada em dois passos no servidor**: o
   primeiro pedido não executa e devolve um código de uso único, ligado à
   conta, à acção e aos argumentos, válido 5 minutos; só o segundo pedido,
   com o código, executa. O servidor não prova que foi uma pessoa a dizer
   «sim»: garante que nenhuma acção corre numa só chamada e que a confirmação
   é da mesma conta e da mesma acção):
   - correr a **cópia** ou a **reposição** agora;
   - **reiniciar a API**;
   - **voltar a uma publicação**: republicar uma imagem que já está no GHCR
     (só resumos de imagens construídas pelo GitHub). **Desde 06/10/2026, só
     a publicação imediatamente anterior à que está no ar** (depois de uma
     volta, é a publicação de onde se veio: o MCP só alterna entre as duas).
     Se a base tem migrações que essa imagem não conhece, não se corre o
     migrador, e só se segue se forem todas das que a publicação no ar
     aplicou (as linhas antigas do registo não o dizem: a primeira volta
     depois desta regra, com a base à frente, é recusada); de resto migra-se
     como numa publicação. O MCP aceita o pedido e a publicação, em segundo
     plano, ainda pode recusá-lo (vê-se no `estado_do_ensaio`). Mais atrás é
     uma emergência, por SSH, com o `--emergencia` do `eurolify-publicar`
     (decisão do Diogo, opção A da 2.ª revisão do #115; tarefas #113 e #120,
     `infra/vps/LEIA-ME.md`);
   - **actualizar** (`apt upgrade`) e **reiniciar a VPS**: recusadas em
     horário de trabalho (dias úteis, 08:00–20:00 em Lisboa), a regra 4 do
     `AGENTS.md`.
6. **A configuração continua só por pedido revisto** (ADR-0028): o MCP não
   instala, não muda ficheiros de configuração, não mexe em chaves, na
   firewall nem na base.
7. **Como corre:** um contentor próprio, construído e publicado pelo GitHub
   como a API, **sem `docker`, sem `sudo`, sem chaves da VPS**. Cada leitura e
   cada acção é um **pedido ao serviço da máquina** (o mesmo mecanismo do
   `eurolify-pedido`, ADR-0026/0028), que valida o pedido contra a lista fixa
   e regista quem, o quê e quando (ADR-0016, ponto 4). À frente, um `nginx`
   com o certificado; o contentor só ouve em `127.0.0.1`.
8. **Tudo sai do script de preparação** (ADR-0018) e entra por pedido com a
   revisão do agente (ADR-0030/0031).

## Consequências

- O ADR-0027 (ponto 4) e a regra «fechado por omissão» passam a ter uma
  excepção escrita: a 443, só para a Anthropic, só para o MCP.
- O Diogo cria: o registo A `mcp.eurolify.eu`; uma chave da API da OVH só para
  a zona `eurolify.eu` (para o certificado); uma aplicação OAuth no GitHub com
  o *callback* do MCP. Os segredos vão para a VPS como os outros.
- **O que pode partir:**
  - **um erro no OAuth abre as acções a qualquer utilizador do Claude** — o
    intervalo da Anthropic é partilhado; por isso a lista de contas é fechada
    e testada, e o servidor recusa por omissão;
  - **as acções correm sem revisão de código** (só a confirmação no Claude):
    um «reiniciar a VPS» ou um «voltar a uma publicação» por engano tem efeito
    imediato; o horário trava o reinício e a actualização;
  - **injecção pela IA:** instruções escondidas em dados lidos pelo Claude
    podem pedir uma acção; a confirmação humana é a trava (skill
    `observability-security`);
  - um token OAuth roubado dá as acções até expirar: tokens curtos, revogação
    ao desligar o *connector*;
  - a porta 443 aberta passa a ser alvo, mesmo filtrada.

## Alteração de 04/10/2026 (revisão do pedido #30)

A revisão independente do código mostrou que o ponto 2 impedia o próprio
login: o `/authorize` e o regresso do GitHub abrem no **browser de quem liga
o connector**, a partir do endereço dele, não da Anthropic. Com a 443 só para
`160.79.104.0/21`, o connector nunca se ligava.

Opções postas ao Diogo: abrir só o login (recomendado), ou manter a 443
fechada e abri-la por pedido ao GitHub durante 15 minutos de cada vez que for
preciso ligar. Resposta: *«Abrir só o login»*.

- **Ponto 2 passa a ser:** a 443 abre a todos no `ufw`; o `nginx` deixa passar
  a todos só o `/authorize` e o `/oauth/github/callback` (com limite de
  pedidos por endereço), e todo o resto (o `/mcp`, o `/token`, o `/register`,
  os metadados) só a `160.79.104.0/21`.
- **Ponto 3, mais apertado:** as contas entram pelo **número** da conta no
  GitHub (`HNFerramentasHitNails` = 259400126, `bruno-88` = 176623429), não
  pelo nome, que pode mudar e ficar livre; só se registam clientes cujo
  retorno é o do Claude (`https://claude.ai/…` ou `https://claude.com/api/mcp/auth_callback`),
  para um link de login enviado por outro não lhe entregar o código; o GitHub
  pede sempre a escolha da conta.
- **O que pode partir, a mais:** a página de login fica pública (alvo de
  varrimentos; só reencaminha para o GitHub); se a Anthropic mudar o
  intervalo, o connector deixa de chegar ao `/mcp` até se mudar o
  `nginx-mcp.conf`.

## O que ficou por verificar

- Se o `apt` do Ubuntu 26.04 tem o `certbot` e o módulo DNS da OVH, e as
  versões.
- A versão estável do SDK de MCP em TypeScript e se o seu servidor de
  autorização serve este desenho.
- Se a aplicação de computador mostra a confirmação das ferramentas marcadas
  como destrutivas (a documentação lida não o descreve). Desde o #92 a
  confirmação já não depende disso (ponto 5). A confirmação pela própria
  aplicação (elicitação do MCP) foi vista a 05/10/2026 (#94): a aplicação de
  computador provavelmente não a suporta (pedido #41110 do repositório
  `anthropics/claude-code`, 30/03/2026, não oficial; nos connectors do
  claude.ai não verifiquei), e o transporte sem sessão deste MCP não a
  permite. **Decisão do Diogo, 05/10/2026: ficam os dois passos** (*«a, fica
  com os dois passos»*); revê-se quando a aplicação suportar a elicitação
  (#94 fica aberto).
