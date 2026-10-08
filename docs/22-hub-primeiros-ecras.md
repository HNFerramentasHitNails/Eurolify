# Hub: os primeiros ecrãs — desenho antes do código

> **Versão de 07/10/2026 — desenho.** Decisão do Diogo, 07/10/2026: *«sim,
> concordo, fica a a)»* — primeiro os ecrãs mínimos do Hub, depois a
> publicação em `hub.eurolify.eu`, só com contas de teste enquanto a VPS
> estiver no Reino Unido (ADR-0019). Issue #156. Skills: `eurolify-design`,
> `observability-security`, `eu-gdpr-privacy`, `eu-localization`.
>
> **A identidade visual do Eurolify não está decidida** (D-12). Os tokens
> abaixo são **provisórios e neutros**, só para os ecrãs funcionarem; o
> aspecto vai ao Diogo ou ao Bruno com as capturas antes de publicar, e só um
> deles dá o OK (`eurolify-design`, regra 1).

## 1. O que entra e o que fica de fora

| Entra (esta parte) | Fica para depois |
|---|---|
| Entrar com passkey; com palavra-passe + TOTP (B3b, §9.2) | — |
| Aceitar um convite e criar a conta (nome + passkey); com uma conta que já existe (§10) | — |
| Escolher o comerciante (quem é membro de vários); mudar de papel, tirar da equipa, sair (§10) | — |
| Equipa: ver membros e convites em aberto; convidar; cancelar um convite | Palavra-passe e autenticador, chaves de API (B3b e B3c: desenho na §9, 08/10/2026). A minha conta e recuperar a conta entraram na B3a (§9.1, pedido #174) |
| Sair | A montra, o checkout e o resto do Hub. O Catálogo começa pela lista de artigos (desenho na §11) |

Cada ecrã só mostra o que o servidor decide: o papel, o que se pode fazer e
os erros vêm da API (`eurolify-design`, regra 8). O Hub não guarda nada no
navegador além do cookie da sessão (que nem lê: é `HttpOnly`), da língua
escolhida e, depois de recuperar a conta, da marca «há aviso por fechar»
(nunca o código nem o e-mail; apaga-se ao fechar o aviso e ao sair; revisão
do #174, P3-1).

## 2. Onde vive

| O quê | Proposta |
|---|---|
| Código | `apps/hub`: React + Vite, ficheiros estáticos (ADR-0025) |
| Anfitrião | `hub.eurolify.eu` (decidido com a publicação, §7): o nginx serve os ficheiros estáticos e encaminha `/hub/*` para a API — o mesmo anfitrião, por isso o cookie `__Host-` e o `SameSite=Strict` funcionam sem CORS (`docs/21` §3) |
| Caminhos das páginas | `/entrar`, `/recuperar`, `/convite`, `/equipa`, `/conta`; nunca debaixo de `/hub/`, que é da API |
| Passkeys no navegador | `@simplewebauthn/browser` (a mesma família do `@simplewebauthn/server` da API); sem suporte de passkey, o ecrã diz isso e não oferece nada que não funcione |
| Letra | a do sistema (`system-ui`): nada se vai buscar à Internet |
| Fora do repositório | nenhuma chamada a outro domínio; nem análise de tráfego, nem tipos de letra, nem CDN |

**A ligação de um convite** é `https://hub.eurolify.eu/convite#euc_…`: o
segredo vai **depois do `#`**, que o navegador nunca envia ao servidor — não
fica nos registos do nginx nem no `Referer`. O ecrã lê-o, tira-o da barra de
endereço (`history.replaceState`) e envia-o só no corpo do POST (`docs/21`
§11: os segredos nunca vão no caminho nem na consulta).

**O risco que fica** (revisão do #158, P2-1, medido no Chromium): o
`replaceState` limpa a barra e a entrada desta sessão, mas o **histórico do
navegador** guarda o endereço aberto, com o segredo — e, com a sincronização
ligada, sai da máquina. Num computador partilhado, quem abrir o histórico
nos 7 dias seguintes cria a conta com o e-mail convidado. Limites: o
convite vale uma vez e para um e-mail fixo. O aviso a quem convida pede que
a ligação se abra num computador próprio ou numa janela privada. **Decidido
(Diogo, 07/10/2026): o convite fica nos 7 dias**, sem código à parte; volta-se
a isto antes de entrarem contas reais.

## 3. Ecrãs, rotas e estados

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Entrar** (`/entrar`) | o nome do produto, um botão «Entrar com passkey», a escolha da língua | `POST /hub/session/options` → navegador → `POST /hub/session` | a carregar (à espera da passkey); cancelado pela pessoa (volta ao botão, sem erro vermelho); recusado (401: «Não foi possível entrar com esta passkey»); muitas tentativas (429/`auth.locked`: com os minutos); sem suporte de passkey; erro da API (5xx: tentar outra vez) |
| **Aceitar convite** (`/convite#…`) | «Foi convidado para trabalhar no Hub», campo «O seu nome» (1 a 100 caracteres), botão «Criar a conta com uma passkey» | `POST /hub/invitations/accept/options` → navegador → `POST /hub/invitations/accept-new` | sem segredo na ligação; convite que não vale (a mesma mensagem para expirado, usado, cancelado ou inexistente — a API não distingue, de propósito); o e-mail já tem conta (`invite.account_exists`: entrar e aceitar, §10); nome inválido; a carregar; 429. **Depois de criar a conta**, os 10 códigos de recuperação que a API devolve, **uma vez**: «Copiar», o aviso de que não voltam a aparecer e um botão «Já os guardei» antes de seguir (`docs/21` §7) |
| **Os seus comerciantes** (`/`) | quem entrou (nome, e-mail) e a lista de comerciantes de que é membro, com o papel | `GET /hub/me` | vazio («Não pertence a nenhuma equipa»: pode acontecer depois de sair de todas); a carregar; sem sessão (vai para `/entrar`) |
| **Equipa** (`/equipa?comerciante=mer_…`) | os membros activos (nome, e-mail, papel, desde), em tabela no computador e em cartões no telemóvel; o dono vê também os convites em aberto (e-mail, papel, expira); a contagem à vista | `GET /hub/members` | vazio de convites; sem permissão (403: «Não pode ver esta equipa»); comerciante que não é dele (403); a carregar; erro |
| **Convidar** (na Equipa, só para quem pode convidar) | e-mail e papel (o dono vê os quatro papéis, o gestor só armazém e apoio — uma cópia da regra da base, `docs/21` §5, só para não oferecer o que ela recusa; **por fazer:** a API devolver a lista; se recusar, mostra a recusa); depois de criar, **a ligação do convite, uma vez**, com «Copiar» e o aviso de que não volta a aparecer | `POST /hub/invitations` | precisa de autenticação recente (403 `auth.reauthentication_required` → pede a passkey outra vez com `POST /hub/session/reauthenticate` e repete); comerciante suspenso; e-mail inválido; 429 |
| **Cancelar convite** | botão por convite, com confirmação | `POST /hub/invitations/{id}/cancel` | já usado; sem permissão |
| **Sair** | no menu | `POST /hub/session/end` | sempre volta a `/entrar` |

**Erros:** o Hub mostra a `mensagem` da API na língua escolhida (a API já
manda `pt` e `en`; o `es` traduz-se no Hub pelo `codigo`). Um erro sem
`codigo` conhecido mostra «Ocorreu um erro» e o identificador do pedido
(`instance`), para o suporte. Nunca mostra o corpo cru.

**Autenticação recente:** quando a API responde
`auth.reauthentication_required`, o Hub pede a passkey (o mesmo fluxo de
entrar, com `/hub/session/reauthenticate`) e repete o pedido **uma vez**.

## 4. Tokens provisórios (D-12 por decidir)

Três níveis (`eurolify-design`, regra 2): globais → semânticos → componente.
Nenhuma cor nem medida escrita num componente. Claro e escuro desde já
(`prefers-color-scheme`).

| Semântico | Claro | Escuro | Uso |
|---|---|---|---|
| `superficie` | cinzento 0 (#ffffff) | cinzento 950 (#111418) | fundo |
| `superficie-elevada` | cinzento 50 (#f5f6f8) | cinzento 900 (#1b1f24) | cartões, painéis |
| `texto` | cinzento 900 (#1b1f24) | cinzento 50 (#f5f6f8) | texto principal |
| `texto-secundario` | cinzento 600 (#525b66) | cinzento 300 (#b4bcc6) | rótulos, datas |
| `borda` | cinzento 200 (#dde1e6) | cinzento 700 (#3a414a) | linhas |
| `accao-principal` | azul 700 (#1d4ed8) | azul 300 (#93b4fd) | botão principal, ligações |
| `texto-sobre-accao` | #ffffff | cinzento 950 | texto do botão principal |
| `foco` | azul 500 (#3b82f6) | azul 300 | anel de foco (2 px, sempre visível) |
| `estado-erro` | vermelho 700 (#b91c1c) | vermelho 300 (#fca5a5) | erros |
| `estado-aviso` | âmbar 800 (#92400e) | âmbar 300 (#fcd34d) | avisos (ex.: a ligação só aparece uma vez) |
| `estado-sucesso` | verde 800 (#166534) | verde 300 (#86efac) | confirmação |

Os contrastes (texto sobre a superfície, ≥ 4,5:1) **medem-se** antes de dizer
que está feito (ponto 6). Espaços em múltiplos de 4 px; alvos de toque com
pelo menos 44 px; letra base 16 px.

## 5. Línguas e textos

PT (por omissão), ES e EN desde o primeiro ecrã (`eurolify-design`, regra 6):
um ficheiro por língua, chaves iguais, um teste que falha se faltar uma.
Masculino universal em PT («Foi convidado», «os membros»). Sem maiúsculas
forçadas. Datas pela língua escolhida (`Intl.DateTimeFormat`), no fuso do
navegador. A língua escolhida guarda-se no navegador (é preferência, não dado
pessoal).

## 6. Antes de dizer que está feito

- [ ] Capturas a 375, 768 e 1280 px, em claro e escuro, dos quatro ecrãs, e uma
      passagem só com teclado (Playwright com o Chromium do ambiente): o
      programa `apps/hub/scripts/capturas.mjs` cria uma base nova, arranca a
      API com o Hub ligado atrás de um «proxy» HTTPS local e percorre os
      ecrãs com uma passkey em software (o autenticador virtual do Chromium).
- [ ] Contrastes medidos nos dois temas.
- [ ] Todos os estados da §3 vistos com a API de verdade. **Feito no
      `capturas.mjs`** (manual, fora do CI: precisa do Chromium e de uma base):
      reautenticação, passkey recusada, cancelar e cancelar outra vez noutro
      separador, sem rede, ligação estragada, gestor e apoio. **Por ver:** 429,
      `auth.locked`, comerciante suspenso e sessão expirada a meio.
- [ ] O segredo do convite não aparece em nenhum pedido fora do corpo, nem na
      barra de endereço depois de lido.
- [x] O aspecto foi ao Diogo ou ao Bruno com as capturas, e um deles deu o OK
      (Diogo, 07/10/2026, sobre 7 das 24 capturas: *«sim, dou o OK ao aspecto
      provisório»*). Vale para os tokens provisórios; a identidade visual
      continua por decidir (D-12).
- [ ] Revisão do agente (ADR-0035) publicada no pedido.

## 7. A publicação

Feita depois do OK ao aspecto (Diogo, 07/10/2026). O que muda na VPS entra
pelo GitHub (ADR-0028): o `aplicar-script` corre o `preparar.sh` e o
`publicar` traz a imagem.

| O quê | Onde | Como |
|---|---|---|
| Os ecrãs na imagem | `Dockerfile` | constrói `@eurolify/hub` e copia o `dist` para `/app/hub`: a API e os ecrãs saem sempre da mesma imagem, com o mesmo resumo |
| Os ecrãs no disco | `eurolify-publicar` | copia `/app/hub` da imagem (um contentor sem rede, só `tar`) para `/var/lib/eurolify/hub/<resumo>` e troca a ligação `actual` de uma vez; guarda as 3 últimas. Também ao voltar à publicação anterior. Se a cópia falhar, avisa e a API não volta atrás (os ecrãs antigos continuam) |
| O nome | zona da OVH | registo A `hub.eurolify.eu` → a VPS, **criado à mão pelo Diogo ou pelo Bruno** (o mesmo que o do MCP); sem ele o passo 14 avisa e o Hub fica desligado |
| O certificado | `preparar.sh`, passo 14 | Let's Encrypt pelo desafio DNS da OVH (a 80 não abre), só depois de o nome resolver |
| O site | `infra/vps/ficheiros/nginx-hub.conf` | os estáticos, `/hub/` para a API com o `X-Forwarded-For` reescrito pelo nginx — só se o pedido original começar por `/hub/`, e com o caminho já normalizado (revisão do #160, P1-1: `/products/a%2F..%2F..%2Fhub%2Fb` chegava à rota `/products`); `try_files $uri /index.html` para todas as páginas do Hub (`/entrar`, `/convite`, `/equipa`, `/conta`, `/recuperar`); `index.html` sem cache, `assets/` com cache longa; cabeçalhos: CSP (`default-src 'self'`, `frame-ancestors 'none'`), HSTS, `Referrer-Policy: no-referrer`, `nosniff`, `Permissions-Policy`. Liga-se só com o certificado e o `nginx -t`; se falhar, desliga-se outra vez |
| A configuração da API | `/etc/eurolify/api-hub.env` (600, root) | `HUB_ORIGEM=https://hub.eurolify.eu` e `PROXY_CONFIAVEL=<gateway da rede eurolify>` — o endereço de onde o nginx chega ao contentor (revisão do #154, P1-1). O gateway **lê-se em cada corrida** (`docker network inspect`), por isso a rede não precisa de sub-rede fixa. Sem o site ligado, ou sem se ler o gateway (com aviso; os ecrãs abrem mas `/hub/*` dá 404), o ficheiro fica vazio e a API corre sem o Hub. Quando muda, a API é recriada com a mesma imagem |
| A medição na máquina | passo 14 | pelo nginx: `/entrar` 200 e `/hub/me` 401 (sem sessão) |

**Medido localmente (07/10/2026)**, com o nginx desta configuração (sem a
linha IPv6, que a máquina de teste não tem) e a API verdadeira com
`PROXY_CONFIAVEL=127.0.0.1`: `/entrar`, `/index.html` e um ficheiro de
`assets/` 200; `/hub/me` 401; 20 `POST /hub/session/options` de um endereço
dão 200 e o 21.º 429 com `Retry-After: 60`; outro endereço continua a 200; um
`X-Forwarded-For` forjado não muda a contagem (429); um `Origin` de outro
site, 403. Depois da revisão do #160 (P1-1), com os ecrãs no lugar:
`/products/a%2F..%2F..%2Fhub%2Fb` e `//hub/me` dão 404;
`/hub/x%2F..%2F..%2Fproducts` e `/hub/..%2Fproducts` ficam `/products` depois
de normalizados e dão 200 com a página do Hub (`try_files`). Nenhum chega à
API: o registo dela só mostra `/health` e `/hub/me` (antes, o primeiro chegava
à rota `/products`: 401 da API). Uma primeira medição dizia 404 para os dois
do meio por faltarem os ecrãs na máquina de teste (revisão do #162, P3-B).

**Só contas de teste** (ADR-0019): a VPS está no Reino Unido até à migração;
os convites são criados pelo Diogo ou pelo Bruno, **com nomes e e-mails
fictícios** — o e-mail verdadeiro de uma pessoa, mesmo o de um de nós, já é um
dado pessoal real (revisão do #160, P3-12).
**Para alguém entrar** (`docs/19` §6.0, 08/10/2026): o operador gera o
convite no computador (`node apps/api/scripts/gerar-convite.mjs`), lança o
fluxo `operar` com a acção `convite` (comerciante, e-mail fictício de um
domínio reservado para testes, resumo) e dá a ligação a quem vai ser dono.
**Falta a chave SSH do fluxo `operar`** (`infra/vps/chaves/fluxos/operar.pub`
e o segredo `VPS_CHAVE_OPERAR`): sem ela, nenhuma acção do fluxo chega à VPS.

## 8. Desenvolver localmente

O `pnpm --filter @eurolify/hub desenvolver` (Vite em `http://localhost:5173`)
não deixa entrar: a API só aceita escritas do `Origin` da `HUB_ORIGEM`, que
tem de ser `https` (revisão do #158, P3-10). Para ver os ecrãs com a API, usa-se
o `scripts/capturas.mjs`, que monta um «proxy» HTTPS local.

## 9. Parte B3 dos ecrãs: a conta, recuperar, palavra-passe e chaves

Pedido do Diogo, 08/10/2026: *«sim, avança com os ecrãs da parte B3»*
(issue #156). As rotas existem e estão no ensaio (`docs/21` §12). Mesmos
tokens provisórios, línguas, regras de erro e de autenticação recente da §3;
as capturas vão ao Diogo ou ao Bruno antes de juntar, como na primeira
parte. Em três pedidos, pela ordem do `docs/21` §12:

### 9.1 B3a — a minha conta e recuperar

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **A minha conta** (`/conta`, ligação «Conta» no cabeçalho) | três blocos: Passkeys, Sessões abertas, Códigos de recuperação | os de cada bloco | sem sessão (vai para `/entrar`); a carregar; erro por bloco (um bloco que falha não esconde os outros) |
| **Passkeys** | nome, criada em, último uso (ou «nunca»); a contagem; o conselho de ter duas (`docs/21` §7: o Hub pede para registar duas) quando só há uma | `GET /hub/passkeys` | — |
| **Acrescentar passkey** | campo «Nome desta passkey» (ex.: «Telemóvel»; 1 a 100), botão | `POST /hub/passkeys/options` → navegador → `POST /hub/passkeys` | autenticação recente (§3); cancelada pela pessoa (sem vermelho); passkey já registada neste dispositivo; sem suporte |
| **Retirar passkey** | botão por passkey, com confirmação que diz que **todas as sessões terminam** (as outras; esta continua) | `POST /hub/passkeys/{id}/remove` | é a última forma de entrar (a API recusa: o ecrã explica que é preciso outra passkey primeiro; a regra da base só conta passkeys, e o texto revê-se na B3b se a palavra-passe passar a contar — revisão do #174, P3-7); autenticação recente |
| **Sessões abertas** | criada em, último uso, «esta sessão» marcada; a contagem | `GET /hub/sessions` | só há esta (o botão de terminar as outras fica escondido) |
| **Terminar todas as outras** | botão com confirmação | `POST /hub/sessions/end-all` | autenticação recente; depois, a lista volta a ler-se (fica só esta) |
| **Códigos de recuperação** | o que são; botão «Gerar códigos novos» com confirmação de que **os antigos deixam de valer**; depois, os 10 códigos **uma vez**, como no convite (Copiar, aviso, «Já os guardei») | `POST /hub/recovery-codes` | autenticação recente |
| **Recuperar a conta** (`/recuperar`, ligação no ecrã de entrar: «Perdeu a passkey?») | e-mail, um código de recuperação (`XXXX-XXXX-XXXX-XXXX`; a API aceita minúsculas, espaços e sem hífenes, e lê 0, 1 e 8 como O, I e B — o ecrã envia como foi escrito), nome da passkey nova, botão «Recuperar com uma passkey nova» | `POST /hub/recovery/options` → navegador → `POST /hub/recovery` | a mesma recusa para e-mail sem conta, código errado ou usado (401: a API não distingue, de propósito); muitas tentativas (429, com os minutos); cancelada; sem suporte |
| **Depois de recuperar** | entra na conta com o aviso: as outras sessões terminaram, o código usado já não vale, **retire as passkeys que já não tem** (a do dispositivo perdido continua a valer até se retirar, `docs/21` §12, revisão do #144, P3-7) e gere códigos novos; e, se for dono, **reveja as chaves de API** que criou (revisão do #149, P2-1) | os de cima | o aviso fica até a pessoa o fechar (só neste navegador; a API não guarda «visto») |

### 9.2 B3b — palavra-passe e autenticador

| Ecrã | O que mostra | Rotas da API | Estados |
|---|---|---|---|
| **Entrar com palavra-passe** (em `/entrar`, ligação «Entrar com palavra-passe») | e-mail, palavra-passe, código de 6 dígitos do autenticador | `POST /hub/session/password` | a mesma recusa para tudo o que falha (401); 429 com os minutos; 503 (muitos pedidos ao mesmo tempo: tentar daqui a pouco) |
| **Na conta: palavra-passe** | se não está activa: «Activar palavra-passe e autenticador» → palavra-passe (≥ 12) e confirmação → o segredo para o autenticador → o primeiro código de 6 dígitos → activa; se está activa: «Retirar» com confirmação | `POST /hub/password/setup`, `POST /hub/password/confirm`, `POST /hub/password/remove` | autenticação recente; código errado; retirar quando não há passkey (a API recusa) |

**Na API (feito com a B3b):** o `/hub/me` diz `palavra_passe: "activa" |
"pendente" | null` (migração 0029; só o estado, nenhum dado secreto). O
campo só existe quando a API tem a palavra-passe ligada (`TOTP_CHAVE`);
sem ele, a conta não oferece a palavra-passe. Ao entrar, sem sessão, o Hub
não sabe se a API a tem: a ligação «Entrar com palavra-passe» aparece, e
sem a chave a rota dá 404 e o ecrã diz que não está disponível (revisão do
#177, P3-5).

**Autenticação recente sem passkey (revisão do #177, P2-1):** só há
reautenticação com passkey. Quem não a pode usar neste navegador recebe o
aviso de sair e voltar a entrar (também com a palavra-passe), e tem 10
minutos. Uma rota de reautenticação com a palavra-passe fica por decidir
(`docs/21` §4.3).

**Fica para o desenho das contas (`docs/21` §8; revisão do #177, P3-9):** o
bloqueio por conta responde 429 a qualquer tentativa sobre essa conta,
mesmo com a palavra-passe errada; de um IP limpo, um 429 diz que a conta
existe e tem palavra-passe activa.

**Decidido (Diogo, 08/10/2026: *«sim, com código QR»*):** o segredo do
autenticador mostra-se **como código QR e como texto** (em grupos de 4,
para se escrever à mão). O código QR desenha-se no próprio Hub com a
biblioteca `uqr` 0.1.3 (MIT, sem dependências, 79 KB, publicada a
03/04/2026; `pnpm audit` sem vulnerabilidades conhecidas, 08/10/2026),
sempre preto sobre branco, também no tema escuro. O código QR e o segredo
só vivem no ecrã enquanto se configura (§9.4).

**No ensaio, a palavra-passe ainda não existe:** a VPS não tem a
`TOTP_CHAVE` (medido a 08/10/2026: `POST /hub/session/password` dá 404).
Pô-la lá é uma chave nova na máquina, com a confirmação do Diogo ou do
Bruno (`AGENTS.md`, «Operar a VPS»): **autorizada pelo Diogo a 08/10/2026**
(*«sim, prepara o pedido da chave na VPS»*). O passo 10 do `preparar.sh`
gera-a uma vez em `/etc/eurolify/api-totp.env` (600, root; nunca a
reescreve; só uma chave válida chega à API) e o `eurolify-publicar`
passa-a à API. Se se perder, os autenticadores já configurados deixam de
valer: quem tem passkey entra e configura o seu outra vez; quem só tem a
palavra-passe fica com os códigos de recuperação. Por isso guarda-se uma
cópia fora da máquina e à parte das cópias da base (`infra/vps/LEIA-ME.md`,
«A chave dos segredos TOTP»; revisão do #177, P2-3 da VPS).

### 9.3 B3c — chaves de API

| Ecrã | O que mostra | Rotas da API | Estados |
|---|---|---|---|
| **Chaves** (`/chaves?comerciante=mer_…`, ligação «Chaves de API» ao lado de «Ver a equipa», só para o dono) | as chaves do comerciante: nome, tipo, âmbitos (em linguagem comum), o começo da chave, quem a criou (você, o nome de um membro, «alguém que já saiu da equipa», outra chave ou o operador) e quando, expira, estado (activa, revogada a…, expirou a…) | `GET /hub/keys` (e `/hub/me` e `/hub/members` para os nomes) | sem permissão (403: o ecrã não oferece a quem não é dono e mostra a recusa a quem abre a página); vazio |
| **Criar chave de servidor** | nome, o que a chave pode fazer (os âmbitos do dono, por escolha), expira a (opcional: até ao fim desse dia); depois, **o segredo uma vez**, com Copiar, aviso e «Já o guardei» | `POST /hub/keys` | autenticação recente; sem nome ou sem âmbitos (o ecrã recusa antes); data passada; âmbitos acima do papel e comerciante suspenso (a API recusa, com texto próprio) |
| **Revogar** | botão por chave activa, com confirmação («deixa de funcionar já, sem volta atrás») | `POST /hub/keys/{id}/revoke` | autenticação recente; já revogada ou que já não existe (outro separador: a lista volta a ler-se) |

**Chaves públicas (para a loja): ainda não se oferecem** (08/10/2026). A API
pede a loja (`sto_…`), e ainda não há forma de criar lojas: nem rota da
API, nem acção do operador (procurado com `grep` em `apps/api/src` e nas
migrações, 08/10/2026). Chegam com as lojas; o ecrã diz isso.

### 9.4 O que não muda

- Nada disto mexe nas regras: a API e a base decidem; os ecrãs só não
  oferecem o que vai ser recusado e mostram a recusa.
- Os segredos (códigos, segredo do autenticador, segredo da chave) nunca vão
  para o URL, o armazenamento do navegador nem os registos; mostram-se uma
  vez e o ecrã esquece-os ao sair.

## 10. A gestão da equipa (issue #186)

Pedido do Diogo, 08/10/2026: *«sim, avança com a gestão da equipa no
Hub»*. As rotas existem e estão no ensaio (`docs/21` §4.2, §4.4, §4.5;
migração 0018). A base decide; o ecrã só não oferece o que vai ser recusado.

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Equipa: mudar o papel** | na linha de cada membro, para o dono: o papel numa lista de escolha e «Mudar» (só depois de escolher outro), com confirmação: os convites em aberto e as chaves de servidor que a pessoa criou e que o papel novo já não permite são cancelados e revogados, com as chaves criadas a partir delas (`pessoa_fechar_acessos`, 0025); as integrações que as usam deixam de funcionar. Não aparece na linha do próprio dono (ninguém muda o seu papel) | `POST /hub/members/{id}/role` | autenticação recente; o último dono não deixa de o ser (`member.last_owner`); membro que já saiu (`member.not_found`: a lista relê-se); comerciante suspenso ou fechado |
| **Equipa: tirar da equipa** | para o dono, «Tirar da equipa» na linha de cada outro membro, com confirmação: deixa de entrar; os convites em aberto que criou são cancelados e as chaves de servidor que criou (e as criadas a partir delas) são revogadas; as chaves públicas da loja ficam | `POST /hub/members/{id}/end` | autenticação recente; o último dono (`member.last_owner`); membro que já saiu |
| **Equipa: sair da equipa** | para qualquer membro, «Sair desta equipa» na própria linha, com confirmação (o mesmo que fecha); depois volta a «Os seus comerciantes». O último dono vê o botão desligado e porquê | `POST /hub/members/{id}/end` (o próprio) | o último dono não sai (`member.last_owner`) |
| **Convite: o que é, antes de aceitar** (issue #194) | em `/convite`, por cima de tudo: «Foi convidado para a equipa de {comerciante}, com o papel {papel}. O convite é para {e-mail} e expira a {data}.» Um convite que já não vale mostra só a recusa, sem formulário. Com a sessão de outra pessoa, «Este convite é para {e-mail} e entrou como {e-mail da sessão}: saia e entre com a conta desse e-mail»; «Aceitar com esta conta» continua activo, porque quem decide é a base (`invite.other_person`) — o ecrã comparar e-mails podia recusar o que ela aceita (revisão do #196, P2-1). Com sessão e um convite que não vale, uma ligação para «Os seus comerciantes» | `POST /hub/invitations/preview` | a carregar; convite que não vale (a mesma mensagem para expirado, usado, cancelado, inexistente ou comerciante suspenso); 429; sem rede (mostra o erro e deixa seguir: aceitar dá a sua própria resposta) |
| **Convite com uma conta que já existe** | em `/convite`, quando a API diz que o e-mail já tem conta: «Este e-mail já tem conta. Entre com ela para aceitar o convite.» e «Entrar com passkey e aceitar»; com sessão aberta, «Entrou como {nome} ({e-mail})», «Aceitar com esta conta» e «Sair»; no formulário de conta nova, sempre «Já tem conta? Entre primeiro no Hub e volte a abrir esta ligação» | `POST /hub/session` (entrar) → `POST /hub/invitations/accept` | o convite é para outro e-mail (`invite.other_person`: sair e entrar com a conta certa); já é membro (`invite.already_member`); convite que já não vale; autenticação recente (acabou de entrar: vale); quem só tem palavra-passe entra primeiro em `/entrar` e volta a abrir a ligação |

O segredo do convite continua só na memória da página (lido uma vez ao
abrir, §2) enquanto se entra e aceita: nunca vai para o endereço nem para o
armazenamento. Com a passkey de outra conta, o ecrã passa a dizer quem
entrou e a oferecer «Sair» (revisão do #188, P2-2).

## 11. Catálogo: a lista de artigos (issue #199, proposta)

Pedido do Diogo, 08/10/2026: começar o Catálogo no Hub pelo desenho da
lista de artigos. **Só desenho**: o código vem num pedido seguinte, depois
deste estar aprovado. O catálogo é da outra sessão (#77): este passo não
mexe em `apps/api/src/catalogo/` nem no `docs/14` (aviso no #77,
08/10/2026).

### 11.1 Como o Hub lê o catálogo

**O Hub usa a mesma API que os outros clientes**, `GET /products`
(`docs/14` §7.1), e não uma rota sua: a ficha vive num sítio só (`docs/14`,
regra C1; `catalog-pim`, «Primeira regra»), e o `docs/21` §5 já diz que «a
sessão traz o papel; a base traduz-o nos âmbitos [...] que as rotas já
conferem».

**O que falta para isso** (medido a 08/10/2026): as rotas do catálogo só
aceitam chaves de API — `GET /products` tem `config.ambito: "catalog:read"`
(`apps/api/src/catalogo/rotas.ts`) e o gancho de autenticação só aceita a
sessão nas rotas `sessao` e `sessao_comerciante` (`apps/api/src/app.ts`).
**Proposta para o pedido do código:**

| Ponto | Proposta |
|---|---|
| Quem entra | numa rota com âmbito `catalog:*`, além da chave, a sessão do Hub com o cabeçalho `Eurolify-Comerciante`, de um membro activo desse comerciante |
| Que âmbitos | os do papel, pela tabela do `docs/21` §5: os quatro papéis têm `catalog:read`; `catalog:write` e `catalog:publish` só dono e gestor. A tabela vive num sítio só (na base, como os papéis), e um teste confere-a |
| Neste primeiro pedido | **só leitura** (`catalog:read`). As escritas com sessão (editar, publicar) ficam para quando houver ecrãs que as usem, cada uma com o seu desenho: pedem as guardas do Hub (origem e JSON, `docs/21` §3) e decidir quais exigem autenticação recente |
| Quem fez | numa escrita futura, `quem = pessoa:per_…` (`docs/21`, tabela do §1), como no resto do Hub |
| Comerciante suspenso ou fechado | o mesmo que a chave tem hoje nessas rotas (lê) |
| O que não muda | as rotas e as respostas do catálogo; uma chave continua a entrar como hoje |
| A alternativa recusada | uma rota `/hub/products` só do Hub: duplicava a lista e os filtros, e a regra C1 diz que o Hub usa a API como qualquer cliente |

### 11.2 O ecrã

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Artigos** (`/artigos?comerciante=mer_…`; ligação em «Os seus comerciantes», ao lado de «Equipa») | quantos artigos há («124 artigos»; com filtro, «12 de 124 artigos»); uma tabela com **Nome**, **Tipo** (físico, serviço…), **Estado** (rascunho, activo, arquivado — uma cor por estado, `eurolify-design`, regra 3), **Marca** e **Alterado em**; um artigo que vem do sistema de gestão do comerciante diz «vem do sistema de gestão» (`origem`; `docs/14` §9, P5). Filtros: estado (todos, rascunho, activo, arquivado) e procurar por nome ou por SKU de uma variante (`texto`, `sku`). «Mostrar mais» pede a página seguinte (`cursor_seguinte`, 25 de cada vez); a contagem total está sempre à vista (`eurolify-design`, «Vistas»: nunca cortar em silêncio). No telemóvel, um cartão por artigo (regra 5) | `GET /products?estado=&texto=&sku=&limite=25&cursor=` | a carregar; **sem artigos** («Ainda não há artigos. Entram pela API ou por importação.», sem botão de criar: criar no Hub fica para outro pedido); **sem resultados** para o filtro («Nenhum artigo com este filtro», com «Limpar o filtro»); erro; sem rede; 429; sessão terminada (para «Entrar»); comerciante que não é dele ou membro que já saiu (403: «Não pode ver este comerciante»); filtro inválido (400 da API, mostrado como erro do filtro) |

**O que a lista não mostra, e porquê** (medido a 08/10/2026): o
`GET /products` devolve o resumo do artigo (`CamposArtigo`: nome, tipo,
estado, marca, origem, datas…), **sem preço, sem variantes e sem
publicação**. O preço é do domínio Preços (`docs/20`) e a publicação lê-se
artigo a artigo (`GET /products/{id}/publications`): pedir isso por linha
seriam 25 pedidos por página. Ficam para depois, quando a API os der na
lista ou numa rota de resumo — a pedir ao dono do catálogo, nunca
calculado no ecrã (`eurolify-design`, regra 8).

**Fica para depois** (a lista é o primeiro passo): abrir a ficha do artigo;
criar e editar (com os campos que vêm do sistema de gestão só de leitura,
P5); publicar; traduções e revisão de pessoa (`docs/14`, «Rever uma
proposta de IA»); colunas que cada pessoa escolhe e filtros guardados
(`eurolify-design`, «Vistas»); categoria e «tradução em falta» como
filtros (a API já os tem).

### 11.3 Antes de dizer que está feito (o pedido do código)

- **API:** cada papel lê a lista com a sessão; uma sessão sem cabeçalho,
  com o comerciante de outro, de um membro que saiu ou terminada é
  recusada como hoje nas rotas do Hub; uma escrita do catálogo com sessão
  continua recusada neste pedido; uma chave continua a entrar como antes;
  o contrato mostra as duas formas de entrar nas rotas do catálogo.
- **Hub:** a passagem no navegador (`capturas.mjs`) cria artigos fictícios
  pela API, confere a contagem, os filtros, «Mostrar mais», o vazio e os
  cartões a 375 px; capturas a 375, 768 e 1280 px, claro e escuro, para o
  OK do Diogo ou do Bruno.
- **A outra sessão** vê a lista das rotas tocadas no #77 antes de o pedido
  ser juntado.

## O que não foi verificado

- **Na VPS** (revisão do #160, P3-11): que o nginx chega ao contentor pelo
  gateway da rede `eurolify`. Se chegar por outro endereço, o
  `X-Forwarded-For` não conta e todos os clientes partilham o mesmo limite.
  Mede-se depois de publicar.
- Ficam como estão, escritos para o pedido seguinte (revisão do #160): quem
  tem o Hub aberto durante uma publicação pode pedir um ficheiro que já não
  está servido (P3-8; hoje há um só ficheiro de código); sem o site do MCP, o
  Hub passa a ser o servidor por omissão da 443 (P3-9); uma falha do docker
  ao procurar os ecrãs passa por «imagem sem ecrãs», e voltar a uma imagem de
  antes do Hub deixa os ecrãs novos (P3-7); a rotação dos registos de acesso
  do nginx (IP) não foi conferida contra os 14 dias (P3-12).

- Se a chave da OVH que está na VPS (`ovh-dns.ini`) pode criar o registo
  `hub` ou só os registos do desafio do certificado.
- O comportamento das passkeys nos navegadores reais (Safari, Chrome no
  Android, Firefox): os testes usam o autenticador em software.
- As versões das bibliotecas novas (`react`, `vite`, `@simplewebauthn/browser`)
  contra o `npm audit` e a idade mínima do pnpm: lê-se ao instalar.
