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
| **Início** (`/`; antes «Os seus comerciantes»; desde o #218, a entrada por módulos: `docs/hub-modular-glassmorphism.md`) | quem entrou (nome, e-mail); o comerciante activo (no endereço, `/?comerciante=mer_…`; com vários, escolhe-se, nunca o primeiro sozinho) e os seus módulos pelos âmbitos do `/hub/me`, com a pesquisa de módulos | `GET /hub/me` | vazio («Não pertence a nenhuma equipa»: pode acontecer depois de sair de todas); escolher o comerciante; comerciante do endereço que não é da pessoa; sem módulos; pesquisa sem resultados; a carregar; sem sessão (vai para `/entrar`) |
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

**Escolher o tema** (issue #226; pedido do Diogo, 09/10/2026): no cabeçalho,
ao lado da língua, uma lista «Tema» com **Automático** (como o aparelho, por
omissão), **Claro** e **Escuro**. Automático segue o `prefers-color-scheme`
como até aqui; Claro e Escuro ganham-lhe. As cores são as da tabela abaixo,
sem valores novos: o bloco escuro dos tokens aplica-se com o aparelho em
escuro (salvo «Claro») ou com «Escuro», e um teste confere que as duas
cópias do bloco são iguais. Os controlos do navegador seguem o tema
escolhido (`color-scheme`). A escolha aplica-se quando o código do Hub
arranca, antes de desenhar o primeiro ecrã; até lá o navegador pode pintar
o fundo vazio com o tema do aparelho, um instante. Não se evita com um
guião na página, porque a CSP do Hub só deixa correr os ficheiros dele
(revisão do #227, P3-1; não medido).

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

**As letras em tamanhos relativos** (issue #237; pedido do Diogo,
09/10/2026): `--letra-base`, `--letra-pequena` e `--letra-titulo` em `rem`
(1, 0,875 e 1,5), para seguirem o tamanho de letra escolhido nas definições
do navegador. Com o tamanho por omissão (16 px) o Hub fica igual (16, 14 e
24 px). Também seguem a letra: os pontos em que as tabelas passam a cartões
(`@media`, 40em e 60em) e as colunas da grelha da entrada (`@container`,
30, 40, 55 e 65rem), que dão os mesmos px por omissão; e a grelha dos
códigos de recuperação nunca passa a largura da coluna. Espaços, alvos e
as outras larguras continuam em px: com letra grande, cartões como o de
entrar ficam mais estreitos para o texto, mas quebram sem deslocar. Medição antes da
mudança: com a letra do navegador a 32 px, o Hub ficava em 16 px (memória
`hub-entrada-modular-09out2026.md`).

## 5. Línguas e textos

PT (por omissão), ES e EN desde o primeiro ecrã (`eurolify-design`, regra 6):
um ficheiro por língua, chaves iguais, um teste que falha se faltar uma.
Masculino universal em PT («Foi convidado», «os membros»). Sem maiúsculas
forçadas. Datas pela língua escolhida (`Intl.DateTimeFormat`), no fuso do
navegador. A língua e o tema escolhidos (§4) guardam-se no navegador (são
preferências, não dados pessoais); nada mais se guarda lá. «Automático»
apaga a escolha do tema guardada.

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
| **Equipa: sair da equipa** | para qualquer membro, «Sair desta equipa» na própria linha, com confirmação (o mesmo que fecha); depois volta ao «Início». O último dono vê o botão desligado e porquê | `POST /hub/members/{id}/end` (o próprio) | o último dono não sai (`member.last_owner`) |
| **Convite: o que é, antes de aceitar** (issue #194) | em `/convite`, por cima de tudo: «Foi convidado para a equipa de {comerciante}, com o papel {papel}. O convite é para {e-mail} e expira a {data}.» Um convite que já não vale mostra só a recusa, sem formulário. Com a sessão de outra pessoa, «Este convite é para {e-mail} e entrou como {e-mail da sessão}: saia e entre com a conta desse e-mail»; «Aceitar com esta conta» continua activo, porque quem decide é a base (`invite.other_person`) — o ecrã comparar e-mails podia recusar o que ela aceita (revisão do #196, P2-1). Com sessão e um convite que não vale, uma ligação para o «Início» | `POST /hub/invitations/preview` | a carregar; convite que não vale (a mesma mensagem para expirado, usado, cancelado, inexistente ou comerciante suspenso); 429; sem rede (mostra o erro e deixa seguir: aceitar dá a sua própria resposta) |
| **Convite com uma conta que já existe** | em `/convite`, quando a API diz que o e-mail já tem conta: «Este e-mail já tem conta. Entre com ela para aceitar o convite.» e «Entrar com passkey e aceitar»; com sessão aberta, «Entrou como {nome} ({e-mail})», «Aceitar com esta conta» e «Sair»; no formulário de conta nova, sempre «Já tem conta? Entre primeiro no Hub e volte a abrir esta ligação» | `POST /hub/session` (entrar) → `POST /hub/invitations/accept` | o convite é para outro e-mail (`invite.other_person`: sair e entrar com a conta certa); já é membro (`invite.already_member`); convite que já não vale; autenticação recente (acabou de entrar: vale); quem só tem palavra-passe entra primeiro em `/entrar` e volta a abrir a ligação |

O segredo do convite continua só na memória da página (lido uma vez ao
abrir, §2) enquanto se entra e aceita: nunca vai para o endereço nem para o
armazenamento. Com a passkey de outra conta, o ecrã passa a dizer quem
entrou e a oferecer «Sair» (revisão do #188, P2-2).

## 11. Catálogo: a lista de artigos (issue #199)

Pedido do Diogo, 08/10/2026: começar o Catálogo no Hub pelo desenho da
lista de artigos. Desenho aprovado pelo Diogo a 08/10/2026 (*«sim, aprovo o
desenho, junta o #200 e avança com o código»*), com a mudança da §11.1
(*«sim, avança com a saída A»*). O catálogo é da outra sessão (#77). O
desenho (#200) não mexeu em `apps/api/src/catalogo/` nem no `docs/14`; o
código (#201) só extraiu o corpo do `GET /products` para a função
`listaDeArtigos` e exportou a `ConsultaArtigos` e a `RespostaArtigos`, sem
mudar as respostas (a lista das linhas tocadas está no #77; revisão do
#201, P2-1).

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
**O caminho** (descoberto ao começar o código, 08/10/2026): no ensaio, o
endereço do Hub só passa à API os caminhos que começam por `/hub/`
(`infra/vps/ficheiros/nginx-hub.conf`, a trava da revisão do #160, P1-1), por
isso um `GET /products` do Hub nunca chegava à API. **Decidido (saída A):**
a mesma lista responde também em **`GET /hub/products`**, com o mesmo código,
os mesmos filtros e a mesma resposta do `GET /products` (uma função só, em
`apps/api/src/catalogo/rotas.ts`); a VPS não muda. A saída B, abrir no nginx
do Hub um caminho para o catálogo, ficou de fora: alargava o que esse
endereço expõe.

**O que o pedido do código faz:**

| Ponto | Proposta |
|---|---|
| Quem entra | em `GET /hub/products`, a sessão do Hub com o cabeçalho `Eurolify-Comerciante`, de um membro activo desse comerciante (como as outras rotas `/hub/*` com comerciante); em `GET /products`, a chave, como hoje |
| Que âmbitos | os do papel, pela tabela do `docs/21` §5: os quatro papéis têm `catalog:read`; `catalog:write` e `catalog:publish` só dono e gestor. A tabela vive num sítio só (na base, como os papéis), e um teste confere-a |
| Neste primeiro pedido | **só leitura** (`catalog:read`). As escritas com sessão (editar, publicar) ficam para quando houver ecrãs que as usem, cada uma com o seu desenho: pedem as guardas do Hub (origem e JSON, `docs/21` §3) e decidir quais exigem autenticação recente |
| Quem fez | numa escrita futura, `quem = pessoa:per_…` (`docs/21`, tabela do §1), como no resto do Hub |
| Comerciante suspenso ou fechado | o mesmo que a chave tem hoje nessas rotas (lê) |
| O que não muda | as rotas e as respostas do catálogo; uma chave continua a entrar como hoje |
| A alternativa recusada | uma lista própria do Hub, com o seu código: duplicava a lista e os filtros (regra C1). O `/hub/products` não é isso: é a mesma função num segundo caminho |

### 11.2 O ecrã

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Artigos** (`/artigos?comerciante=mer_…`; módulo no «Início», ao lado de «Equipa») | quantos artigos há («124 artigos»; com filtro, «12 de 124 artigos»); uma tabela com **Nome**, **Tipo** (físico, serviço…), **Estado** (rascunho, activo, arquivado — uma cor por estado, `eurolify-design`, regra 3), **Marca** e **Alterado em**; um artigo que vem do sistema de gestão do comerciante diz «vem do sistema de gestão» (`origem`; `docs/14` §9, P5). Filtros: estado (todos, rascunho, activo, arquivado) e procurar pelo nome e pelo SKU de uma variante, em dois campos (`texto`, `sku`: a API junta os filtros, por isso um campo só procuraria os dois ao mesmo tempo). «Mostrar mais» pede a página seguinte (`cursor_seguinte`, 25 de cada vez); a contagem total está sempre à vista (`eurolify-design`, «Vistas»: nunca cortar em silêncio). No telemóvel, um cartão por artigo (regra 5) | `GET /hub/products?estado=&texto=&sku=&limite=25&cursor=` (a mesma do `GET /products`) | a carregar; **sem artigos** («Ainda não há artigos. Entram pela API ou por importação.», sem botão de criar: criar no Hub fica para outro pedido); **sem resultados** para o filtro («Nenhum artigo com este filtro», com «Limpar o filtro»); erro; sem rede; 429; sessão terminada (para «Entrar»); comerciante que não é dele ou membro que já saiu (403: «Não pode ver este comerciante», sem «Tentar outra vez»); «Mostrar mais» que falha mostra o erro por baixo das linhas já lidas; filtro inválido (400: o ecrã só deixa escolher valores válidos; se chegar, aparece como erro geral) |

**Limites aceites** (revisão do #201): «Alterado em» aparece no fuso do
navegador de quem vê, não no do comerciante (o `/hub/me` não dá o fuso; a
decidir com a `eu-localization`); com um filtro, o «de M» lê-se uma vez ao
aplicar o filtro e não se relê no «Mostrar mais» (com artigos a entrar
entretanto, pode ficar desactualizado até ao próximo filtro).

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

## 12. Catálogo: a ficha do artigo, só para consulta (issue #204)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho da ficha do
artigo»*. Desenho aprovado pelo Diogo a 09/10/2026 (*«sim, aprovo o desenho,
junta o #205 e avança com o código»*); o código está no pedido #206.
O catálogo é da outra sessão (#77): o código não muda nenhuma regra nem
resposta do catálogo, só junta caminhos `/hub/…` às mesmas funções, como na
§11.1 (aviso no #77 antes do código).

### 12.1 Como o Hub lê a ficha

Pela mesma API, com os caminhos `/hub/` que o nginx do ensaio deixa passar
(§11.1, saída A). Cada caminho novo chama **a mesma função** da rota da API,
com a sessão de quem tem `catalog:read` (os quatro papéis, `docs/21` §5) e o
cabeçalho `Eurolify-Comerciante`, como o `GET /hub/products`:

| Caminho do Hub | A mesma de | O que dá (medido a 09/10/2026) |
|---|---|---|
| `GET /hub/products/{id}` | `GET /products/{id}` | o artigo com as variantes, também as arquivadas (`Artigo`); outro comerciante dá `catalog.not_found` |
| `GET /hub/products/{id}/media` | `GET /products/{id}/media` | as imagens pela ordem, com o texto alternativo, a variante e a principal |
| `GET /hub/media/{id}/file` | `GET /media/{id}/file` | os bytes da imagem, com o tipo dela |
| `GET /hub/products/{id}/publications` | `GET /products/{id}/publications` | as publicações por canal × mercado, com o estado e o motivo de quem arquivou |

**As imagens no ecrã**: um `<img src>` não leva o cabeçalho do comerciante,
por isso o Hub pede os bytes com `fetch` (com o cabeçalho) e mostra-os por
um endereço `blob:` local, que apaga ao sair da ficha. A resposta leva
`cache-control: private, no-store`, como a lista. Os bytes pedem-se no
máximo 4 de cada vez (o limite de pedidos do Hub é por endereço IP), e cada
imagem que falha diz porquê e tem o seu «Tentar outra vez» (revisão do #206,
P2-1).

**A VPS muda numa linha** (ao contrário da §11.1): a política de segurança
dos ecrãs do Hub (`infra/vps/ficheiros/nginx-hub.conf`) passa a aceitar
`img-src blob:`; sem isso, o navegador bloqueava as imagens. Um `blob:` só o
cria código da própria página. Aplica-se pelo fluxo `aplicar-script` quando
o pedido entra no `main` (ADR-0028), e a passagem no navegador usa a mesma
política, lida do ficheiro.

### 12.2 O ecrã

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Ficha do artigo** (`/artigos/{prd_…}?comerciante=mer_…`; abre-se a partir do nome na lista de artigos, que passa a ligação) | **Cabeçalho**: nome, estado (a cor da §11.2), tipo, marca, «vem do sistema de gestão» com a referência de lá (`origem_ref`; `docs/14` §9, P5), criado e alterado em. **Descrição** (texto simples, sem formatação; vazia: «Sem descrição»). **Variantes**: uma tabela com SKU, estado (activa, arquivada), unidade de venda, GTIN, conteúdo (quantidade e unidade) e peso; cartões no telemóvel. **Imagens**: miniaturas pela ordem, a principal marcada, cada uma com o texto alternativo por baixo; uma sem texto diz «Sem texto alternativo — impede a publicação» (`docs/14` §5, C2, como a API avisa). **Publicações**: uma linha por canal × mercado, com o estado (rascunho, publicado, arquivado), a data e, se arquivada, o motivo em linguagem comum. «Voltar aos artigos» mantém os filtros da lista | as quatro da §12.1 | a carregar (cada parte à sua: o cabeçalho primeiro, as imagens e as publicações depois); artigo que não existe ou de outro comerciante (404: «Este artigo não existe neste comerciante»); sem permissão (403, como a lista); erro numa parte (essa parte diz o erro com «Tentar outra vez»; as outras ficam); sem imagens («Sem imagens»); sem publicações («Ainda não está publicado em nenhuma loja»); sessão terminada (para «Entrar») |

**O que a ficha não mostra, e porquê** (medido a 09/10/2026):

- **O nome do canal e do mercado** de cada publicação: até 09/10/2026 a
  ficha mostrava só os identificadores (`chn_…`, `mkt_…`); desde o #261
  mostra os nomes, que a API do Hub junta (§18).
- **O preço**: é do domínio Preços (`docs/20`); desde 09/10/2026 a ficha
  mostra-o pela leitura `GET /hub/products/{id}/prices` (§17).
- **Opções, kits, categorias, traduções e atributos regulamentares**: têm
  rotas próprias e ficam para depois, um de cada vez.
- **Editar**: a ficha é só de consulta; editar, com os campos que vêm do
  sistema de gestão só de leitura (P5), é um desenho à parte.

### 12.3 Antes de dizer que está feito (o pedido do código)

- **API**: para cada um dos quatro caminhos, a resposta é igual à da rota
  da API pela chave (o mesmo artigo, as mesmas imagens, os mesmos bytes, as
  mesmas publicações); outro comerciante, membro que saiu, sessão terminada
  e sem cabeçalho são recusados; os bytes de uma imagem de outro comerciante
  não saem; `no-store` nas quatro; o contrato com a sessão nos caminhos do
  Hub.
- **Hub**: a passagem no navegador cria um artigo fictício com duas
  variantes, uma imagem com texto e outra sem, abre a ficha a partir da
  lista e confere cada parte, o 404 e «Voltar aos artigos» com os filtros;
  capturas a 375, 768 e 1280 px, claro e escuro, para o OK do Diogo ou do
  Bruno; a lista de artigos (§11) entra na página de aprovação.
- **A outra sessão** vê no #77 a lista das funções do catálogo que passam a
  ter um segundo chamador.

## 13. Catálogo: editar o artigo (issue #210)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho da edição do
artigo»*. Desenho aprovado pelo Diogo a 09/10/2026, com a lista da §13.3
(*«sim, aceito a lista, junta o #211»*); o código vem depois do código do
#208 (§13.2). A edição parte da
ficha (§12). Ex.: a gestora da «Loja de Ensaio» abre o «Verniz Azul 1», vê
«Sem texto alternativo — impede a publicação» na segunda imagem, escreve
«Frasco de verniz rosa, de lado» e guarda; a publicação volta a ser
verificada e o aviso desaparece.

### 13.1 O que entra neste passo e o que fica de fora

Entra só o que a API do catálogo já sabe fazer, com as mesmas funções das
rotas pela chave (como na §11.1): nenhuma regra nova do catálogo nasce no Hub
(`catalog-pim`, «Primeira regra»; `eurolify-design`, regra 8).

| Entra | Rota da API (medido a 09/10/2026, `apps/api/src/catalogo/rotas.ts` e `rotas-media.ts`) |
|---|---|
| Nome, descrição e marca do artigo | `PATCH /products/{id}` (`alterarArtigo`), com a `versao` |
| Activar, arquivar e repor o artigo (§4.1 do `docs/14`) | `POST /products/{id}/activate`, `/archive`, `/restore` (`mudarEstadoArtigo`), com a `versao` |
| Texto alternativo, imagem principal e ordem das imagens | `PATCH /media/{id}` (`alterarMedia`), com a `versao` |
| Arquivar uma variante (final, C6) | `POST /variants/{id}/archive` (`arquivarVariante`) |

| Fica de fora, e porquê |
|---|
| **Alterar uma variante** (peso, GTIN, conteúdo, dimensões): ficou de fora deste passo por não haver rota. Desde 10/10/2026 há (`PATCH /variants/{id}` e `PATCH /hub/variants/{id}`, `docs/14` §7.1, «Alterar uma variante»; #306); o ecrã é a §23. |
| **Categoria fiscal**: a API aceita texto livre com um formato (`^[a-z][a-z0-9_]*$`), sem lista de valores; um valor escrito à mão decide o IVA. No Hub só entra como escolha de uma lista dada pelo servidor (`eu-vat-oss-ioss`; «Não se erra em documentos fiscais»). Até lá, só se lê. |
| **Classificação** (famílias, natureza, prestação): formulário próprio, com regras **C**; desenho à parte. |
| **Enviar imagens novas**: o nginx do Hub aceita corpos até 64 KB (`client_max_body_size 64k`) e as escritas do Hub só aceitam JSON (`docs/21` §3); uma imagem vai até 10 MB em bytes. Pede uma mudança à VPS e uma excepção à regra do JSON: desenho à parte. |
| Criar artigos e variantes, apagar um rascunho, traduções, publicar, opções, kits, categorias: um de cada vez, depois. |

### 13.2 Como o Hub escreve

- **Os caminhos** são `/hub/…` com a mesma função de cada rota (saída A):
  `PATCH /hub/products/{id}`, `POST /hub/products/{id}/activate`,
  `/archive`, `/restore`, `PATCH /hub/media/{id}` e
  `POST /hub/variants/{id}/archive`. O corpo é o mesmo da rota pela chave
  (o arquivar da variante leva `{}`: as escritas do Hub são JSON).
- **Quem pode**: a sessão com `catalog:write` no comerciante do cabeçalho;
  hoje o `dono` e o `gestor` (`apps/api/src/identidade/papeis.ts`). O
  `armazém` e o `apoio` recebem 403, como na lista (§11.1).
- **O ecrã não decide quem pode**: o `/hub/me` dá, por comerciante, os
  âmbitos do papel, lidos da base (`papel_ambitos`; migração 0034, pedido
  #212); um âmbito que a API ainda não conhece fica de fora, para uma
  migração nova não partir a versão anterior. O Hub mostra «Editar» só com
  `catalog:write` (e as ligações «Ver artigos» e «Chaves» com `catalog:read`
  e `keys:write`), e o servidor recusa na mesma.
- **Quem fez**: cada escrita leva `pessoa:per_…` como `eurolify.quem`, o
  formato que o #208 prevê para o Hub (`docs/14` §3.12, proposta). **O código
  da edição entra depois do código da linha do tempo** (#208): uma escrita do
  Hub sem rasto falhava a C7. Se o #208 atrasar, decide-se com o Diogo ou o
  Bruno.
- **Escritas ao mesmo tempo**: cada formulário guarda a `versao` que leu. Se
  outra pessoa (ou o sistema de gestão) alterou entretanto, a API dá
  `catalog.version_conflict` (409) e nada se grava; o ecrã diz «Outra pessoa
  alterou este artigo entretanto. Não guardámos as suas alterações.», mostra
  o que está agora e deixa o texto escrito à vista para o copiar.
- **Sem `Idempotency-Key`**, como as outras rotas do Hub (`docs/21` §11): um
  pedido repetido com a mesma `versao` dá 409, e o ecrã recarrega e mostra
  que a alteração já lá está; activar ou arquivar o que já está nesse estado
  não muda nada (§4.1 do `docs/14`).
- **Sem cache**, como as leituras (`private, no-store`).

### 13.3 Artigos que vêm do sistema de gestão (P5)

A P5 está decidida (`docs/14` §9: os campos que vêm de lá ficam só de leitura
no Hub; as traduções, a media e a publicação editam-se no Eurolify), mas
**nenhum documento diz quais são esses campos**, e a API **não o impõe**
(procurei `origem` e `externo` em `apps/api/src`: só a importação recusa,
`import.external_product`). A regra vive no servidor, nas rotas `/hub/…`,
não no ecrã: o sistema de gestão continua a escrever pela chave.

**Decidido** (Diogo, 09/10/2026: *«sim, aceito a lista»*): num artigo com
`origem: externo`, ficam só de leitura no Hub o **nome, a descrição, a marca,
a categoria fiscal, o estado do artigo e todos os dados das variantes**
(SKU, GTIN, unidade, conteúdo, peso, dimensões, arquivar). Editam-se no Hub
as **imagens** (texto alternativo, principal, ordem) e, quando existirem, as
traduções e a publicação. A API recusa o resto com um código novo
(`catalog.external_field`, 409, «este campo vem do sistema de gestão:
altera-se lá»), e o ecrã mostra esses campos sem botão de editar, com essa
frase.

### 13.4 O ecrã

| Onde | O que muda na ficha (§12.2) | Estados além do normal |
|---|---|---|
| **Cabeçalho** | Com `catalog:write`: «Editar» (nome, descrição, marca) e o botão do estado que a §4.1 deixa: «Activar» (rascunho), «Arquivar» (activo), «Repor» (arquivado). Arquivar pede confirmação: «Arquivar o artigo tira-o de venda em todas as lojas. As publicações não voltam sozinhas ao repor.» | a guardar; erro da API ao lado do campo (ex.: `catalog.name_required`); activar sem variante activa diz o motivo da API |
| **Editar** (`/artigos/{prd_…}/editar`) | Um formulário com o nome (obrigatório, até 200), a descrição (texto simples, até 10 000, com a contagem) e a marca (até 200). «Guardar» e «Cancelar»; sair com alterações por guardar pergunta antes. Depois de guardar, volta à ficha com «Alterações guardadas». | conflito de versão (§13.2); sem permissão (403); artigo que já não existe (404) |
| **Imagens** | Em cada imagem: «Editar texto alternativo» (um campo, até 500, com «Guardar»), «Tornar principal» e «Mover para antes» / «Mover para depois» (botões, não arrastar: teclado e leitores de ecrã). Depois de guardar, as publicações recarregam (a API reverifica-as). | o aviso «impede a publicação» desaparece só quando a API o diz |
| **Variantes** | Em cada variante activa: «Arquivar variante», com confirmação: «Arquivar a variante {SKU} não se desfaz.» | a última variante activa: a confirmação diz que o artigo deixa de se poder publicar até ter outra (C6) |

Sem `catalog:write`, a ficha fica como na §12 (sem nenhum botão). Num artigo
externo, como na §13.3.

### 13.5 Antes de dizer que está feito (o pedido do código)

- **API**: cada caminho `/hub/…` chama a mesma função da rota pela chave e o
  resultado é o mesmo; `armazém` e `apoio` recebem 403; outro comerciante,
  membro que saiu e sessão terminada são recusados; escrita sem a origem do
  Hub ou sem JSON é recusada; a `versao` antiga dá 409 sem gravar; o
  `eurolify.quem` é `pessoa:per_…` (visto na linha do tempo do #208); num
  artigo externo, os campos da §13.3 dão `catalog.external_field` pelo Hub e
  continuam a aceitar-se pela chave.
- **Hub**: a passagem edita o nome, escreve o texto alternativo que faltava
  (o impedimento sai da publicação real do artigo 1), muda a principal e a
  ordem, arquiva e repõe o artigo, arquiva uma variante, e confere o
  conflito de versão com duas sessões; capturas a 375, 768 e 1280 px, claro e
  escuro, e a passagem só com teclado.
- **A outra sessão** vê no #77 e no #208 os caminhos novos e quando entram.

## 14. Catálogo: criar artigos (issue #221)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho da criação de
artigos»*. Desenho aprovado pelo Diogo a 09/10/2026, com a lista do que
fica de fora e o limite de 20 variantes (*«sim, aprovo o desenho, junta o
#222»*). A §13.1 deixou de fora «criar artigos e variantes»; este passo
trata da primeira parte. Ex.: a gestora da «Loja de Ensaio» carrega em
«Criar artigo» na lista, escreve «Verniz Verde 31», a marca «Marca de
Ensaio», uma variante com o SKU `ENS-031`, «Unidade», 15 ml e 60 g, e guarda;
abre-se a ficha do artigo novo, em rascunho, com «Artigo criado em
rascunho».

### 14.1 O que entra neste passo e o que fica de fora

Como na §13.1, entra só o que a API já sabe fazer, pela mesma função da rota
pela chave (medido a 09/10/2026 em `apps/api/src/catalogo/rotas.ts`).

| Entra | Rota da API |
|---|---|
| Criar um artigo **físico**, em rascunho, com o nome, a descrição e a marca | `POST /products` (`criarArtigo` + `fichaNa`), linhas 1769–1797 |
| As variantes do artigo novo, pelo menos uma: SKU, unidade de venda, GTIN com a origem, conteúdo (quantidade e unidade), peso e dimensões | o mesmo pedido (`variantes`, `NovaVariante`, linhas 491–533) |

| Fica de fora, e porquê |
|---|
| **Serviço e bilhete**: só se publicam com a classificação (`docs/14` §3.10, P11) e a classificação tem regras **C** e desenho à parte (§13.1). Criá-los no Hub deixava rascunhos que o Hub não consegue levar a lado nenhum. Entram com o formulário da classificação. |
| **Digital e cartão-oferta**: desligados na base até às portas deles (migração 0002, `catalog.type_disabled`; ADR-0034). |
| **Categoria fiscal**: como na §13.1 (decide o IVA; só com uma lista dada pelo servidor). A API aceita criar sem ela. |
| **`onu` e `classe_adr`** (mercadorias perigosas): **C** (`docs/14` linha 122; `product-compliance-eu`). Um valor escrito à mão decide o transporte; entra com o desenho dos campos regulamentares. |
| **Opções** (cor, tamanho) e os valores de cada variante: formulário próprio. |
| **Acrescentar uma variante a um artigo que já existe** (`POST /products/{id}/variants`): num artigo com opções pede os valores (a regra `options_incomplete`), e o Hub ainda não mostra opções. Entra com elas. |
| **Imagens novas**: como na §13.1 (nginx a 64 KB e escritas só em JSON). |
| **Preço**: é do domínio Preços e mercados (#127), ainda sem código. |

**Decidido** (Diogo, 09/10/2026): no máximo **20 variantes** por artigo criado no Hub (a API
aceita 100, `MAX_VARIANTES_POR_ARTIGO_NOVO`). Um formulário com mais é
difícil de usar no telemóvel; mais do que isso entra pela importação (#197).
É um limite do ecrã, não uma regra do catálogo.

### 14.2 Como o Hub escreve

- **O caminho** é `POST /hub/products`, com a mesma função de
  `POST /products` (saída A, como na §13.2). Responde 201 com a ficha e
  `Location: /hub/products/{prd_…}`.
- **O corpo é mais estreito que o da chave**, num esquema próprio do Hub
  (como o PATCH da §13, revisão do #217, P1-1): `tipo` só `fisico`; sem
  `categoria_fiscal`; nas variantes, sem `onu`, `classe_adr` e `posicao` (a
  ordem é a do formulário); `additionalProperties: false`. O resto valida-o a
  API, como pela chave (SKU, unidade, GTIN e dígito de controlo, GTIN com
  origem, conteúdo completo).
- **Quem pode, quem fez, sem cache**: como na §13.2 (`catalog:write`;
  `pessoa:per_…` na linha do tempo; `private, no-store`). O artigo nasce com
  `origem: eurolify`: o Hub não manda `origem_ref`.
- **Sem `Idempotency-Key`**, como as outras rotas do Hub, e aqui não há
  `versao`. **O SKU faz de guarda**: é único por comerciante, também nos
  arquivados (P7), por isso um pedido repetido não cria um segundo artigo:
  dá `catalog.sku_duplicate` (409). Se a resposta se perder (sem rede, o
  pedido sai mas a resposta não chega), o ecrã não repete sozinho: procura o
  SKU da primeira variante (`GET /hub/products?sku=`, que também vê
  variantes arquivadas, `consultas.ts` linhas 125–135) e, se encontrar um
  artigo com o mesmo nome, diz «O artigo já tinha sido criado» e abre-o.
- **Que SKU está repetido**: a API não o diz (o pormenor do 409 é o texto da
  restrição da base: `paraApi`, `rotas.ts` linhas 204–211). O ecrã compara os SKU do
  próprio formulário antes de enviar (sem distinguir maiúsculas, P9) e,
  depois de um 409, procura cada SKU com `GET /hub/products?sku=` e marca ao
  lado do campo os que já existem. Para o GTIN repetido não há essa procura
  no Hub: o erro fica no topo. **A pedir ao dono do catálogo (#77)**: o
  `sku`/`gtin` repetido no pormenor do erro, o que tornava as procuras
  desnecessárias.

### 14.3 Comerciantes com sistema de gestão

Num comerciante cujos artigos vêm do sistema de gestão (P5), criar no Hub
faz um artigo `eurolify` ao lado dos de lá. **Não há na base nenhuma marca de
«este comerciante tem sistema de gestão»** (procurei `sistema_de_gestao`,
`sistema_gestao` e `tem_sistema` em `apps/api/src` e `apps/api/migracoes`).
O SKU único protege da cópia: um SKU que já veio de lá dá
`catalog.sku_duplicate`. Neste passo «Criar artigo» aparece a quem tem
`catalog:write`, como «Editar».

### 14.4 O ecrã

| Onde | O que mostra | Estados além do normal |
|---|---|---|
| **Lista** (§11.2) | Com `catalog:write`, «Criar artigo» no topo. A lista vazia passa a dizer «Ainda não há artigos.» com «Criar artigo» (sem permissão, fica a frase da §11.2). | — |
| **Criar** (`/artigos/novo?comerciante=mer_…`) | O tipo, escrito: «Físico» (sem escolha neste passo). O nome (obrigatório, até 200), a descrição (texto simples, até 10 000, com a contagem) e a marca (até 200), como na §13.4. Depois, **Variantes**, uma caixa por variante, com: SKU (obrigatório, até 64), unidade de venda (lista da API: unidade, par, caixa, embalagem, conjunto), GTIN (8, 12, 13 ou 14 algarismos) e a origem dele (só aparece com GTIN: «GS1 do comerciante», «Do fornecedor», «Interno»), conteúdo (quantidade e unidade, os dois ou nenhum: mg, g, kg, ml, cl, l, mm, cm, m, m², m³), peso em gramas e dimensões em milímetros. Sem peso, uma nota ao lado: «Sem peso, não se pode publicar» (C2). «Acrescentar outra variante» e, a partir da segunda, «Retirar esta variante». «Criar artigo» e «Cancelar»; sair com alguma coisa escrita pergunta antes (§13.4). | a criar; erro ao lado do campo (nome, SKU repetido no formulário ou já existente, GTIN inválido, GTIN sem origem, conteúdo incompleto); a resposta perdida (§14.2); sem permissão (403); 20 variantes (o botão de acrescentar sai, com «No máximo 20 variantes aqui; mais pela importação») |
| **Depois de criar** | A ficha do artigo novo (§12), com «Artigo criado em rascunho.» no aviso, que recebe o foco, e o histórico sem o formulário (`substituir`, como na §13.4). Dali seguem «Editar», «Activar» e as imagens. | — |

Os números (`peso_g`, dimensões, quantidade) são inteiros positivos (a
API recusa 0 e decimais): o campo só aceita algarismos e diz «Um número
inteiro, sem casas decimais».

### 14.5 Antes de dizer que está feito (o pedido do código)

- **API**: `POST /hub/products` chama a mesma função de `POST /products`
  e o artigo é igual ao criado pela chave; o corpo recusa `categoria_fiscal`,
  `onu`, `classe_adr`, `posicao`, `origem_ref` e um tipo que não seja
  `fisico` (400), e pela chave continuam a aceitar-se (menos o
  `origem_ref`, que a criação pela chave nunca aceitou: só a importação o
  escreve; revisão do #223, P3-2); `armazém` e `apoio`
  recebem 403; membro que saiu e sessão terminada, outro comerciante, sem a
  origem do Hub ou sem JSON são recusados; o `eurolify.quem` é
  `pessoa:per_…`; o mesmo pedido duas vezes dá `catalog.sku_duplicate` e não
  cria um segundo artigo.
- **Hub**: a passagem cria um artigo com duas variantes e abre a ficha;
  confere o SKU repetido no formulário e o já existente (marcado no campo),
  o GTIN sem origem, o conteúdo incompleto, a resposta perdida, o apoio sem
  «Criar artigo» e a lista vazia com o botão; capturas a 375, 768 e 1280 px,
  claro e escuro; tudo só com o teclado.
- **A outra sessão** vê no #77 o caminho novo e o pedido do SKU no erro.

## 15. Catálogo: enviar imagens novas (issue #229)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho do envio de
imagens»*. Desenho aprovado pelo Diogo a 09/10/2026, com a lista do que fica de fora (*«sim, aprovo o desenho, junta o #230»*). As §13.1 e §14.1 deixaram de fora as imagens novas: o nginx do Hub
aceita corpos até 64 KB e as escritas do Hub são só JSON. O #215 (#179) tirou
o terceiro motivo: os metadados (localização, data, aparelho) saem ao receber.
Ex.: a gestora abre o «Verniz Verde 31», que ainda não tem imagens, carrega em
«Acrescentar imagem», escolhe `frasco.jpg` (2,4 MB) no telemóvel, escreve
«Frasco de verniz verde, de frente» e guarda; a imagem aparece como
principal, com o texto alternativo.

### 15.1 O que entra e o que fica de fora

Entra só o que a API já sabe fazer (medido a 09/10/2026 em
`apps/api/src/catalogo/rotas-media.ts`):

| Entra | Rota da API |
|---|---|
| Enviar os bytes de uma imagem JPEG, PNG ou WebP, até 10 MB | `POST /media/uploads` (linhas 469–550): o corpo são os bytes com o `Content-Type` do ficheiro; os primeiros bytes têm de ser desse tipo; os metadados saem antes de guardar; devolve `fil_<sha256>`; o mesmo ficheiro outra vez é o mesmo `fil_` |
| Ligar o ficheiro ao artigo, com o texto alternativo e, se for a primeira, como principal | `POST /products/{id}/media` (linhas 236–272), corpo `ficheiro`, `texto_alternativo`, `principal` |
| Tirar uma imagem do artigo | `DELETE /media/{id}` (linhas 374–395): o ficheiro fica guardado; as publicações não mudam |

| Fica de fora, e porquê |
|---|
| **A imagem de uma variante** (`variante` no corpo): a ficha não mostra ainda a que variante é cada imagem de forma editável; entra com a edição das variantes (#77). |
| **Vídeos e outros tipos**: a API só aceita JPEG, PNG e WebP (`TIPOS_DE_IMAGEM`, `base/esquema.ts` linha 364). |
| **Cortar, rodar ou reduzir a imagem no Hub**: a API guarda os bytes como chegam (sem os metadados); nada se volta a codificar. |
| **Arrastar ficheiros e enviar vários de uma vez**: um de cada vez neste passo, com o botão (teclado e leitores de ecrã); vários entram depois. |

### 15.2 Como o Hub envia

São **dois pedidos**, como pela chave: os bytes e depois a ligação. O
artigo nunca fica com uma imagem sem texto alternativo por o Hub o pedir: o
ecrã só liga depois de a pessoa escrever o texto (pode ficar sem ele, com o
aviso da §12.2, se a pessoa escolher «Guardar sem texto»).

- **Os caminhos**: `POST /hub/media/uploads` (os bytes) e
  `POST /hub/products/{id}/media` (ligar), com as mesmas funções das rotas pela
  chave (saída A, como nas §13 e §14), e `DELETE /hub/media/{id}` (tirar),
  com o corpo `{}` e em JSON, como as outras escritas do Hub sem corpo
  (`docs/21`, linha 380).
- **Quem pode**: `catalog:write`, como nas §13 e §14. Num artigo do sistema de
  gestão (P5), as imagens editam-se no Hub (§13.3): enviar e tirar também.
- **Quem fez**: `pessoa:per_…` na linha do tempo (como na §13.2).
- **A excepção à regra do JSON** (`docs/21` §3, `conferirOrigem` em
  `apps/api/src/identidade/autenticacao.ts` linhas 77–100): **só** a rota
  `POST /hub/media/uploads` aceita, em vez de JSON, um dos três tipos de
  imagem. A origem do Hub continua obrigatória (`Origin` igual a
  `HUB_ORIGEM`), e o cookie é `SameSite=Strict`. Um formulário de outro site
  não consegue mandar `image/png` sem um pedido prévio do navegador (CORS),
  que a API não autoriza (procurei `@fastify/cors` e `access-control-allow`
  em `apps/api/src` a 09/10/2026: nenhum): a porta não fica aberta a ataques
  de outros sites.
  As outras escritas do Hub continuam só JSON (também o `DELETE`).
- **Envios ao mesmo tempo**: no máximo 2 por comerciante, como pela chave
  (`ENVIOS_EM_SIMULTANEO`, linha 398); o terceiro dá 429 antes de se ler o
  corpo. O limite é por comerciante, partilhado entre a chave e o Hub.
- **Repetir é seguro no envio**: o mesmo ficheiro dá o mesmo `fil_`. **Ligar
  duas vezes não é**: a base não impede o mesmo ficheiro duas vezes no
  artigo (migração 0028, sem restrição única). Sem `Idempotency-Key` no Hub,
  uma resposta perdida ao ligar faz o ecrã reler as imagens do artigo e, se
  o ficheiro já lá está, dá-o por ligado (como a §14.2 faz com o SKU).
- **O espaço**: 1 GB por comerciante (`QUOTA_POR_COMERCIANTE`,
  `armazenamento.ts` linha 78); acima dele, `catalog.media_quota_exceeded`
  (409), que o ecrã diz em linguagem comum.

### 15.3 A mudança ao nginx do Hub (VPS, ADR-0028)

`infra/vps/ficheiros/nginx-hub.conf` (linha 17) aceita 64 KB em todo o site.
Fica assim, e só assim:

```
location = /hub/media/uploads {
    client_max_body_size 10m;
    # o mesmo proxy, cabeçalhos e travas da location /hub/
}
```

O resto do site continua a 64 KB. A alteração entra pelo pedido do código e
é aplicada pelo fluxo `aplicar-script` (como a do `img-src blob:`, memória
`hub-ficha-do-artigo-09out2026.md`), e fica escrita numa memória (regra 6 de
«Operar a VPS»). **Não verifiquei** se o nginx guarda o corpo em disco
temporário acima de um certo tamanho, nem onde (`client_body_temp_path`): a
imagem ainda tem os metadados nesse momento; mede-se depois de aplicar.

### 15.4 O ecrã

| Onde | O que mostra | Estados além do normal |
|---|---|---|
| **Imagens** (na ficha, §12.2) | Com `catalog:write`: «Acrescentar imagem» (um botão que abre a escolha do ficheiro; aceita JPEG, PNG e WebP). Escolhido o ficheiro: a pré-visualização, o nome e o tamanho, um campo «Texto alternativo» (até 500, obrigatório por omissão), «Guardar» e «Cancelar». A primeira imagem do artigo fica principal. Em cada imagem: «Tirar a imagem», com confirmação («Tirar a imagem do artigo? O ficheiro fica guardado.») | a enviar (com o progresso em percentagem, por `XMLHttpRequest`, e «Cancelar» que pára o envio); ficheiro grande demais (o ecrã diz «Até 10 MB» antes de enviar); tipo errado (antes de enviar, pelo tipo do ficheiro; a API confere os bytes na mesma); a API recusa o ficheiro («não é uma imagem JPEG, PNG ou WebP», «não se conseguiu ler até ao fim»); espaço esgotado; 429 («Há outro envio a decorrer; tente daqui a pouco»); resposta perdida (§15.2); sem permissão |

Sem `catalog:write`, nenhum botão. Depois de guardar, o aviso «Imagem
acrescentada.» recebe o foco (como a §13.4), e as publicações recarregam (a
API reverifica-as).

### 15.5 Antes de dizer que está feito (o pedido do código)

- **API**: os três caminhos chamam as mesmas funções das rotas pela chave e o
  resultado é o mesmo (o `fil_` e os metadados retirados incluídos); só o
  `POST /hub/media/uploads` aceita bytes, e só com a origem do Hub (sem ela,
  403; outro caminho do Hub com `image/png`, 415); `armazém` e `apoio` recebem 403; outro comerciante,
  membro que saiu e sessão terminada são recusados; o «quem» é
  `pessoa:per_…`; o terceiro envio ao mesmo tempo dá 429; acima de 10 MB,
  413.
- **VPS**: o `nginx -t` passa com a location nova; um corpo de 1 MB passa em
  `/hub/media/uploads` e dá 413 noutro caminho `/hub/` (medido no ensaio
  depois de aplicar, de fora, sem sessão: a API responde 401 e não 413).
- **Hub**: a passagem acrescenta uma imagem com o texto, tira outra, confere
  o ficheiro grande demais e o tipo errado antes de enviar, a recusa da API,
  o 429 e a resposta perdida ao ligar; capturas a 375, 768 e 1280 px, claro e
  escuro; tudo só com o teclado.
- **A outra sessão** vê no #77 os caminhos novos.

## 16. Catálogo: o histórico do artigo (issue #239)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho do histórico do
artigo»*. Desenho aprovado pelo Diogo a 09/10/2026, com a lista do que fica
de fora (*«sim, aprovo o desenho, junta o #240»*). A API já guarda o histórico de cada artigo (`docs/14` §3.12,
migração 0033, #208) e dá-o em `GET /products/{id}/timeline`; o Hub ainda
não o mostra (`docs/14` §3.12, «Faltas conhecidas»). Este passo **só lê**:
não grava nada e não muda a VPS (o nginx já deixa passar os `GET` em `/hub/`,
§11.1). Skills: `eurolify-design`, `eu-gdpr-privacy`,
`observability-security`, `eu-localization`.

Ex.: na ficha do «Gel UV 15 ml», o dono abre «Histórico» e vê, em cima, «Hoje,
14:32 — Ana Teste alterou o artigo: Nome: «Gel UV 15 ml» → «Gel UV 15 ml
transparente»». (Nome fictício, como os dados do ensaio, `docs/21` linha 37.)

### 16.1 O que entra e o que fica de fora

| Entra | Rota da API |
|---|---|
| As alterações do artigo, das variantes, das imagens, das traduções, das opções, das categorias e colecções a que pertence e das publicações, da mais recente para a mais antiga, 25 de cada vez com «Mostrar mais» | `GET /products/{id}/timeline` (`catalogo/rotas-linha-do-tempo.ts`, linhas 114–219): `limite`, `cursor`; devolve `quem`, `em`, `origem`, `transacao`, `entidade`, `entidade_id`, `operacao`, `campos` (antes e depois) |
| **Quem fez, pelo nome** (§16.2) | o mesmo, mais o nome que a API do Hub junta |

| Fica de fora, e porquê |
|---|
| **Filtrar** por parte (só imagens, só variantes) ou por data: a API já aceita `entidade` e `desde`; entram quando o histórico for longo o bastante para fazer falta. |
| **Desfazer uma alteração** a partir do histórico: escrever o valor de antes é uma escrita nova, com as regras dela (publicação, tradução); nunca automática e nunca em lote. Desenho à parte, se for pedido. |
| **O histórico de uma categoria ou colecção** sozinha: a API ainda não tem a rota (`docs/14` §3.12). |
| **Notas da equipa e anexos**: ainda não existem (`docs/14` §3.12). |
| **Exportar o histórico**: fica para quando houver um pedido de prova concreto. |
| **O que mudou antes da migração 0033**: não há entradas, e não se inventa um passado (`docs/14` §3.12). |
| **O histórico de um rascunho apagado**: a API mantém as entradas, mas o ecrã abre-se pela ficha, e a ficha de um artigo apagado dá 404 (revisão do #242, P3-8). Entra se houver onde o pedir (ex.: uma lista dos apagados). |

### 16.2 Como o Hub lê, e o nome de quem fez

Como na §12.1: um caminho `/hub/` que chama **a mesma função** da rota pela
chave (extraída sem mudar a resposta), com a sessão e o cabeçalho
`Eurolify-Comerciante`:

| Caminho do Hub | A mesma de | Quem |
|---|---|---|
| `GET /hub/products/{id}/timeline` | `GET /products/{id}/timeline` | `catalog:history`: o **dono** e o **gestor** (`docs/21` linha 221, migração 0036); o **armazém** e o **apoio** recebem 403, e a ficha não lhes mostra a ligação |

**O nome.** A rota pela chave dá só o identificador (`pessoa:per_…`,
`chave:key_…`), de propósito (`docs/14` §3.12, «Dados pessoais»). Um
identificador não diz nada a quem gere a loja, e traduzi-lo no ecrã
obrigava o Hub a ler a equipa e as chaves e a decidir sozinho quem é quem.
Por isso **a API do Hub junta a cada entrada um `autor`**, decidido no
servidor (uma regra, um sítio):

| `quem` guardado | `autor` | O ecrã mostra |
|---|---|---|
| `pessoa:per_…` de quem **é ou foi** membro deste comerciante | `{ nome }`, o nome da conta (pseudonimizada: «Pessoa pseudonimizada», que é o que fica guardado, `docs/21` §13 ponto 7) | o nome |
| `pessoa:per_…` que nunca foi membro deste comerciante | `{ nome: null }` | «Pessoa de fora desta equipa» (não devia acontecer; não se mostra o nome de quem não é da equipa) |
| `chave:key_…` deste comerciante | `{ nome }`, o nome da chave | «Chave «{nome}»» |
| `chave:key_…` que não é deste comerciante, ou apagada | `{ nome: null }` | «Chave de API» |
| `sistema:<tarefa>` ou `catalogo:<motivo>` | `{ nome: null }` | «Automático»; com `catalogo:verificacao_falhou`, «Automático» e, na publicação, o motivo com o texto que a ficha já usa («Deixou de cumprir as regras de publicação», `textos/pt.ts` linha 404) |
| `operador:…`, `checkout:…`, `prestador:…` (`tipo_de_autor` `operador`, `consumidor`, `prestador`) | `{ nome: null }` | «Operador», «Cliente», «Prestador de pagamentos» (revisão do #359, P3-3) |
| outro valor (`tipo_de_autor` `desconhecido`) | `{ nome: null }` | o valor guardado, tal como está |

O tipo de quem fez vem no `tipo_de_autor` de cada entrada (`docs/28` §3.8);
o `autor` só traz o nome. Um `pessoa:` mal escrito (sem `per_` e o
identificador) tem o tipo `pessoa` mas nenhum nome: aparece como «Pessoa de
fora desta equipa» (revisão do #361, P3-2). O antigo `autor.tipo` saiu a 11/10/2026, quando o
Hub deixou de o ler (§26.1).

**Dados pessoais** (`eu-gdpr-privacy`): o nome serve a finalidade já
registada em `docs/21` linha 239 («saber quem fez o quê»), e só o vêem o dono
e o gestor do mesmo comerciante, que já vêem os nomes da equipa
(`GET /hub/members`). Nada novo se guarda: o nome é lido na hora, e quando a
pessoa é pseudonimizada (90 dias depois de sair, CD) o histórico passa a
mostrar «Pessoa pseudonimizada». A resposta leva
`cache-control: private, no-store`, como as outras leituras do Hub.

### 16.3 O ecrã

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Histórico do artigo** (`/artigos/{prd_…}/historico?comerciante=mer_…`; abre-se pela ligação «Histórico» na ficha, só para quem tem `catalog:history` nos âmbitos que o `GET /hub/me` dá, como o «Editar» com `catalog:write`, `ecras/Artigo.tsx` linha 159) | O nome do artigo e «Voltar à ficha». Uma lista, da mais recente para a mais antiga, em que **cada alteração** junta as entradas com a mesma `transacao` (ex.: mudar o nome e a publicação sair de venda ficam juntos): o dia e a hora (na hora deste dispositivo, como os outros ecrãs do Hub), quem (§16.2), «pela importação» quando `origem` o diz e, por baixo, uma linha por parte: o quê (§16.4), a operação (criou, alterou, apagou) e, numa alteração, cada campo com o antes → o depois. «Mostrar mais» pede as 25 seguintes (o cursor da API) e o foco vai para a primeira nova. Por cima da lista: «O histórico começa no dia em que esta função entrou; as alterações de antes não aparecem.» | `GET /hub/products/{id}/timeline`; `GET /hub/products/{id}` (o nome do artigo e o SKU das variantes) | a carregar; sem alterações («Ainda não há alterações registadas»); artigo que não existe ou de outro comerciante (404, como a ficha); sem permissão (403, como a lista); erro ao pedir mais (a lista fica; o erro e «Tentar outra vez» por baixo); sessão terminada (para «Entrar») |

### 16.4 Os campos em linguagem comum

O ecrã traduz as partes e os campos que conhece; os outros aparecem com o
nome técnico, sem se inventar o que significam.

| Parte (`entidade`) | O ecrã diz |
|---|---|
| `artigo` | «o artigo» |
| `variante` | «a variante {SKU}» (o SKU vem da ficha, que traz também as arquivadas; sem ele, «uma variante») |
| `media` | «uma imagem» |
| `traducao` | «uma tradução» (com a língua e o campo, se vierem nos `campos`) |
| `publicacao` | «uma publicação» (canal e mercado pelo identificador; a ficha mostra os nomes desde a §18, o histórico ainda não) |
| `opcao`, `valor_opcao`, `variante_valor` | «uma opção», «um valor de opção», «o valor de uma variante» |
| `componente` | «um componente do kit» |
| `artigo_categoria`, `colecao_artigo` | «uma categoria», «uma colecção» |

| Campo | Nome no ecrã |
|---|---|
| `nome`, `descricao`, `marca`, `estado`, `tipo` | Nome, Descrição, Marca, Estado (com os nomes da §11.2), Tipo |
| `sku`, `gtin`, `gtin_origem`, `unidade_de_venda` | SKU, GTIN, Origem do GTIN, Unidade de venda (com os nomes do ecrã de criar, §14) |
| `conteudo_quantidade`, `conteudo_unidade`, `peso_g`, `comprimento_mm`, `largura_mm`, `altura_mm` | Conteúdo, Unidade do conteúdo, Peso (g), Comprimento, Largura, Altura (mm) |
| `texto_alternativo`, `principal`, `posicao` | Texto alternativo, Principal, Posição |
| `motivo_arquivo` | Motivo (com os textos da ficha, §12.2) |

**A junção por alteração** junta as entradas **seguidas** com a mesma
`transacao`. Duas escritas ao mesmo tempo no mesmo artigo podem intercalar
as entradas (os `id` são da hora de cada linha), e então a mesma alteração
aparece em dois blocos, cada um com o seu quem e a sua hora: fica assim, por
ser raro e por não esconder nada (revisão do #242, P3-7).

**Os valores:** vazio diz «vazio»; `true`/`false` dizem «sim»/«não»; um
texto com mais de 160 caracteres mostra o começo e «Ver tudo» (um
`<details>`, que abre com o teclado); um valor que não é texto nem número
(JSON) mostra-se como está guardado. Os textos dos comerciantes mostram-se
como texto, nunca como HTML.

### 16.5 Antes de dizer que está feito (o pedido do código)

- **API**: o caminho do Hub dá as mesmas entradas, pela mesma ordem e com o
  mesmo cursor, que a rota pela chave, mais o `autor`; o `autor` de uma
  pessoa que saiu da equipa traz o nome, o de uma pessoa que nunca foi membro
  vem sem nome, o de uma pessoa pseudonimizada diz «Pessoa pseudonimizada», e
  uma chave de outro comerciante vem sem nome; armazém e apoio recebem 403;
  outro comerciante, membro que saiu e sessão terminada são recusados;
  `no-store`; o contrato.
- **Prova pela falha**: tirar a condição «é ou foi membro deste comerciante»
  faz falhar o teste do nome de fora; tirar o filtro do comerciante na chave
  faz falhar o da chave de outro.
- **Hub**: a passagem no navegador edita um artigo, acrescenta e tira uma
  imagem e abre o histórico pela ficha: confere o nome de quem fez, o antes
  e o depois, a junção por alteração, «Mostrar mais», «Ver tudo» e o 403 do
  armazém; tudo com o teclado; capturas a 375, 768 e 1280 px, claro e escuro,
  para o OK do Diogo ou do Bruno.
- **A outra sessão** vê no #77 que a função da linha do tempo passa a ter
  um segundo chamador.

## 17. Catálogo: os preços do artigo na ficha, só para consulta (issue #249)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho dos preços do
artigo»*. Desenho aprovado pelo Diogo a 09/10/2026, com a lista do que fica de
fora (*«sim, aprovo o desenho dos preços»*). A parte 2 de Preços (`docs/20` §10, #224) pôs na API as listas, os
preços por variante, as reduções e o preço por unidade. A ficha ainda diz
que não mostra o preço (§12.2), porque não havia como o ler. Este passo **só
lê**: não grava nada e não muda a VPS (o nginx já deixa passar os `GET` em
`/hub/`, §11.1). Skills: `consumer-rights-eu`, `eu-localization`,
`eu-vat-oss-ioss`, `headless-commerce`, `eurolify-design`.

Ex.: na ficha do «Gel UV 15 ml», a secção «Preços» mostra a lista «Base PT»
(mercado Portugal, EUR, preços com IVA): a variante GEL-15 a 7,90 €, com
«antes 9,90 € — o mais baixo dos 30 dias antes da redução · termina a
31/10/2026, 00:00» e o preço
por unidade 526,6667 €/l.

### 17.1 O que entra e o que fica de fora

| Entra |
|---|
| Os preços das variantes do artigo em cada lista **activa** do comerciante: o montante, «gratuito», a quantidade mínima e o múltiplo (quando não são 1), a redução em vigor (o preço reduzido, o de referência e o fim) e o preço por unidade, com o nome da lista, o tipo (base ou B2B), o mercado (nome, estado, moeda) e se os preços incluem IVA |
| Numa lista sem preço para uma variante: «Sem preço nesta lista» (sem preço na lista base de um mercado, o artigo não se publica nesse mercado, C2) |

| Fica de fora, e porquê |
|---|
| **Alterar preços, criar ou tirar reduções**: são escritas com regras próprias (`docs/20` §10.2: o preço de referência, `prices.reduction_active`); desenho à parte, se for pedido. |
| **O histórico de cada preço** (`GET …/history`): existe na API; entra quando houver onde o mostrar sem encher a ficha. |
| **As listas arquivadas**: não vendem; o histórico delas fica na API. |
| **O preço com o IVA de cada país**: só sai com o Motor de IVA (fatia 6). O Hub mostra o montante como está guardado e diz se inclui IVA (`preco_inclui_iva` do mercado); **nunca calcula IVA** (`eu-vat-oss-ioss`; uma regra, um sítio). |
| **Arredondar o preço por unidade** para mostrar: a regra é **C** (`docs/20` §3.7 e §10.3). O Hub mostra o valor que o servidor dá, com as quatro casas (arredondado na quarta pelo servidor, `docs/20` §10.3), e diz «com quatro casas». |
| **Os nomes do canal e do mercado nas publicações** (§12.2): a API já dá os nomes dos mercados (`GET /markets`), mas é outra parte da ficha; entrou num passo próprio (§18). |

### 17.2 Como o Hub lê

Hoje a API só lê os preços **lista a lista** (`GET /price-lists/{id}/prices`,
todas as variantes da lista, 25 de cada vez; `precos/rotas.ts` linhas
818–853). Para a ficha, isso obrigava o Hub a ler todas as listas e todos os
preços do comerciante e a filtrar ele próprio. Por isso o desenho propõe
**uma leitura nova, na API e no Hub**, com a mesma função (uma regra, um
sítio):

| Caminho | Quem | O que dá |
|---|---|---|
| `GET /products/{id}/prices` (chave) | `prices:read` | as listas **activas** do comerciante, por ordem de criação e por páginas (o formato das listas, `docs/18` §2a; 25 por omissão), cada uma com o nome, o tipo, o mercado (`id`, `nome`, `estado`, `moeda`, `preco_inclui_iva`) e os preços das variantes **deste artigo** (o mesmo `PrecoEsquema` de `GET /price-lists/{id}/prices`: o montante, gratuito, mínimo, múltiplo, a redução em vigor e o preço por unidade) |
| `GET /hub/products/{id}/prices` | a sessão com `prices:read` (os quatro papéis, `docs/21` §5 e migração 0036) e o cabeçalho `Eurolify-Comerciante` | o mesmo, pela mesma função |

- **A função** fica no domínio de Preços (`precos/repositorio.ts`), ao lado
  de `precosDaListaComReducoes`, e usa o mesmo cálculo da redução em vigor e
  do preço por unidade (`paraPreco`, `precoPorUnidade`). Nada se recalcula
  no ecrã.
- **Um artigo de outro comerciante, ou que não existe**: 404, como a ficha.
- `cache-control: private, no-store`, como as outras leituras do Hub.
- **Quem trabalha em Preços** vê no #127 (fechado) e nas notas do `docs/20`
  que a rota nova existe e quem a chama (como o aviso do #77 para o
  Catálogo).

### 17.3 O ecrã

| Ecrã | O que mostra | Rotas da API | Estados além do normal |
|---|---|---|---|
| **Ficha do artigo**, secção nova **«Preços»** (entre «Variantes» e «Imagens»; para os quatro papéis) | Uma caixa por lista: o nome da lista, «base» ou «B2B», o mercado (nome e, se não estiver activo, o estado: «mercado em rascunho»), a moeda e «preços com IVA» ou «preços sem IVA». Por baixo, uma linha por variante do artigo (pela ordem da ficha, também as arquivadas, marcadas): SKU; o preço na moeda da lista (`Intl.NumberFormat` com a moeda, a partir dos cêntimos) ou «Gratuito»; numa redução em vigor, o preço reduzido em destaque e «antes {preço de referência} — o mais baixo dos 30 dias antes da redução» e, se tiver fim, «termina a {data e hora}»; o preço por unidade («526,6667 €/l, com quatro casas»); a quantidade mínima e o múltiplo só quando não são 1. Uma variante sem preço nessa lista: «Sem preço nesta lista». «Mostrar mais listas» quando há mais de 25 | `GET /hub/products/{id}/prices` | a carregar (a secção à sua, como as imagens e as publicações, §12.2); sem listas activas («Ainda não há listas de preços activas»); erro só nesta parte (o erro e «Tentar outra vez»; o resto da ficha fica); sem permissão (403: a secção diz que não pode ver os preços) |

**Os textos mudados na revisão do #252** (09/10/2026), para dizerem
exactamente o que o servidor faz: o preço de referência é o mais baixo dos
30 dias **antes da redução** (não dos últimos 30 dias, P2-1); o preço por
unidade vem **com quatro casas**, já arredondado na quarta pelo servidor
(«sem arredondar» era falso, P2-2); o fim leva a hora, porque é o instante
em que a redução deixa de valer (P3-5). O aspecto e os textos vão ao OK do
Diogo ou do Bruno na página de aprovação.

**Os textos dos preços** dizem o que o servidor decidiu e nada mais:
«com IVA» ou «sem IVA» vem do mercado; o preço de referência vem calculado
(`docs/20` §3.6), e o Hub só o mostra. O preço por unidade é o que a API dá,
com a unidade dela (kg, l, m, m², m³).

### 17.4 Antes de dizer que está feito (o pedido do código)

- **API**: a rota pela chave e a do Hub dão o mesmo; só listas activas; só
  as variantes do artigo; a redução em vigor e o preço por unidade iguais aos
  de `GET /price-lists/{id}/prices` para a mesma variante; um artigo de outro
  comerciante ou que não existe dá 404; sem `prices:read` (uma chave só com
  `catalog:read`) dá 403; outro comerciante pelo cabeçalho, membro que saiu
  e sessão terminada são recusados; `no-store`; o contrato (a rota pela chave
  com `chave`, a do Hub com `sessao`).
- **Prova pela falha**: tirar o filtro do artigo faz aparecer variantes de
  outro artigo no teste; tirar o filtro das listas activas faz aparecer a
  arquivada.
- **Hub**: a passagem cria duas listas (uma base com IVA e uma B2B), preços
  para uma das duas variantes, uma redução com fim e uma variante sem preço;
  confere cada texto, «Gratuito», o preço por unidade e o erro só nesta
  parte; tudo com o teclado; capturas a 375, 768 e 1280 px (claro e escuro)
  para o OK do Diogo ou do Bruno.
- **Quem trabalha em Preços** vê o aviso da rota nova.

## 18. Catálogo: os nomes do canal e do mercado nas publicações (issue #258)

Pedido do Diogo, 09/10/2026: *«sim, avança com os nomes do canal e do
mercado»*. Desenho aprovado pelo Diogo a 09/10/2026 (*«sim, aprovo o
desenho, junta o #259»*). A secção «Publicações» da ficha mostra só os identificadores
(`chn_…`, `mkt_…`), porque, quando a ficha foi feita, nenhuma rota dava os
nomes (§12.2). O domínio de Preços já os tem: o canal e o mercado têm `nome`
(`docs/20` §3.1 e §3.2; migração 0017). Este passo **só lê** e não muda a
VPS.

Ex.: a publicação do «Gel UV 15 ml» passa de «`chn_0192…` · `mkt_0192…` ·
Rascunho» para «Loja online · Portugal · Rascunho».

### 18.1 Como o Hub lê

- **O caminho é o mesmo**: `GET /hub/products/{id}/publications` continua a
  chamar a mesma função da rota pela chave (`publicacoesDeArtigo`, §12.1). A
  API do Hub **junta** a cada publicação `canal_nome` e `mercado_nome`, lidos
  do domínio de Preços em duas consultas na mesma transacção (os canais e os mercados das
  publicações daquele artigo, no contexto do comerciante), como o `autor`
  do histórico (§16.2).
- **A rota pela chave não muda** (`GET /products/{id}/publications`): é do
  Catálogo (#77), e quem integra já tem `GET /channels` e `GET /markets`
  para os nomes. Acrescentar campos a ela fica para o dono do Catálogo
  decidir.
- **Um canal ou mercado arquivado** continua com o nome (arquiva-se, não
  se apaga: a API só tem `DELETE` em `canal_mercado` e `preco`, migração
  0017, linhas 492–499). Se um nome não vier (não devia acontecer), o ecrã mostra o
  identificador, como hoje.
- **Quem vê**: os mesmos da ficha (`catalog:read`, os quatro papéis). Os
  nomes de canais e mercados não são dados pessoais nem preços.

### 18.2 O ecrã

| Ecrã | O que muda |
|---|---|
| **Ficha do artigo**, secção «Publicações» (§12.2) | As colunas «Canal» e «Mercado» mostram o nome. O identificador deixa de aparecer na tabela (fica no endereço da API para quem integra). Um nome em falta mostra o identificador, como hoje. Nada mais muda: o estado, a data e o motivo ficam como estão. |

### 18.3 Antes de dizer que está feito (o pedido do código)

- **API**: o caminho do Hub dá as mesmas publicações que a rota pela chave,
  mais os dois nomes; um canal arquivado mantém o nome; os nomes são os do
  comerciante da sessão (outro comerciante com um canal do mesmo nome não
  interfere); o contrato do Hub com os dois campos e o da chave sem eles.
- **Prova pela falha**: tirar o filtro do comerciante na consulta dos nomes
  faz falhar o teste de outro comerciante.
- **Hub**: a passagem confere «Loja online» e «Portugal» na tabela das
  publicações; as capturas da ficha mudam e vão à página de aprovação.

### 18.4 O que ficou em aberto (código no #261)

- **Dois canais ou dois mercados com o mesmo nome** (revisão do #261,
  P2-1): a base não obriga o nome a ser único (migração 0017 só tem
  `UNIQUE (comerciante_id, id)` e `UNIQUE (comerciante_id, loja_id, id)`),
  e a ficha mostra duas linhas iguais (ex.: uma «Loja online» em cada uma
  de duas lojas). O Diogo decidiu juntar como está (09/10/2026, *«sim,
  junta como está»*); trata-se num passo próprio (ex.: juntar o nome da
  loja). Não verifiquei se acontece com dados reais.
- **Um erro na leitura dos nomes** sai com o código `prices.*` numa rota do
  Catálogo (revisão do #261, P3-6): é raro numa leitura; fica registado.

## 19. Catálogo: canais e mercados com o mesmo nome nas publicações (issue #271)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho dos canais com o
mesmo nome»*. Desenho aprovado pelo Diogo a 09/10/2026 (*«sim, aprovo o
desenho, junta o #272»*). Vem do P2-1 da revisão do #261 (§18.4). Este passo **só
lê** e não muda a VPS.

**O problema**: a base não obriga o nome a ser único, nem o do canal e do
mercado (migração 0017: só `UNIQUE (comerciante_id, id)` e
`UNIQUE (comerciante_id, loja_id, id)`), nem o da loja (migração 0001,
tabela `loja`). Ex.: um comerciante com duas lojas, «Norte» e «Sul», cada
uma com um canal «Loja online» e um mercado «Portugal»; o mesmo artigo
publicado nas duas dá duas linhas «Loja online · Portugal · Publicado» que
não se distinguem.

### 19.1 Como o Hub lê

- **A loja de cada publicação**: a publicação tem a loja, e o canal e o
  mercado são dela (as duas chaves estrangeiras levam o `loja_id`,
  migração 0019, linhas 85–87). A API do Hub junta a cada publicação
  `loja_nome`, lido na mesma leitura dos nomes da §18.1 (no contexto do
  comerciante e com o filtro dele escrito), como o `canal_nome` e o
  `mercado_nome`. Uma loja arquivada continua com o nome.
- **A rota pela chave não muda** (`GET /products/{id}/publications`, do
  Catálogo, #77), como na §18.1.
- **Quem vê**: os mesmos da ficha (`catalog:read`). O nome da loja não é
  dado pessoal.

### 19.2 O ecrã

A regra é **só acrescentar quando há repetição**: a maioria dos
comerciantes tem uma loja, e a tabela fica como hoje.

| Caso, dentro da tabela «Publicações» de um artigo | O que a coluna «Canal» (ou «Mercado») mostra |
|---|---|
| O nome não se repete noutra linha com outro canal (mercado) | Só o nome, como hoje: «Loja online» |
| O mesmo nome noutra linha, com outro canal (mercado), de **outra loja com outro nome** | O nome e, por baixo, a loja em texto secundário: «Loja online» / «Loja Norte» |
| O mesmo nome e **a mesma loja** (dois canais com o mesmo nome na mesma loja), ou duas lojas também com o mesmo nome | O nome e, por baixo, o identificador em texto secundário (`chn_…`, `mkt_…`), como antes da §18: é o único que os distingue |
| O nome não veio | O identificador, como hoje (§18.2) |

- A decisão é **por coluna**: o canal e o mercado avaliam-se à parte (ex.:
  dois canais «Loja online» de lojas diferentes, com mercados «Portugal» e
  «Espanha»: a loja aparece por baixo do canal, o mercado fica só com o
  nome).
- **Leitores de ecrã**: a loja ou o identificador ficam dentro da mesma
  célula, por isso são lidos com o nome. O identificador leva
  `translate="no"`. Antes da loja, um «Loja:» só para leitores de ecrã
  (invisível no ecrã), para se ouvir «Loja online, Loja: Norte» (decisão
  do Diogo, 09/10/2026, *«sim, acrescenta o «Loja:» para leitores de
  ecrã»*; revisão do #275, P3-6).
- **Telemóvel** (cartões, `data-rotulo`): a mesma célula, sem mudar o
  rótulo.

### 19.3 Antes de dizer que está feito (o pedido do código)

- **API**: o `loja_nome` de cada publicação é o da loja dela; uma loja
  arquivada mantém o nome; o nome de uma loja de outro comerciante não
  vem; o contrato do Hub tem o campo e o da chave não.
- **Prova pela falha**: tirar o filtro do comerciante na leitura da loja
  faz falhar o teste de outro comerciante (como na §18.3). *Nota do
  código (revisão do #275, P2-2):* a loja lê-se pelo JOIN com o canal, que
  já tem o filtro do comerciante; o filtro escrito na loja é uma segunda
  guarda e tirá-lo sozinho não muda o resultado. A prova é a do canal
  (§18.3), e a de que cada publicação traz a sua loja é um teste com duas
  lojas do mesmo comerciante.
- **Hub**: testes da regra (os quatro casos da tabela da §19.2, por
  coluna); a passagem confere uma linha só com o nome e duas linhas com a
  loja por baixo; as capturas da ficha vão à página de aprovação.

## 20. Catálogo: as opções do artigo na ficha, só para consulta (issue #278)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho das opções»*. Desenho
aprovado pelo Diogo a 09/10/2026 (*«sim, aprovo o desenho, junta o
#279»*). As
opções são as escolhas que distinguem as variantes de um artigo (ex.: «Cor»
com «Azul» e «Rosa», «Tamanho» com «15 ml» e «30 ml»; `docs/14` §3.3). A
ficha hoje mostra as variantes só pelo SKU, sem dizer qual é a azul. Este
passo **só lê** e não muda a VPS; criar, renomear ou ordenar opções fica
para um passo próprio (as regras do rascunho, `docs/14` §3.3, pedem um
desenho dessa escrita).

Ex.: o «Verniz Azul 1» com a opção «Tamanho» passa de «ENS-001 · Activa ·
Unidade…» para «ENS-001 · 15 ml · Activa · Unidade…».

### 20.1 Como o Hub lê

- **As opções**: `GET /hub/products/{id}/options` chama a mesma função da
  rota pela chave (`GET /products/{id}/options`, `catalog:read`): as opções
  pela ordem, cada uma com os valores pela ordem, no formato das listas. O
  Hub pede páginas de 100 até ao fim (um artigo com mais de 100 opções não
  é um caso real, mas não se corta em silêncio).
- **Que valor tem cada variante**: a ficha lê as variantes sem os valores
  (`GET /hub/products/{id}`), e a rota pela chave só os dá variante a
  variante (`GET /variants/{id}`). A API do Hub **junta** a cada valor
  `variantes` (os `var_…` que o têm, também as arquivadas), lidos da tabela
  `variante_valor` (migração 0005) na mesma transacção, no contexto do
  comerciante e com o filtro dele escrito — como o `autor` do histórico
  (§16.2) e os nomes das publicações (§18.1). A rota pela chave não muda.
- **Os textos**: o nome da opção e o valor como estão guardados (a língua
  de origem); as traduções (`docs/14` §3.3, parte 3) ficam para o passo das
  traduções.
- **Quem vê**: os mesmos da ficha (`catalog:read`, os quatro papéis).

### 20.2 O ecrã

| Ecrã | O que muda |
|---|---|
| **Ficha do artigo**, tabela «Variantes» (§12.2) | Uma coluna por opção, pela ordem das opções, entre o SKU e o estado, com o valor da variante (ex.: «Tamanho: 15 ml»). Uma variante sem valor nessa opção (um rascunho incompleto, `docs/14` §3.3) mostra «—». Nos cartões do telemóvel, o rótulo é o nome da opção (`data-rotulo`). |
| **Ficha do artigo**, por cima da tabela | Uma linha «Opções: Tamanho (15 ml, 30 ml) · Cor (Azul, Rosa)», com todos os valores pela ordem, também os que nenhuma variante usa. |
| Artigo **sem opções** | Nada muda: nem colunas nem a linha. |
| As opções **falham ao ler** | A tabela fica como hoje e, por cima, «Não foi possível ler as opções» com «Tentar outra vez» (cada parte falha sozinha, §12.2). |

### 20.3 Antes de dizer que está feito (o pedido do código)

- **API**: o caminho do Hub dá as mesmas opções que a rota pela chave,
  mais `variantes` em cada valor; uma variante arquivada aparece no seu
  valor; um valor sem variantes vem com a lista vazia; as variantes de
  outro comerciante não aparecem (prova pela falha: tirar o filtro faz
  falhar o teste); o contrato do Hub tem o campo e o da chave não.
- **Hub**: testes de como se monta a coluna (variante com valor, sem
  valor, artigo sem opções); a passagem confere a coluna e a linha num
  artigo com opções e nada num sem opções; as capturas da ficha vão à
  página de aprovação.

## 21. Catálogo: escrever as opções do artigo (issue #285)

Pedido do Diogo, 09/10/2026: *«sim, avança com o desenho da escrita das
opções»*. Desenho aprovado pelo Diogo a 09/10/2026 (*«sim, aprovo o
desenho, junta o #286»*). A §20 pôs as opções na ficha só para
consulta; este passo deixa escrevê-las pelo Hub. Ex.: a gestora da «Loja de
Ensaio» cria o rascunho «Verniz Verde 31» com duas variantes (§14), abre
«Editar opções», cria «Tamanho» com «15 ml» e «30 ml», dá «15 ml» à
`ENS-031` e «30 ml» à `ENS-031-B`, e activa o artigo; depois de activo,
acrescenta «50 ml» e passa-o para o primeiro lugar, mas já não pode mudar
«15 ml» para «15ml».

### 21.1 O que entra e o que fica de fora

| Entra | Rota da API (o `docs/14` §7.1, «A escrita das opções») |
|---|---|
| Criar uma opção com os valores (rascunho) | `POST /products/{id}/options` (já existe) |
| Acrescentar um valor no fim (sempre) | `POST /options/{id}/values` (já existe) |
| Mudar o nome de uma opção ou o texto de um valor (rascunho) | `PATCH /options/{id}`, `PATCH /options/{id}/values/{valor}` (novas) |
| Apagar uma opção ou um valor (rascunho) | `DELETE /options/{id}`, `DELETE /options/{id}/values/{valor}` (novas) |
| Mudar a ordem das opções e dos valores (sempre) | `PUT /products/{id}/options/order`, `PUT /options/{id}/values/order` (novas) |
| Dar valores às variantes (rascunho) | `PUT /variants/{id}/values` (nova) |

| Fica de fora, e porquê |
|---|
| **Criar uma variante num artigo que já existe**: o Hub só cria variantes com o artigo (§14). Num artigo activo com opções, uma variante nova entra já com os valores (`docs/14` §3.3); é um passo próprio. |
| **Traduzir os nomes e os valores**: o passo das traduções (`docs/14` §3.3, parte 3). |
| **Arrastar para ordenar**: «Mover para antes» e «Mover para depois», como nas imagens (§13.4), por serem do teclado e dos leitores de ecrã. |

### 21.2 Como o Hub escreve

- **Os caminhos** são `/hub/…` com a mesma função de cada rota pela chave
  (como na §13.2), com a sessão de quem tem `catalog:write` (o dono e o
  gestor; o armazém e o apoio recebem 403), sem `Idempotency-Key` e com o
  `eurolify.quem` da pessoa.
- **Apagar pelo Hub** leva a `versao` no corpo (`{"versao": 3}`), não na
  consulta: as escritas do Hub são JSON (`docs/21` §3).
- **A `versao` da opção** (`docs/14` §7.1): o formulário guarda a que leu. Se
  outra pessoa mudou a opção entretanto, a API dá
  `catalog.version_conflict` (409) e nada se grava; o ecrã diz «Outra pessoa
  alterou esta opção entretanto. Não guardámos a sua alteração.», recarrega
  as opções e deixa o texto escrito à vista.
- **O ecrã não decide o que é permitido**: num artigo que não é rascunho, os
  campos do nome e do texto e os botões de apagar não aparecem, com a frase
  «O nome e os valores só mudam enquanto o artigo é rascunho»; se aparecerem
  por o estado ter mudado entretanto, a API recusa com `catalog.not_draft` e
  o ecrã diz o motivo dela.
- **Artigos do sistema de gestão** (§13.3): num artigo `externo`, nada disto
  aparece, e a API do Hub recusa com `catalog.external_field`.

### 21.3 O ecrã

| Onde | O que muda | Estados além do normal |
|---|---|---|
| **Ficha** (§20.2), por cima da tabela das variantes | Com `catalog:write` e um artigo que não é externo: «Editar opções» (num artigo sem opções: «Criar opções»). | — |
| **Editar opções** (`/artigos/{prd_…}/opcoes`) | Uma caixa por opção, pela ordem: o nome (campo, só em rascunho), os valores pela ordem, cada um com o texto (campo, só em rascunho), «Mover para antes», «Mover para depois» e «Apagar» (só em rascunho); no fim da caixa, «Acrescentar valor» (sempre). Por baixo das caixas, «Criar opção» (só em rascunho: o nome e um valor por linha). «Voltar à ficha» leva de volta. | a guardar; erro da API ao lado do campo (ex.: «Já há uma opção com este nome»); conflito de versão (§21.2) |
| **Apagar** | Pede confirmação. Uma opção: «Apagar a opção Tamanho tira-a das 2 variantes que a têm. Não se desfaz.» (com uma ou nenhuma variante, o texto diz isso) Um valor: «As variantes com 30 ml ficam sem valor em Tamanho. Não se desfaz.» | duas variantes iguais depois de apagar: a frase da API («duas variantes activas com a mesma combinação») |
| **Valores das variantes** (na mesma página, só em rascunho) | Uma tabela com uma linha por variante activa (SKU) e uma lista de escolha por opção («—» sem valor); «Guardar» por linha. Por cima, quantas variantes estão incompletas: «1 variante ainda sem valor numa das opções: o artigo não se activa assim.» (revisão do #297, P3-4) | a guardar; erro da API na linha |
| **Activar** (cabeçalho da ficha, §13.4) | Sem mudanças: se faltar um valor, a API recusa com `catalog.options_incomplete` e o ecrã diz «Cada variante activa leva um valor de cada opção», com a ligação «Editar opções». | — |

Sem `catalog:write`, nada disto aparece e a ficha fica como na §20.

### 21.4 Antes de dizer que está feito (o pedido do código)

- **API**: cada rota nova pela chave e pelo Hub; as recusas da §7.1 do
  `docs/14` (fora do rascunho, nome repetido, ordem que não bate, valor de
  outro artigo, combinação repetida ao apagar); a `versao` antiga dá 409 sem
  gravar; o armazém e o apoio recebem 403; outro comerciante não chega à
  opção dele (com a prova pela falha); o `artigo externo` recusa pelo Hub e
  aceita pela chave; a linha do tempo tem cada mudança com quem fez; uma
  tradução fica «desactualizada» depois de mudar o nome; a migração da
  `versao` corre num artigo com opções antigas.
- **Hub**: a passagem faz o exemplo do início (criar, dar valores, activar,
  acrescentar e mudar a ordem depois de activo), confere que o nome já não
  se edita depois de activo, apaga um valor com confirmação e o conflito de
  versão com duas sessões; capturas a 375, 768 e 1280 px, claro e escuro, e
  só com teclado; as capturas vão à página de aprovação.

## 22. As chaves a propor revogar depois de recuperar a conta (issue #107)

Decisão do Diogo, 10/10/2026: *«só propor, não revogar sozinho»*
(`docs/06`, DC; `docs/21` §12, revisão do #149, P2-1). Depois de recuperar
a conta, todas as sessões terminam, mas as chaves de API que a pessoa criou
continuam a funcionar. Uma sessão roubada pode ter criado uma chave, e essa
chave fica.

**O que muda:** no aviso «A conta foi recuperada» (`/conta`, §9.1), por baixo
das três linhas que já lá estavam, aparece um bloco por cada comerciante de
que a pessoa é dona: «Chaves de API que criou em «Loja de Ensaio»».

| O quê | Como |
|---|---|
| Que chaves | as **activas** (nem revogadas nem expiradas) com `criada_por = pessoa:<esta pessoa>`, da mais nova para a mais antiga. As de outros membros, do operador ou criadas por outra chave não aparecem: não são desta pessoa |
| Colunas | nome, começo da chave, criada em, último uso, «Revogar» |
| Revogar | uma a uma, com a mesma confirmação e a mesma autenticação recente do ecrã das chaves (§9.3), e a mesma rota (`POST /hub/keys/{id}/revoke`). **Não há «revogar todas» nem nada automático** (DC) |
| Sem chaves | «Não criou nenhuma chave activa neste comerciante.» |
| Falha ao ler | a caixa de erro com «Tentar outra vez», só nesse bloco (os outros e o resto do aviso continuam) |
| Rotas | `GET /hub/keys?comerciante=` (já existe); a API não muda |
| Fechar o aviso | fecha também os blocos; as chaves continuam no ecrã «Chaves de API» |

**Antes de dizer que está feito:** um teste da escolha das chaves (activas,
desta pessoa, pela ordem) e a passagem pelo Chromium. A passagem faz uma
segunda recuperação da Ana, depois de ela criar chaves (§9.3), e confere:
- aparecem as chaves activas dela nesse comerciante, contadas na base
  (hoje, «Com prazo» e «Sem resposta»);
- não aparecem a revogada nem a do operador (as de outro membro e as
  criadas por outra chave ficam provadas no teste da escolha);
- nenhuma foi revogada sem ela;
- revogar uma deixa só a outra.

Capturas a 375 e 1280 px, claro e escuro, para a página de aprovação.

## 23. Catálogo: alterar uma variante (issue #301)

Pedido do Diogo, 10/10/2026: *«sim, avança com o desenho de alterar uma
variante»*. **Aprovado pelo Diogo a 10/10/2026**: *«sim, aprovo o desenho,
junta o #302»*. A §13.1 deixou de fora «alterar uma
variante» por não haver rota; o `docs/14` §7.1 («Alterar uma variante»)
desenha-a. Ex.: a gestora da «Loja de Ensaio» vê na ficha do «Verniz Rosa
2» que a publicação diz «peso em falta», carrega em «Editar» na linha da
`ENS-002`, escreve 60 g e guarda; a publicação pode então ser publicada.

### 23.1 Como o Hub escreve

- `PATCH /hub/variants/{id}`, a mesma função do `PATCH /variants/{id}`, com
  a sessão de quem tem `catalog:write` (o dono e o gestor), sem
  `Idempotency-Key` e com o `eurolify.quem` da pessoa (como a §13.2).
- A `versao` da variante: o formulário guarda a que leu; uma versão antiga
  dá «Outra pessoa alterou esta variante entretanto. Não guardámos as suas
  alterações.», mostra o que está guardado agora e deixa o que se escreveu.
- Num artigo `externo`, nada disto aparece, e a API do Hub recusa com
  `catalog.external_field` (§13.3).

### 23.2 O ecrã

| Onde | O que muda | Estados além do normal |
|---|---|---|
| **Ficha**, tabela «Variantes» (§12.2) | Com `catalog:write`, em cada variante activa: «Editar» ao lado de «Arquivar variante». | — |
| **Editar a variante** (`/artigos/{prd_…}/variantes/{var_…}`) | O SKU à vista, sem campo (não muda). Campos: peso (g), comprimento, largura e altura (mm), GTIN e a origem dele (uma lista: «GS1 do comerciante», «Do fornecedor», «Interno»), ONU e classe ADR, como no ecrã de criar (§14). Num rascunho, também a unidade de venda e o conteúdo; depois de activo, aparecem só para ler, com «A unidade e o conteúdo só mudam enquanto o artigo é rascunho». «Guardar» e «Cancelar»; sair com alterações por guardar pergunta antes. | a guardar; o erro da API ao lado do campo (ex.: «Este GTIN já existe noutra variante»); conflito de versão (§23.1); variante arquivada (não abre o formulário: «Esta variante está arquivada e não muda.») |

### 23.3 Antes de dizer que está feito (o pedido do código)

- **API**: a rota pela chave e pelo Hub; as recusas (SKU, unidade e conteúdo
  fora do rascunho, GTIN sem origem, repetido ou com o dígito errado, peso
  apagado numa variante à venda, variante arquivada); a `versao` antiga dá
  409 sem gravar; o armazém e o apoio recebem 403; outro comerciante não
  chega (com a prova pela falha); o artigo externo recusa pelo Hub e aceita
  pela chave; a linha do tempo tem a mudança com quem fez; a migração da
  `versao` corre sobre variantes que já existiam.
- **Hub**: a passagem resolve o «peso em falta» de uma publicação real, muda
  o GTIN, confere que a unidade não se edita depois de activo e o conflito
  de versão; capturas a 375, 768 e 1280 px, claro e escuro, e só com
  teclado; as capturas vão à página de aprovação.

## 24. Catálogo: acrescentar uma variante a um artigo existente (issue #321)

Pedido do Diogo, 10/10/2026 («continuar», à pergunta *«Avanço com o
desenho de "acrescentar uma variante" no Hub?»*). **Aprovado pelo
Diogo a 10/10/2026**: *«aprovado»*. A §14 cria o artigo com as variantes; a §23 edita e a §12.2
arquiva cada uma. Falta acrescentar uma variante a um artigo que já existe.
A API pela chave já o faz (`POST /products/{id}/variants`, `docs/14` §7.1);
o Hub ainda não tem a rota. Ex.: o «Gel Coral 41» vende-se à unidade
(`ENS-041`) e a gestora acrescenta a `ENS-041-B`, em caixa de 6, com o
GTIN do fornecedor e 400 g.

### 24.1 Como o Hub escreve

- `POST /hub/products/{id}/variants`, a mesma função do `POST
  /products/{id}/variants`, com a sessão de quem tem `catalog:write` (o dono
  e o gestor) e o `eurolify.quem` da pessoa (como a §13.2). O corpo é o
  mesmo: o SKU, a unidade, o GTIN com a origem, o conteúdo, o peso, as
  dimensões, o ONU, a classe ADR e os `valores` (um `ovl_…` por opção).
- **As regras são as da API e da base, sem cópia no Hub:**
  - o SKU é único no comerciante, também entre as variantes arquivadas e
    sem distinguir maiúsculas (C3, P7, P9);
  - num artigo com opções que já não é rascunho, a variante leva um valor
    de cada opção e uma combinação que nenhuma outra variante activa tenha
    (§3.3; a base confere no fim da transacção);
  - também se acrescenta a um artigo **arquivado** (é assim que se repõe um
    artigo sem variantes activas, §4.1);
  - num artigo **publicado**, a variante nova **nasce fora** das
    publicações (0019; `docs/14` §8): não se vende antes de uma verificação.
- **Sem `Idempotency-Key`** (como as outras escritas do Hub): se a resposta
  se perde e o pedido se repete, o SKU já existe. O ecrã procura então o SKU
  neste artigo e, se a variante lá estiver com o que se escreveu, dá-a por
  criada (como a §14.2).
- Num artigo `externo`, a API do Hub recusa com `catalog.external_field`
  (§13.3, P5); pela chave, aceita.

### 24.2 O ecrã

| Onde | O que muda | Estados além do normal |
|---|---|---|
| **Ficha**, secção «Variantes» (§12.2) | Com `catalog:write`, num artigo que não é do sistema de gestão: o botão «Acrescentar variante», por baixo da tabela. | — |
| **Acrescentar variante** (`/artigos/{prd_…}/variantes/nova`) | Os campos da §23.2, com o SKU e a unidade de venda obrigatórios e todos editáveis (a unidade e o conteúdo de uma variante nova escolhem-se sempre, também num artigo activo). Se o artigo tem opções, uma lista por opção, com os valores dela; num rascunho podem ficar por escolher, depois de activo são obrigatórias. «Criar variante» e «Cancelar»; sair com o formulário escrito pergunta antes. Depois de criar, volta à ficha com «Variante {sku} criada.» e, num artigo publicado, «Fica fora das lojas onde o artigo está à venda até a publicação ser refeita.» | a criar; o erro da API ao lado do campo (SKU que já existe, GTIN repetido ou inválido, combinação repetida, valor em falta); a resposta perdida (§24.1); artigo externo, sem permissão ou que não existe (só o aviso, sem formulário) |

### 24.3 O que fica de fora, e porquê

- **Pôr a variante nova à venda pelo Hub**: o Hub ainda não publica; a
  publicação refaz-se pela integração (chave com `catalog:publish`). Desenho
  à parte, com a publicação no Hub.
- **Preço da variante nova**: os preços editam-se noutro ecrã, ainda por
  desenhar (§17 só lê).
- **Criar valores de opção a partir daqui**: faz-se em «Editar opções»
  (§21); o formulário só escolhe entre os que já existem.

### 24.4 Antes de dizer que está feito (o pedido do código)

- **API**: a rota pelo Hub com as mesmas recusas da chave; o armazém e o
  apoio recebem 403; outro comerciante não chega (404, com prova pela
  falha); o artigo externo recusa pelo Hub e aceita pela chave; a linha do
  tempo regista quem criou.
- **Hub**: a passagem acrescenta a `ENS-041-B` ao «Gel Coral 41» publicado
  e confere que nasce fora da publicação; num artigo activo com opções,
  sem valor dá o erro e com a combinação de outra variante também; a
  resposta perdida dá a variante por criada; capturas a 375, 768 e
  1280 px, claro e escuro, e só com teclado; as capturas vão à página de
  aprovação.

## 25. Catálogo: definir e tirar o preço de uma variante numa lista (issue #335)

Pedido do Diogo, 10/10/2026 («avançar», à pergunta *«Avanço com o desenho
de "editar os preços de uma variante" no Hub?»*). **Aprovado pelo Diogo a
10/10/2026**, com a Q1 em «sim» (*«sim»*, à pergunta *«Aprova o desenho, e
com a Q1 em "sim"?»*). A §17 só mostra os
preços. Uma variante acrescentada no Hub (§24) nasce sem preço, e sem preço
na lista base de um mercado o artigo não se publica nesse mercado
(`docs/14` §5, C2). A API pela chave já define e tira preços
(`PUT` e `DELETE /price-lists/{id}/prices/{variante}`, `docs/20` §10). O Hub
ainda não tem as rotas. Skills: `consumer-rights-eu`, `eu-vat-oss-ioss`,
`eu-localization`, `catalog-pim`, `headless-commerce`, `eurolify-design`.

Ex.: na ficha do «Gel Coral 41», a `ENS-041-B` diz «Sem preço nesta lista»
na lista «Base PT» (Portugal, EUR, preços com IVA). A gestora carrega em
«Definir preço», escreve 39,90 e guarda. A ficha volta com «Preço de
ENS-041-B em Base PT guardado.» e mostra 39,90 € e o preço por unidade que
o servidor calculou.

### 25.1 O que entra e o que fica de fora

| Entra |
|---|
| **Definir** o preço de uma variante activa numa lista activa (criá-lo ou mudá-lo): o montante na moeda da lista, «gratuito», a quantidade mínima e o múltiplo |
| **Tirar** o preço de uma variante de uma lista (fica no histórico, com a saída, `docs/20` §3.5) |

| Fica de fora, e porquê |
|---|
| **Anunciar ou tirar uma redução** (o preço riscado): o preço de referência dos 30 dias tem regras ainda **C** (Dir. 98/6/CE, art. 6.º-A; `docs/20` §3.6, à espera do jurista). Passo à parte, se for pedido. |
| **Criar, arquivar ou mudar listas e mercados**: outro ecrã, ainda por desenhar. |
| **Preços de variantes arquivadas**: não se vendem; o botão aparece só nas activas. A API não as recusa, nem pela chave nem pelo Hub (uma variante arquivada pode ter preço, e repô-la volta a vendê-la com ele); é uma escolha do ecrã, não uma regra (revisão do #339, P3-2). |
| **O histórico de cada preço**: como na §17, entra quando houver onde o mostrar. |
| **Mostrar o IVA ou o preço por unidade no formulário**: o servidor calcula; o Hub mostra-os na ficha, depois de gravar (R1, R7; uma regra, um sítio). |
| **Pôr a variante à venda**: com preço, a variante nova continua fora das publicações até a publicação ser refeita (§24.3). |

### 25.2 Como o Hub escreve

| Caminho | Quem | O que faz |
|---|---|---|
| `PUT /hub/price-lists/{id}/prices/{variante}` | a sessão com `prices:write` (o dono e o gestor; `docs/20` §10.1) | a mesma função do `PUT` pela chave (`definirPreco`), com o `eurolify.quem` da pessoa; o corpo é o mesmo (`montante`, `gratuito`, `quantidade_minima`, `multiplo`) e leva também a `versao` lida |
| `DELETE /hub/price-lists/{id}/prices/{variante}` | a mesma | a mesma função do `DELETE` pela chave (`tirarPreco`); a `versao` lida vai no corpo, como nas outras escritas do Hub (§21.2) |

- **O preço lido.** O preço já tem uma `versao` na base (0017: sobe em cada
  escrita), mas a API não a mostrava (`docs/20` §10.1). Todas as respostas
  de preço passam a dá-la, ao lado do `definido_em` que já davam. As
  escritas do Hub mandam o preço **`lido`**: `{versao, definido_em}`, ou
  `null` quando a variante não tinha preço nessa lista. Se o preço guardado
  não for o lido (também ao tirar um preço que já não existe), **409
  `prices.version_conflict`**, sem gravar; a linha fica tomada entre
  conferir e gravar. Sem isto, duas pessoas a mudar o mesmo preço
  apagavam-se uma à outra sem aviso (o histórico guardava as duas, mas o
  ecrã não dizia nada). As rotas pela chave ficam como estão.
  - **Porquê os dois** (revisão do #339, P2-1): quando um preço sai e volta
    a entrar, a `versao` recomeça em 1 (0017); o `definido_em` dessa entrada
    é outro, e os dois juntos não se repetem. Uma migração que mantivesse a
    versão a subir também resolvia, mas o número 0054 já estava em dois
    pedidos abertos.
  - **Com `lido: null`** só se cria: se outra pessoa criou o preço entretanto
    (mesmo ainda por confirmar), 409 em vez de o substituir (revisão do
    #339, P1-1).
- **As regras são as da API e da base, sem cópia no Hub:**
  - o montante em cêntimos, de 0 a 100 000 000 000; 0 só com «gratuito», e
    «gratuito» só com 0 (R4; `prices.free_only_at_zero`);
  - a quantidade mínima e o múltiplo de 1 a 1 000 000;
  - numa lista arquivada não se escreve (`prices.list_archived`);
  - com uma **redução em vigor**, o montante e o «gratuito» não mudam e o
    preço não sai (`prices.reduction_active`); as quantidades mudam;
  - o preço de uma variante **publicada** não sai da lista base do mercado
    (`prices.published_variant`).
- **Só variantes deste comerciante**: uma lista ou variante de outro
  comerciante, ou que não existe, dá 404.
- **O mesmo prazo de espera** das outras escritas do Hub (5 s, depois 503
  `prices.retry`; §24, revisão do #326).
- **Sem `Idempotency-Key`**, como as outras escritas do Hub. Se a resposta se
  perde, o ecrã relê os preços do artigo. Se o preço guardado tem tudo o que
  se enviou (ou, ao tirar, já não há preço), dá-o por gravado. Senão, diz que
  não encontrou a mudança e deixa tentar outra vez.

### 25.3 O ecrã

| Onde | O que muda | Estados além do normal |
|---|---|---|
| **Ficha**, secção «Preços» (§17.3) | Com `prices:write`: em cada variante activa, «Alterar preço» quando tem preço e «Definir preço» quando a lista diz «Sem preço nesta lista». | — |
| **Preço da variante** (`/artigos/{prd_…}/precos/{prl_…}/{var_…}`) | No topo, a variante (SKU) e a lista (nome, mercado, moeda e «preços com IVA» ou «preços sem IVA», como na §17.3). Os campos: **Preço** («Preço com IVA (€)» ou «Preço sem IVA (€)», conforme o mercado), **Gratuito** (uma caixa; marcada, o preço fica 0 e não se escreve), **Quantidade mínima** e **Múltiplo** (1 por omissão). «Guardar», «Cancelar» e, quando há preço, «Tirar o preço desta lista», que pergunta antes. Numa lista base, a pergunta diz: «Sem preço na lista base, o artigo deixa de se poder publicar em {mercado}.» Depois de gravar, volta à ficha com «Preço de {sku} em {lista} guardado.» ou «Preço de {sku} tirado de {lista}.». Sair com o formulário mudado pergunta antes. | a gravar; o erro da API ao lado do campo (montante inválido, gratuito só a 0, quantidades); **com uma redução em vigor**: o preço e «gratuito» só de leitura, com «Este preço tem uma redução em vigor{até}: muda-se quando a redução acabar.» (as quantidades mudam); conflito (409: «Outra pessoa mudou este preço entretanto.», o formulário passa a partir do guardado e fica o que a pessoa escreveu, como a §23); variante publicada (409 ao tirar: «A variante está à venda em {mercado}: o preço não sai da lista base.»); a resposta perdida (§25.2); sem permissão, lista ou variante que não existe (só o aviso, sem formulário) |

- **Escrever o montante.** O campo aceita o preço como se escreve na
  língua do Hub: «39,90» ou «39.90», com as casas da moeda da lista (as do
  `Intl.NumberFormat` para essa moeda; no euro, duas; nas outras moedas da
  UE não verifiquei uma a uma). Não aceita separador de milhares nem sinal. O ecrã
  passa o texto a cêntimos **sem vírgula flutuante** (R2: «39,90» → 3990)
  e mostra-o de volta com `Intl.NumberFormat`. Fora disso, o erro aparece
  ao lado do campo antes de pedir.
- **Os limites copiados no ecrã** (revisão do #341, P3-2): o máximo do
  montante (1 000 000 000,00) e o das quantidades (1 a 1 000 000) também
  se conferem no Hub, e os textos dos erros trazem os números. A API
  recusa-os no esquema do pedido, com um 400 `prices.invalid_field` que não
  diz o campo; sem a cópia, o erro não ficava ao lado dele. Se os limites
  mudarem na API (`PedidoPreco` e `Montante` em `precos/rotas.ts`), mudam
  aqui também (`apps/hub/src/preco.ts`).
- **Um 409 mostra sempre o conflito** (revisão do #341, P3-1): mesmo que o
  preço guardado agora seja igual ao que se escreveu, foi outra pessoa a
  gravá-lo. Só a resposta perdida se dá por gravada ao reler (§25.2).
- **O IVA.** O Hub não calcula nem tira IVA. O rótulo diz se o montante
  inclui IVA, porque é isso que o mercado guarda (`preco_inclui_iva`). O
  preço que o cliente vê com o IVA do país sai do Motor de IVA (`docs/24`).

### 25.4 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Um preço a 0,00 € por engano | a base recusa 0 sem «gratuito» (R4); o ecrã só manda 0 com a caixa marcada |
| «39,90» lido como 3990,00 € ou 39,9 lido como 39,09 € | a conversão é por texto, com no máximo as casas da moeda, e tem testes de unidade com os casos («39,9» → 3990; «39,905» recusado; «1.234,50» recusado) |
| Duas pessoas mudam o mesmo preço | a versão (§25.2): a segunda recebe 409 |
| Tirar o preço da lista base de um artigo à venda | a base recusa (`prices.published_variant`); a pergunta antes avisa o que acontece nos outros casos |
| Uma chave ou um papel sem `prices:write` muda preços | a rota confere o âmbito da sessão; o armazém e o apoio recebem 403 (teste) |

### 25.5 Decidido

**Q1. Num artigo que vem do sistema de gestão (P5), os preços editam-se no
Hub?** ✅ **Decidido: sim** (Diogo, 10/10/2026, *«sim»*). A decisão da §13.3 lista só os dados do artigo e das variantes; os
preços não estão nela. Editam-se, como as imagens. Os preços são do
domínio de Preços e não dos dados que vêm de lá. Se o sistema de gestão
também mandar preços pela chave, vale o último a gravar, e o histórico diz
quem foi (`definido_por`).

### 25.6 Antes de dizer que está feito (o pedido do código)

- **API**: as rotas pelo Hub fazem o mesmo que as da chave; a versão na
  leitura, e 409 com outra versão (também `null` quando já há preço);
  o armazém e o apoio recebem 403; outro comerciante não chega (404, com
  prova pela falha); a redução em vigor, a lista arquivada e a variante
  publicada são recusadas; `definido_por` é a pessoa; o prazo de espera.
- **Hub**: a passagem define o preço da `ENS-041-B` na «Base PT» só com o
  teclado, muda-o, recebe o conflito, tira-o de uma lista B2B, é recusada a
  tirar o de uma variante publicada da lista base, e vê o formulário com
  uma redução em vigor; a resposta perdida; capturas a 375, 768 e 1280 px,
  claro e escuro, para a página de aprovação.

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

## 26. O rasto de auditoria no Hub: as seis respostas (issue #322, passo 4, parte 5)

Pedido do Diogo, 11/10/2026: *«avança com o desenho do ecrã do Hub»*. O
rasto já responde às seis perguntas na API (`docs/28` §1; decisões DK e DO,
Q5 a Q8; #342, #345, #349, #351, #354); o Hub ainda só mostra quem, quando e
o antes → depois (§16). Este passo **só lê** no histórico; no ecrã das chaves
acrescenta uma escolha ao criar. Skills: `eurolify-design`,
`eurolify-hub-modular`, `eurolify-hub-quality-gate`, `eu-gdpr-privacy`,
`observability-security`.

Ex.: na ficha do «Verniz Gel Vermelho 15 ml», o dono abre «Histórico» e vê,
por baixo de «Hoje, 03:00 — Chave «Preços» alterou o artigo», a linha
**«Pela API · Agente de IA (declarado: anthropic, claude-x) · ⚠ Sem
autorização de uma pessoa»**. Numa conclusão automática: «Automático, a
pedido de Chave «Preços» · ⚠ Sem autorização de uma pessoa». Numa alteração
do próprio dono no Hub: «No Hub · Autorizado por Ana Teste».

### 26.1 O que entra e o que fica de fora

| Entra | Onde | Rota da API |
|---|---|---|
| Em cada alteração do histórico do artigo, **uma linha de contexto** por baixo de quem e quando: de onde veio, a IA (só quando declarada ou comprovada), quem autorizou ou o aviso, e o motivo quando há | Histórico do artigo (§16.3) | `GET /hub/products/{id}/timeline`, que já traz `canal`, `pedido`, `ia`, `autorizado_por`, `motivo`, `tipo_de_autor`, `a_pedido_de`, `a_pedido_de_tipo` e `sem_autorizacao_de_pessoa` |
| **O nome** de quem autorizou e de quem pediu uma tarefa | o mesmo | a mesma: a API do Hub junta `autor_autorizou` e `autor_do_pedido`, decididos no servidor como o `autor` de hoje (§16.2) |
| **«Detalhes»** de cada alteração (um `<details>`, fechado): o n.º do pedido, a execução da IA e a IA «desconhecida» quando nada a indica | o mesmo | a mesma |
| Ao **criar uma chave**, a caixa «Chave de um agente de IA», com a explicação; na lista, a etiqueta «Agente de IA» | Chaves (§9.3) | `POST /hub/keys` e `GET /hub/keys`, que já aceitam e devolvem `agente_ia` (#342) |
| Os nomes dos âmbitos `prices:*` no ecrã das chaves (hoje saem vazios; revisão do #349, P3-5) | Chaves | — |

| Fica de fora, e porquê |
|---|
| O histórico dos **clientes, encomendas, pagamentos, documentos e preços** no Hub: a API já os dá com as seis respostas, mas o Hub ainda não tem esses ecrãs. Entram com eles. |
| **Filtrar** por «sem autorização de uma pessoa»: entra quando o histórico for longo o bastante (como os outros filtros, §16.1). |
| **Autorizar** a posteriori uma alteração feita sem autorização: seria uma escrita nova, com regras próprias (Q3: exigir passa a ser uma regra por âmbito, decidida depois). |
| O `autor.tipo` antigo (obsoleto desde o #349): o ecrã passa a usar `tipo_de_autor`; o campo saiu da API a 11/10/2026, no pedido dos pendentes do #322, quando nada o lia. |

### 26.2 A linha de contexto: o que diz, em linguagem comum

Uma linha, por esta ordem, com as partes separadas por « · ». O texto vem do
que o servidor decidiu (uma regra, um sítio): o ecrã não recalcula nada.

| Parte | Valor da API | O ecrã diz |
|---|---|---|
| De onde | `canal` | `hub` «No Hub»; `api` «Pela API»; `importacao` «Pela importação»; `sistema` «Automático»; `operador` «Pelo operador»; `integracao` «Por uma integração»; `mcp` «Por um assistente (MCP)»; vazio «Origem desconhecida» |
| A pedido de (só nas tarefas) | `a_pedido_de`, `autor_do_pedido` | «a pedido de {nome}» (o nome como no §16.2); sem pedido de origem: «sem pedido de origem registado» |
| IA | `ia.prova` | `declarado`: «Agente de IA (declarado{: fornecedor, modelo})»; `comprovado`: «IA (comprovado: …)»; `desconhecido`: **nada na linha**, e «IA: desconhecida» nos Detalhes |
| Autorização | `sem_autorizacao_de_pessoa`, `autor_autorizou` | `false`: «Autorizado por {nome}»; `true`: **«⚠ Sem autorização de uma pessoa»** (cor `--estado-aviso` e o ícone, nunca só a cor); `null`: «Autorização desconhecida» |
| Motivo | `motivo` | «Motivo: {texto}», como texto (nunca HTML), com «Ver tudo» acima de 160 caracteres (como §16.4) |

**Nos Detalhes:** «Pedido n.º {pedido}» (para o apoio cruzar com os registos
do servidor), «Execução: {execucao}» quando vier, «IA: desconhecida» quando
nada a indica, e «a pedido de: pedido n.º {a_pedido_de.pedido}» nas tarefas.

**A junção por alteração** (§16.4) junta entradas com a mesma `transacao`:
têm sempre o mesmo contexto (é o da transacção), e a linha mostra-se uma vez
por bloco.

### 26.3 As chaves: a marca «agente de IA»

| Ecrã | O que muda |
|---|---|
| **Criar chave** (§9.3) | Por baixo dos âmbitos, a caixa «Chave de um agente de IA» (desmarcada), com a ajuda: «Tudo o que esta chave fizer fica no histórico como feito por uma IA, mesmo que o agente não o diga. Não se muda depois de criada.» Só na chave de servidor (a pública não existe no Hub hoje). |
| **Lista de chaves** | A etiqueta «Agente de IA» ao lado do nome. |
| **Âmbitos** | Os nomes de `prices:read` («Ver preços»), `prices:write` («Mudar preços») e `prices:history` («Ver quem mudou os preços»). |

### 26.4 Estados e permissões

- Os do §16.3 continuam (a carregar, vazio, 404, 403, erro ao pedir mais,
  sessão terminada).
- **Uma linha antiga** (de antes de 10/10/2026): «Origem desconhecida ·
  Autorização desconhecida» — nunca «sem autorização» (Q8).
- **Os nomes** de quem autorizou e de quem pediu seguem a regra do §16.2:
  só os de quem é ou foi da equipa, ou das chaves deste comerciante; «Pessoa
  pseudonimizada» depois de pseudonimizada; os outros, sem nome.
- Só o dono e o gestor (`catalog:history`) vêem o histórico, como hoje.

### 26.5 Antes de dizer que está feito (o pedido do código)

- **API**: `autor_autorizou` e `autor_do_pedido` com a regra do §16.2 (de
  fora da equipa: sem nome; pseudonimizada; chave de outro comerciante: sem
  nome), `no-store`, o contrato; a prova pela falha.
- **Hub**: textos em PT, ES e EN, no masculino universal; o aviso com ícone e
  texto, não só cor, e contraste ≥ 4,5:1 em claro e escuro; a passagem no
  navegador com um artigo mudado no Hub, por uma chave de um agente e por uma
  importação, e uma conclusão automática; «Detalhes» com o teclado; capturas
  a 375, 768 e 1280 px, claro e escuro, para o OK do aspecto pelo Diogo
  (regra 1 da `eurolify-design`).

## 27. Catálogo: publicar um artigo pelo Hub (issue #378)

Pedido do Diogo, 12/10/2026 («aprovado», à pergunta *«Avanço com o
desenho de "publicar um artigo pelo Hub"?»*). **Aprovado pelo Diogo a
12/10/2026**, com a Q1 em «não vêm marcadas» (*«aprovado»*, à pergunta
*«Aprova o desenho, com a Q1 em "não vêm marcadas"?»*). No Hub já se cria um artigo,
se acrescentam e editam variantes e se definem os preços (§14, §23, §24,
§25), mas nada se põe à venda: a publicação só se faz pela integração, com
uma chave com `catalog:publish` (`docs/14` §7.1). Uma variante acrescentada
a um artigo publicado fica fora das lojas até a publicação ser refeita
(§24.1). Skills: `catalog-pim`, `consumer-rights-eu`,
`product-compliance-eu`, `headless-commerce`, `eurolify-design`,
`observability-security`.

Ex.: na ficha do «Gel Coral 41», a publicação «Loja online · Portugal»
está publicada com a `ENS-041` e a `ENS-041-B` fora (acabada de
acrescentar, já com preço). A gestora carrega em «Rever a publicação»,
marca a `ENS-041-B`, vê «Pode publicar» e carrega em «Publicar». A ficha
volta com «Publicado em Loja online · Portugal.» e a `ENS-041-B` à venda.

### 27.1 O que entra e o que fica de fora

| Entra |
|---|
| **Publicar** num canal × mercado onde o canal vende: a primeira vez, outra vez depois de retirada, ou **refazer** uma publicada para mudar as variantes à venda |
| **Escolher as variantes à venda** (as outras ficam em `variantes_fora`; tirar uma não retira o artigo, `catalog-pim`, regra 6) |
| **Ver antes** se pode publicar: a verificação do servidor (C2), com os impedimentos em linguagem comum |
| **Retirar** uma publicação publicada (fica arquivada, motivo «retirada») |

| Fica de fora, e porquê |
|---|
| **Criar canais, mercados ou ligar um canal a um mercado**: são de Preços e mercados; outro ecrã, ainda por desenhar. O Hub só oferece os pares que já existem. |
| **Resolver os impedimentos a partir daqui**: cada um leva ao ecrã onde se resolve (o preço, §25; o peso, §23; o texto alternativo, §15), mas o ecrã da publicação não os edita. |
| **A Conformidade** (atributos obrigatórios por mercado): ainda não existe; a resposta diz sempre `nao_verificado: [conformidade]`, e o ecrã diz que **não foi verificada** — nunca «conforme» (`docs/14` §5, C2, rede temporária CF). |
| **Publicar vários artigos de uma vez**: nunca em lote sem rever cada um (`AGENTS.md`, «Não se erra»). |

### 27.2 Como o Hub escreve

| Caminho | Quem | O que faz |
|---|---|---|
| `GET /hub/sales-pairs` | a sessão com `catalog:read` (os quatro papéis) | os pares canal × mercado do comerciante onde o canal vende, com o nome e o estado do canal, do mercado e da loja (a mesma leitura dos nomes da §18.1 e §19.1) |
| `POST /hub/products/{id}/publications/check` | a mesma | a mesma função do `POST /products/{id}/publications/check` pela chave: a verificação (C2) com as variantes escolhidas, sem escrever |
| `POST /hub/products/{id}/publications` | a sessão com `catalog:publish` (o dono e o gestor) | a mesma função do `POST /products/{id}/publications` (`publicar`), com o `eurolify.quem` da pessoa; o corpo é o da chave (canal, mercado, `variantes_fora`) mais a **`versao` lida** da publicação (`null` quando ainda não existe nesse par) e as **`variantes_vistas`** (as activas que o ecrã mostrou) |
| `POST /hub/publications/{id}/archive` | a mesma | a mesma função do `POST /publications/{id}/archive` (`retirarPublicacao`), com a `versao` lida no corpo |

- **A versão.** A publicação já tem `versao` na base (0019) e a API já a
  mostra. As escritas do Hub mandam a lida; outra guardada (alguém publicou,
  retirou ou mudou as variantes entretanto, ou a reverificação a arquivou)
  dá **409 `catalog.version_conflict`**, sem escrever. A conferência faz-se
  **dentro de `publicar`**, depois de a linha da publicação estar tomada
  (a ordem dos bloqueios de hoje não muda, `docs/14` §3.9). As rotas pela
  chave ficam como estão.
- **As variantes vistas** (13/10/2026, o que ficou da revisão do #421). Uma
  variante criada com o ecrã aberto, num par sem publicação à venda, não
  muda a versão (só a publicada a recebe em `variantes_fora`), e entrava no
  que se publica sem a pessoa a ver. O corpo leva as activas que o ecrã
  mostrou; uma activa do artigo que não esteja lá dá **409
  `catalog.version_conflict`**, sem escrever, e o ecrã relê (a nova vem por
  marcar e diz «nova», também num par sem publicação; revisão do #436, P2). Confere-se dentro de `publicar`, depois da fila do artigo, onde
  entra quem cria uma variante. Uma vista que entretanto foi arquivada não
  impede.
- **As regras são as do Catálogo, sem cópia no Hub**: a verificação (C2) é
  do servidor; com impedimentos, nada muda além da verificação guardada e a
  resposta diz `publicada: false` com a lista (o ecrã lê sempre
  `publicada`, nunca só o estado HTTP); a base repete o preço, o peso e a
  variante à venda no instante de publicar.
- **Artigo do sistema de gestão**: publica-se no Hub, como decidido na
  §13.3 («a publicação edita-se no Eurolify»).
- **O mesmo prazo de espera** das outras escritas do Hub (5 s, depois 503
  `catalog.retry`).
- **Sem `Idempotency-Key`**, como as outras escritas do Hub. Se a resposta
  se perde, o ecrã relê as publicações do artigo: se a do par estiver no
  estado pedido, com as variantes pedidas e outra versão, dá-a por feita;
  senão, diz que não encontrou a mudança.

### 27.3 O ecrã

| Onde | O que muda | Estados além do normal |
|---|---|---|
| **Ficha**, secção «Publicações» (§12.2, §18, §19) | Com `catalog:publish`: em cada publicação, «Rever a publicação» (rascunho, publicada ou arquivada) e, numa publicada, «Retirar», que pergunta antes («Retirar o Gel Coral 41 de Loja online · Portugal? Deixa de estar à venda nesta loja.»). Por baixo da tabela, «Publicar noutra loja» quando há pares sem publicação. Uma publicada com variantes fora diz quantas: «1 variante fora». | — |
| **Publicação** (`/artigos/{prd_…}/publicacoes/{chn_…}/{mkt_…}`) | No topo, o canal, o mercado (com a loja quando o nome se repete, §19.2) e o estado. **As variantes**: uma caixa por variante activa, marcada se está à venda; as que estão fora dizem «fora», e uma nova diz «nova» (§27.5). **«Verificar»** pede a verificação com as escolhidas e mostra o resultado: «Pode publicar» ou a lista dos impedimentos, cada um com a frase e a ligação para onde se resolve; sempre com «A conformidade do produto ainda não é verificada.». **«Publicar»** (ou «Publicar outra vez» numa publicada) só depois de uma verificação sem impedimentos com as mesmas escolhidas; mudar uma escolha pede outra verificação. Depois de publicar, volta à ficha com «Publicado em {canal} · {mercado}.» | a verificar; a publicar; impedimentos (a lista; o botão «Publicar» não aparece); um impedimento novo no instante de publicar (`publicada: false`: a lista nova, nada mudou); conflito (409: «Outra pessoa mudou esta publicação ou as variantes do artigo entretanto.», com o estado e as variantes de agora; as escolhas da pessoa ficam); a resposta perdida (§27.2); sem permissão (só o aviso, sem acções); par que não existe ou em que o canal deixou de vender (só o aviso) |
| **Publicar noutra loja** (na ficha) | Uma lista dos pares sem publicação («Loja online · Espanha»); escolher um abre a página da publicação desse par, sem nada escolhido à partida (todas as variantes activas marcadas). | sem pares: a ligação não aparece |

**Os impedimentos em linguagem comum** (os códigos da API, `docs/14` §5;
em pt, es e en), cada um com a ligação para onde se resolve quando o Hub já
o resolve:

| Código | Texto | Leva a |
|---|---|---|
| `artigo_nao_activo` | O artigo não está activo. | a ficha (activar, §13) |
| `mercado_inactivo`, `canal_inactivo`, `canal_nao_vende_no_mercado` | O mercado (ou o canal) não está activo, ou o canal deixou de vender neste mercado. | — (Preços e mercados) |
| `sem_variantes_a_venda` | Escolha pelo menos uma variante. | — |
| `categoria_fiscal_em_falta` | Falta a categoria fiscal do artigo. | editar o artigo (§13) |
| `peso_em_falta` | Falta o peso de {SKU}. | editar a variante (§23) |
| `preco_em_falta` | {SKU} não tem preço na lista base de {mercado}. | o preço (§25) |
| `traducao_em_falta`, `traducao_desactualizada` | Falta (ou está desactualizada) a tradução do nome em {línguas}. | — (as traduções ainda não se editam no Hub) |
| `classificacao_em_falta`, `natureza_incompativel`, `familia_restrita`, `data_ou_local_em_falta` | O texto do código, sem ligação (a classificação tem desenho à parte, §13.1). | — |
| `texto_alternativo_em_falta` | Há imagens sem texto alternativo. | a ficha, nas imagens (§15) |

### 27.4 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| Pôr à venda o que não se reviu (uma variante nova sem fotografia, por exemplo) | as variantes escolhem-se uma a uma; as que estão fora não vêm marcadas (§27.5) |
| Publicar com uma verificação antiga | o botão só aparece depois de verificar com as mesmas escolhidas, e o servidor verifica outra vez no instante de publicar (`publicada: false` se algo mudou) |
| Ler «sem impedimentos» como «conforme» | o ecrã diz sempre que a conformidade não foi verificada (C2, CF) |
| Duas pessoas a publicar ou retirar a mesma publicação | a versão (§27.2): a segunda recebe 409 |
| O armazém ou o apoio põem à venda | a rota confere `catalog:publish`; o ecrã nem mostra as acções |

### 27.5 Decidido

**Q1. Ao rever uma publicação publicada, as variantes que estão fora vêm
marcadas para entrar?** Ex.: a `ENS-041-B`, acabada de acrescentar.
✅ **Numa publicação que não está à venda** (arquivada ou em rascunho), **nenhuma vem marcada** (Diogo, 13/10/2026, *«A»*; revisão do #421, P2-2).

✅ **Decidido: não** (Diogo, 12/10/2026, *«aprovado»*). Ficam como estão, com a marca «nova» (a que nasceu fora
por ter sido acrescentada depois de publicar) ou «fora» (a que alguém tirou),
e a pessoa marca as que quer pôr à venda. Assim nada entra numa loja sem
alguém o escolher. A alternativa (vir marcadas) poupa um clique, mas põe à
venda, por omissão, uma variante que pode ainda não estar pronta.

### 27.6 Antes de dizer que está feito (o pedido do código)

- **API**: as rotas pelo Hub fazem o mesmo que as da chave; a versão (409
  também com `null` quando a publicação já existe); o armazém e o apoio
  recebem 403 ao publicar e ao retirar; outro comerciante não chega (404,
  com prova pela falha); `publicada: false` com impedimentos, sem mudar o
  estado nem as variantes; `publicado_por` e `arquivado_por` são a pessoa;
  o prazo de espera.
- **Hub**: a passagem refaz a publicação do «Gel Coral 41» com a
  `ENS-041-B` só com o teclado; vê os impedimentos de outro artigo (peso e
  preço em falta, com as ligações); publica noutro par; retira com a
  pergunta; recebe o conflito; a resposta perdida; o papel sem
  `catalog:publish`; capturas a 375, 768 e 1280 px, claro e escuro, para a
  página de aprovação.

### 27.7 Em código (13/10/2026; pedido #421)

| O quê | Onde |
|---|---|
| `GET /hub/sales-pairs`: os pares canal × mercado onde o canal vende, com os nomes e os estados do canal, do mercado e da loja (`catalog:read`) | `paresDeVenda` (`src/precos/repositorio.ts`); `src/identidade/hub-catalogo.ts` |
| `POST /hub/products/{id}/publications/check`: a mesma `verificarPublicacao` da chave (`catalog:read`) | `src/identidade/hub-catalogo.ts` |
| `POST /hub/products/{id}/publications` e `POST /hub/publications/{id}/archive`: o mesmo `publicar` e `retirarPublicacao` da chave, com `catalog:publish`, a pessoa como «quem» e o prazo de espera do `escreverNoHub` (que passou a receber o âmbito) | `src/identidade/hub-catalogo.ts` |
| a `versao` lida, dentro de `publicar` e de `retirarPublicacao`, com a linha já tomada: `null` só numa publicação que nasce no pedido; um número só se é o guardado e a publicação já existia; outra dá 409 `catalog.version_conflict` e a transacção desfaz o rascunho. As rotas pela chave não a mandam e ficam como estavam | `src/catalogo/publicacao.ts` |
| 8 testes pela API: os pares (e outro comerciante não os vê); verificar, publicar com `null`, refazer na versão lida e retirar, com `publicado_por` e `arquivado_por` da pessoa; os três conflitos de versão sem escrever; `publicada: false` sem mudar o estado nem as variantes; o armazém e o apoio verificam mas recebem 403 ao publicar e retirar, e o gestor retira; outro comerciante dá 404, com prova pela falha; o prazo de espera (503 `catalog.retry` com a publicação presa); duas publicações ao mesmo tempo sobre a mesma versão (uma 200, a outra 409) | `test/hub-publicar.test.ts` |
| o ecrã da publicação (`/artigos/{prd_…}/publicacoes/{chn_…}/{mkt_…}`): as variantes, «Verificar», «Publicar» só depois de uma verificação sem impedimentos com as mesmas escolhas (o foco vai para o botão; com impedimentos fica no resultado), o 409, a resposta perdida (só dá por feito com o estado, as variantes, outra versão **e** a última verificação sem impedimentos), `publicada: false` | `apps/hub/src/ecras/PublicarArtigo.tsx`; a lógica em `apps/hub/src/publicar.ts` |
| na ficha, secção «Publicações»: «Rever a publicação», «Retirar» com a pergunta (o 409 e a transição inválida recarregam com «Outra pessoa mudou…»; a resposta perdida diz que não encontrou a mudança), «N variantes fora», «Publicar noutra loja» só com pares de canal e mercado activos | `apps/hub/src/ecras/Artigo.tsx` |
| os textos dos impedimentos em pt, es e en, com a ligação para onde se resolve (a ficha, editar o artigo, editar a variante, o preço na lista base) | `apps/hub/src/textos/` |
| testes da lógica do ecrã (escolha inicial, «Publicar», pares, impedimentos, resposta perdida) e a passagem no navegador com as capturas a 375, 768 e 1280 px, claro e escuro | `apps/hub/test/publicar.test.ts`; `apps/hub/scripts/capturas.mjs` |

✅ **Aspecto e os quatro textos novos dos impedimentos aprovados** (Diogo, 13/10/2026, *«A»*), pelas capturas de 1280 px claro e 375 px escuro.

**Desvios do desenho:**
- **A marca «nova»** (pedido #427): numa publicada, a variante que está fora e nasceu depois de a publicação entrar em venda (`criado_em` da variante depois de `publicado_em`) diz «nova»; a outra que está fora diz «fora». Numa que não está à venda, só «fora». O `publicado_em` só muda quando a publicação passa a publicada, não ao publicar outra vez: uma variante nova deixada de fora ao refazer continua «nova». Se a variante nascer enquanto outra transacção publica, pode dizer «fora» em vez de «nova» (as duas datas vêm de relógios diferentes da base); fica sempre por marcar (revisão do #427).
- **Numa publicação que não está à venda** (arquivada ou em rascunho), **nenhuma variante vem marcada** (Diogo, 13/10/2026: *«A»*; `docs/06`, EJ): a base só põe fora a variante acrescentada a uma publicação publicada, e assim nada volta à venda sem ser escolhido (revisão do #421, P2-2).
- **«Retirar» pergunta com a caixa do navegador** (`window.confirm`), como as outras perguntas da ficha.
- **Os textos de `classificacao_em_falta`, `natureza_incompativel`, `familia_restrita` e `data_ou_local_em_falta`** foram escritos aqui (a §27.3 dizia «o texto do código»); a família mostra o código interno.
- **Fica** (revisão do #421): ~~uma variante criada enquanto o ecrã está aberto, num par sem publicação publicada, entra no que se publica se a pessoa não recarregar~~ — tratado a 13/10/2026 com as `variantes_vistas` (§27.2); o aviso «Publicado em…» na ficha vem do endereço, como o «Alterações guardadas»; nenhum papel de hoje tem `catalog:write` sem `catalog:publish`, por isso o teste dos papéis não distingue os dois.

## 28. O ecrã «A decidir» (issue #366, parte 2)

Pedido do Diogo, 12/10/2026 (*«avança com o próximo pendente»*). **Aprovado pelo Diogo a 12/10/2026**, com a Q1 em A (*«A, aprovado»*). A peça 21
(`docs/33`, decisão DW) já tem a API: a lista `GET /tasks`, atribuir e
mudar o prazo, o aviso de vencido de hora a hora e, desde a migração 0071,
o e-mail desse aviso (`docs/34` §12, EB). Mas só por chave. O `docs/33` §8
pede o ecrã, desenhado primeiro, com as skills `eurolify-design`,
`eurolify-hub-modular` e `eurolify-hub-quality-gate`. Este é esse desenho.
Skills: as três, mais `observability-security` (as permissões pelo papel) e
`platform-architect` (a tarefa não decide).

Ex.: a gestora abre «A decidir», carrega em «Vencidas» e vê, primeiro,
«Diferença de pagamento · pdi_…0190 · motivo: incerto · há 2 dias · sem
responsável · prazo 11/10 às 14:00 · vencida». Carrega em «Ficar com o
caso». A linha passa a dizer «Responsável: eu» e a lista mantém-se na mesma
página.

### 28.1 O que entra e o que fica de fora

| Entra |
|---|
| **A lista** dos casos abertos das filas que o papel lê, do prazo mais próximo ao mais longe, com o total por fila, a dizer de que filas são («Vê 5 das 7 filas») |
| **Os filtros** «Todos», «Os meus», «Sem responsável» e «Vencidas», e a fila |
| **Ficar com o caso** (atribuir-se), **atribuir a outra pessoa**, **tirar o responsável** e **mudar o prazo**, com a versão lida |
| **O histórico** das atribuições do caso (quem o teve, os prazos, os motivos), a abrir na linha |
| Um **módulo novo** na entrada, «A decidir», para quem lê pelo menos uma fila |

| Fica de fora, e porquê |
|---|
| **Decidir o caso a partir daqui.** A tarefa diz quem decide e até quando, nunca decide (`docs/33` R1). Cada caso decide-se no ecrã da fila dele, e **nenhuma das sete filas tem ecrã no Hub** (`docs/33` §2; procurei `/withdrawals`, `/problems`, `/refunds`, `/invoices` e `payment-issues` em `apps/hub/src` a 12/10/2026, sem resultados). Por isso a linha mostra o identificador do caso e da encomenda, sem ligação, até cada fila ter o seu ecrã (Q1). |
| **Atribuir vários casos de uma vez.** Nunca em lote (`AGENTS.md`, «Não se erra», regra 5). |
| **Guardar filtros por pessoa** e escolher colunas: o `docs/hub-modular-glassmorphism.md` não deixa guardar nada no navegador sem desenho aprovado. Fica para quando houver preferências no servidor. |
| **Notificações dentro do Hub.** O aviso de vencido sai por e-mail (`docs/34` §12) e aparece na lista como «vencida». |

### 28.2 Como o Hub lê e escreve

As rotas pelo Hub fazem **o mesmo** que as da chave (`apps/api/src/tarefas/rotas.ts`), com a sessão em vez da chave, como em Vendas (`/hub/sales/summary`, `docs/35`).

| Caminho | Quem | O que faz |
|---|---|---|
| `GET /hub/tasks?fila=&responsavel=eu\|sem&vencida=&limite=&cursor=` (o comerciante no cabeçalho `Eurolify-Comerciante`, como nas outras rotas do Hub) | a sessão do comerciante; as filas são as que o **papel** lê (R2, pelos `ambitos` da sessão) | a lista e os totais de `listarTarefas`. **`responsavel=eu`** existe aqui, porque a sessão é uma pessoa (`docs/33` §7 deixou-o para o ecrã). Sem nenhuma fila, 403 `tasks.forbidden` |
| `GET /hub/tasks/{fila}/{caso}` | o `read` da fila no papel | o caso e o histórico das atribuições |
| `POST /hub/tasks/{fila}/{caso}/assign` `{ responsavel: per_… \| null, versao }` | atribuir-se: o âmbito de decidir a fila no papel; outra pessoa ou `null`: também `tasks:assign` (R3) | a mesma função `tarefas_atribuir`, com o `eurolify.quem` da pessoa; a base confere quem pode ser responsável |
| `POST /hub/tasks/{fila}/{caso}/deadline` `{ prazo, motivo, versao }` | decidir a fila e `tasks:assign` | a mesma função `tarefas_mudar_prazo`; o prazo nunca no passado nem depois do prazo legal (R5) |

- **Os nomes das pessoas** lêem-se do `GET /hub/members` (já existe, todos os membros o lêem). A lista de tarefas só traz `per_…`.
- **Quem pode ser escolhido** em «Atribuir a…»: os membros cujo papel decide a fila. A régua vive na base (`tarefas_pode_decidir`). Para o ecrã não oferecer o que a API recusa, a rota `GET /hub/tasks/{fila}/{caso}` devolve também `pode_ser_responsavel: [per_…]`, calculado pela base. Assim o ecrã não guarda nenhuma cópia da régua (`eurolify-design`, regra 8; ao contrário do `papeis.ts` dos convites, que é uma cópia).
- **A versão.** As escritas mandam a lida. Outra guardada dá **409 `tasks.version_conflict`** e o ecrã relê a linha.
- **O mesmo prazo de espera** das outras escritas do Hub (5 s, depois 503 `tasks.retry`). **Sem `Idempotency-Key`**, como as outras escritas do Hub. Se a resposta se perde, o ecrã relê o caso: com o responsável ou o prazo pedidos e outra versão, dá-o por feito; senão, diz que não encontrou a mudança.

### 28.3 O ecrã

| Onde | O que mostra | Estados além do normal |
|---|---|---|
| **Entrada** (`/`) | Um módulo «A decidir» na grelha, para quem lê pelo menos uma fila: os quatro papéis de hoje (`papel_ambitos`, migração 0068). O dono, o gestor e o apoio lêem as sete filas. O armazém lê as três com `returns:read`: o prazo do reembolso, a livre resolução e o problema. O registo dos módulos (`modulos.ts`) passa a aceitar «um destes âmbitos». | — |
| **A decidir** (`/a-decidir?comerciante=…`) | No topo, os filtros «Todos · Os meus · Sem responsável · Vencidas» (um grupo de botões de alternância, com o seleccionado marcado também por texto e não só por cor), a fila (uma lista de escolha) e «Vê 5 das 7 filas», quando o papel não lê todas. Depois, a contagem («12 casos; 3 vencidos») e a lista: **tabela** a partir de 768 px, **cartões** abaixo (regra 5). Cada linha: a fila pelo nome; o caso (`pdi_…`, os últimos 4 algarismos à vista e o resto ao copiar); a encomenda, se houver; o motivo em linguagem comum; há quanto tempo está na fila; o responsável (o nome, ou «eu», ou «sem responsável»); o prazo, com a data e a hora no fuso do comerciante, e a etiqueta «vencida» (token de estado único, regra 3, com texto). Os botões da linha, conforme o papel: «Ficar com o caso», «Atribuir…», «Mudar o prazo…» e «Histórico». No fim, «Ver mais» (cursor; nunca corta em silêncio, R10). | a carregar; erro com «Tentar outra vez»; vazio por filtro («Nada vencido.»; «Não tem casos.»); vazio total («Nada por decidir.»); sem nenhuma fila (só o aviso, como acontece com `tasks.forbidden`); comerciante errado ou que mudou entretanto (como nas outras páginas; `docs/hub-modular-glassmorphism.md`, «Contexto do comerciante») |
| **Atribuir…** (um diálogo) | As pessoas que `pode_ser_responsavel` devolve, com o nome e o papel, e «Sem responsável». Confirmar grava; a linha actualiza. | conflito (409: «Outra pessoa mudou este caso entretanto.», com o responsável e o prazo de agora); `tasks.assignee_not_allowed` (a pessoa mudou de papel entretanto: relê a lista); sem `tasks:assign` (só «Ficar com o caso») |
| **Mudar o prazo…** (um diálogo) | A data e a hora, no fuso do comerciante (dito ao lado: «Hora de Lisboa»), e o **motivo**, obrigatório, com a frase «Não escreva dados de clientes neste motivo.» (`docs/33` §6). Onde há prazo legal: «Não pode passar de {data}.», e o campo não deixa escolher depois. | `tasks.deadline_invalid` (no passado, ou depois do prazo legal: a frase da API em linguagem comum); `tasks.reason_required`; conflito |
| **Histórico** (abre por baixo da linha) | Cada mudança: quando, quem (o nome, ou «sistema» no aviso de vencido), o que mudou (o responsável de → para; o prazo de → para) e o motivo. | a carregar; erro |

**Os motivos em linguagem comum** (pt, es e en): o código de cada fila vem do domínio dela (`docs/33` §4.1). O texto escreve-se para os códigos de hoje: as diferenças de pagamento (`0044`), os motivos de um documento retido (`docs/29`), os sinais de um duplicado (só o tipo, nunca o valor, `0046` R12), o estado do pedido de livre resolução, o tipo do problema e o estado do reembolso. Um código sem texto mostra-se como está, nunca se esconde. Vários códigos (um documento com dois motivos) mostram-se todos.

### 28.4 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| O ecrã mostrar casos de uma fila que o papel não lê | a rota filtra pelos âmbitos da sessão, como a da chave (R2); o ecrã não filtra nada sozinho |
| O armazém atribuir a outra pessoa ou mudar o prazo | a rota pede `tasks:assign`; o ecrã nem mostra os botões; a base confere quem pode ser responsável |
| Duas pessoas ao mesmo tempo no mesmo caso | a versão (409) e o tranco do caso na base (`docs/33` R7) |
| Ler «a tarefa está feita» numa atribuição | não há «marcar como feita» (R1): o caso sai da lista quando a fila o decide |
| Um motivo de mudança de prazo com dados de clientes | a frase no campo; o motivo nunca vai no e-mail (`docs/34` §12, T4); o motivo limpa-se no apagamento do titular desde 14/10/2026 (migração 0102, `docs/33` §6) |
| A lista parecer vazia por estar cortada | o total por fila e «Ver mais» (R10) |
| Uma pessoa pensar que o identificador sem ligação é um erro | a linha diz «Este caso ainda não tem ecrã no Hub; decide-se pela integração.» uma vez por cima da lista, enquanto nenhuma fila tiver ecrã (Q1) |

### 28.5 Decidido

✅ **Q1: A** (Diogo, 12/10/2026, *«A, aprovado»*). Desenho aprovado.

✅ **Aspecto aprovado** (Diogo, 13/10/2026, *«A, aprovado»*), pelas capturas da versão publicada (#396 e #399): 1280 px em claro, 375 px em escuro e a entrada com o módulo. Não visto no Safari nem num telemóvel real.

**Q1.** Nenhuma das sete filas tem ecrã no Hub. A lista «A decidir» avança
já, **sem ligação ao caso** (mostra o identificador do caso e da encomenda,
e diz que se decide pela integração), ou espera que as filas tenham os seus
ecrãs? Ex.: uma diferença de pagamento aparece como «pdi_…0190», sem nada
onde carregar para a resolver.
- **A (proposta):** avança já. Atribuir e mudar prazos no Hub tem valor
  sozinho: quem decide passa a saber o que é seu e o que venceu. Cada ecrã
  de fila, quando existir, acrescenta a ligação nesta lista.
- **B:** espera pelos ecrãs das filas, começando pelo da diferença de
  pagamento.

### 28.7 Em código (12/10/2026; migração 0073; pedido #396)

| O quê | Onde |
|---|---|
| as quatro rotas `/hub/tasks`, com as funções da lista e do caso partilhadas com as da chave; a lista leva também o `fuso` do comerciante, para o ecrã mostrar e escolher os prazos nele | `apps/api/src/tarefas/rotas.ts` |
| `tarefas_podem_ser_responsaveis(fila)`: quem pode ser responsável, pela régua da base, só no comerciante do contexto | migração 0073 |
| o ecrã, o módulo «A decidir» (basta um dos âmbitos que lêem as filas), os textos PT, ES e EN e os motivos em linguagem comum | `apps/hub/src/ecras/ADecidir.tsx`, `tarefas.ts`, `modulos.ts`, `textos/` |
| testes: 6 pela API (`test/tarefas-hub.test.ts`), 13 sem servidor (`apps/hub/test/tarefas.test.ts`, com a régua igual à da API) e a passagem nas capturas | — |

**Desvios do desenho:**
- **«Atribuir…» e «Mudar o prazo…» abrem por baixo da linha,** como o
  histórico, e não num diálogo. O Hub não tem diálogos, e um painel na
  página não prende o foco nem o teclado. O foco vai para o título do
  painel quando abre.
- **Os motivos com texto** são os das filas de pagamentos, clientes e
  pós-venda, os estados do documento e os 19 motivos de retenção de um
  documento (`MOTIVOS_RETENCAO`), estes desde 12/10/2026 a partir do
  `docs/29` (R3, M6, M7) e do `docs/30` (C2). Um teste obriga cada motivo da
  lista da API (`apps/api/src/faturacao/motivos.ts`) a ter texto nas três línguas. Um código novo sem texto
  mostra-se como está.
- **O comerciante vai no cabeçalho,** não na consulta. É assim em todas as
  rotas do Hub.
- **Ficar com um caso que tem outro responsável** pede também
  `tasks:assign`, porque é tirá-lo a essa pessoa (R3; revisão do #396,
  P2-1). Sem `tasks:assign`, o botão só aparece nos casos sem responsável.
- **Uma IA declarada no pedido** (`Eurolify-IA`) não atribui nem muda prazos
  pelo Hub (R11; revisão do #396, P3-6).
- **O limite do prazo legal** no campo é a meia-noite do dia seguinte ao
  último dia legal, como a base o conta (revisão do #396, P3-2).
- **Os vazios por filtro** dizem todos «Nenhum caso com este filtro.», em vez
  de uma frase por filtro. A contagem não separa os vencidos: a API dá o
  total por fila, não por estado.
- **Uma linha que deixa de cumprir o filtro** depois de uma mudança fica à
  vista até se mudar de filtro ou recarregar, com o aviso «Guardado.»; tirá-la
  logo fazia perder o foco (revisão do #396, P3-9).
- **A tabela passa a cartões até 960 px** (`.tabela-larga`), porque as sete
  colunas não cabiam a 768 px (revisão do #396, P3-8).

**Ficam** (revisão do #396):
- Não há teste do componente sem servidor para o conflito (409), «Ver mais»
  e atribuir a outra pessoa; a passagem nas capturas cobre a resposta
  perdida, o foco, os filtros, ficar com o caso, o prazo e o histórico.
- O motivo livre de uma mudança de prazo vê-se no histórico por todos os
  papéis que lêem a fila (o armazém e o apoio também); limpa-se no
  apagamento do titular (DU) desde 14/10/2026 (migração 0102, `docs/33` §6).

### 28.6 Antes de dizer que está feito (o pedido do código)

- **API**:
  - as rotas pelo Hub fazem o mesmo que as da chave;
  - `responsavel=eu`;
  - o armazém e o apoio vêem só as filas que lêem e recebem 403 ao atribuir a outra pessoa e ao mudar o prazo;
  - outro comerciante não chega (404, com prova pela falha);
  - o `eurolify.quem` é a pessoa;
  - `pode_ser_responsavel` vem da base;
  - a versão (409).
- **Hub**:
  - a passagem do exemplo só com o teclado;
  - os quatro filtros e a fila;
  - «Ver mais»;
  - atribuir a outra pessoa;
  - mudar o prazo antes do prazo legal e recusar depois dele;
  - o conflito;
  - a resposta perdida;
  - o papel sem `tasks:assign`;
  - capturas a 375, 768 e 1280 px, em claro e escuro, para a página de aprovação (`eurolify-hub-quality-gate`; o programa de capturas só numa base descartável).

## 29. Envios: as contas de transportadora (issue #393)

Pedido do Diogo, 12/10/2026: *«avança»*, depois de a parte C dos envios estar
no `main` (`docs/36` §16, #406). Desenho aprovado pelo Diogo a 12/10/2026
(*«sim, aprovo; avança com o código»*). É o primeiro passo dos
envios no Hub. A API já tem tudo (`docs/36` §3.1, §7.1 e §16): o Hub só
lhe dá ecrãs. Skills: `eurolify-design`, `eurolify-hub-modular`,
`observability-security`, `eu-gdpr-privacy`, `order-fulfilment`.

Ex.: o dono abre «Envios» e escolhe «Ligar uma transportadora». Escolhe
«Sendcloud», dá-lhe o nome «Sendcloud (teste)» e a morada de onde saem as
encomendas. Depois cola a chave pública, a chave secreta e a chave de
assinatura dos avisos, e carrega em «Testar a ligação». A conta passa a
«Pronta», com um serviço: «Unstamped letter», para Portugal.

### 29.1 O que entra e o que fica de fora

| Entra |
|---|
| **A lista das contas** do comerciante, com estes campos: o nome; a transportadora; o estado («Por testar», «Pronta» ou «Arquivada»); o modo («Teste»); quando e por quem as credenciais foram guardadas; e quando foi testada. |
| **Ligar uma conta** (só o dono, `shipping:accounts`): a transportadora, o nome e a morada do remetente. |
| **Mudar o nome e a morada do remetente**, com a versão (409 num conflito). |
| **As credenciais.** Os campos dependem da transportadora: na Sendcloud, «Chave pública» e «Chave secreta». Junta-se o segredo dos avisos, com o endereço dos avisos para copiar (`…/webhooks/carriers/{transportadora}/cac_…`). Os segredos **nunca se mostram nem voltam do servidor**; o ecrã diz só «Guardadas a {data} por {pessoa}». |
| **«Testar a ligação»** e o resultado, nas palavras do servidor: pronta; credenciais recusadas (a conta volta a «Por testar»); a transportadora não respondeu (nada muda); ou a lista nova de serviços deixa métodos activos sem serviço (código próprio `shipping.service_in_use`; os métodos vão no `detail`, o ecrã diz que há um método activo a mudar primeiro; `docs/36` §16, P2-2, e revisão do #409). |
| **Os serviços da conta**: o nome, os países, o peso máximo e se pede telefone ou e-mail. Na Sendcloud, com a data da fotografia. |
| **Arquivar uma conta**, com confirmação («Arquivar a conta? Depois de arquivada, só se pode consultar. Se um método de entrega activo a usar, o arquivo é recusado»). O servidor recusa com `shipping.account_in_use` (409) enquanto houver um método activo com ela (revisão do #409, P2-2). |
| **Um módulo «Envios» na entrada do Hub**, para quem tem `shipping:read`. |

| Fica de fora, e porquê |
|---|
| **Os métodos de entrega** (a tarifa, a conta, o serviço, as zonas) e **o peso da embalagem por armazém**: são o passo seguinte (§31). Precisam das listas dos mercados e dos armazéns no Hub. |
| **A etiqueta e o seguimento numa expedição**: o Hub ainda não tem ecrãs das encomendas e das expedições. Ficam no ecrã «Expedir» (§33). |
| **O modo real**: é uma migração com decisão escrita (`docs/36` §16.2). O ecrã diz «Teste» e não oferece outro. |
| **Os CTT**: a conta cria-se, vê-se e arquiva-se, mas sem credenciais nem teste: o adaptador não declara campos, e o ecrã diz «Esta transportadora ainda não está ligada ao Eurolify», até haver o adaptador (V1). |

### 29.2 Como o Hub lê e escreve

**Rotas novas pela sessão do Hub**, uma para cada rota da chave, com a
mesma função e o mesmo âmbito (uma regra, um sítio). Seguem o padrão das
rotas do Hub (§28.2): o cabeçalho `Eurolify-Comerciante` e **sem
`Idempotency-Key`** (`docs/21` §11; o desenho dizia o contrário e corrigiu-se
no código). A `versao` recusa a repetição de uma alteração. Uma resposta
perdida ao ligar a conta não se repete sozinha: o ecrã diz que a conta pode
ter ficado criada e pede para conferir a lista.

| Caminho do Hub | Âmbito | A rota da chave |
|---|---|---|
| `GET /hub/carrier-accounts` | `shipping:read` | `GET /carrier-accounts` |
| `POST /hub/carrier-accounts` | `shipping:accounts` | `POST /carrier-accounts` |
| `PATCH /hub/carrier-accounts/{id}` | `shipping:accounts` | `PATCH /carrier-accounts/{id}` |
| `PUT /hub/carrier-accounts/{id}/credentials` | `shipping:accounts` | `PUT /carrier-accounts/{id}/credentials` |
| `POST /hub/carrier-accounts/{id}/test` | `shipping:accounts` | `POST /carrier-accounts/{id}/test` |
| `GET /hub/carrier-accounts/{id}/services` | `shipping:read` | `GET /carrier-accounts/{id}/services` |

- **Os papéis** são os da migração 0074: o dono tem `shipping:accounts`; o
  gestor, o armazém e o apoio só `shipping:read` e vêem a lista sem os
  botões. Nenhum papel muda.
- **O que o servidor passa a dizer** para o ecrã ser honesto:
  - `servicos_em` (a data da fotografia) na lista das contas;
  - os campos de credenciais que cada transportadora pede, com o nome e se é
    segredo. Nas contas da Sendcloud são `chave_publica` e `chave_secreta`.
  - **Quem os declara é o adaptador**, nunca o ecrã.
- **Os segredos:**
  - vão em campos de palavra-passe, sem preencher automaticamente;
  - no `PUT`, só seguem os campos que a pessoa escreveu;
  - nunca ficam no `localStorage` nem nos registos;
  - no caso de resposta perdida, o ecrã não os guarda para repetir: pede-os
    outra vez.
- `cache-control: private, no-store` nas leituras, como as outras do Hub.

### 29.3 O ecrã

| Ecrã | O que mostra | Estados além do normal |
|---|---|---|
| **Envios** (`/envios`, no módulo novo) | Uma linha por conta (cartões no telemóvel): o nome, a transportadora, o estado com a cor do estado, «Teste», e a última vez que foi testada. Para o dono, «Ligar uma transportadora». Por omissão, as arquivadas ficam escondidas, com «Mostrar as arquivadas». | sem contas («Ainda não há contas de transportadora»; para o dono, com o botão); a carregar; erro; sem permissão |
| **Ligar uma transportadora** (`/envios/nova`) | A transportadora (Sendcloud ou CTT), o nome e a morada do remetente: nome, linha 1, linha 2, código postal, localidade e país. | campos em falta e o país, conferidos no ecrã junto ao campo; um valor que o servidor recuse sai no topo, com a mensagem dele; resposta perdida (o ecrã não repete: diz que a conta pode ter ficado criada e manda conferir a lista) |
| **A conta** (`/envios/{cac_…}`) | O estado e o modo. O nome e o remetente, com «Editar». As credenciais: os campos da transportadora, vazios, com «Guardadas a {data} por {pessoa}» ou «Ainda não há credenciais». O segredo dos avisos e o endereço dos avisos, com «Copiar». «Testar a ligação». Os serviços, numa tabela. «Arquivar». | o teste a decorrer (o botão diz «A testar…», e as outras acções ficam paradas até acabar: guardar credenciais a meio daria conflito); os serviços que não se lêem (a página abre na mesma, com um aviso); os quatro resultados do teste (§29.1); conflito (409: «A conta mudou entretanto», com «Recarregar»); arquivada (só leitura); sem permissão para mudar (os campos não aparecem) |

**Os textos** estão em PT, ES e EN, sem maiúsculas forçadas. «Pronta» quer dizer
«passou o teste», e o ecrã nunca o diz por outras palavras.

**O caminho dos avisos.** O ecrã mostra o caminho
(`/webhooks/carriers/{transportadora}/cac_…`), não o endereço completo.
**Desde 13/10/2026** (`docs/36` §17), o nginx da VPS de ensaio publica só o
caminho dos avisos da Sendcloud. Os dos pagamentos e de outras
transportadoras continuam fechados, e o ecrã só mostra o caminho numa conta
da Sendcloud. Sem avisos, a volta consulta o seguimento de hora a hora.
**Rede temporária, retirada a 13/10/2026:** o texto `enviosAvisosVps` saiu no
mesmo pedido.

### 29.4 Antes de dizer que está feito (o pedido do código)

- **API:**
  - as rotas do Hub fazem o mesmo que as da chave;
  - os papéis sem `shipping:accounts` recebem 403 nas escritas;
  - uma conta de outro comerciante dá 404;
  - **os segredos nunca aparecem em nenhuma resposta**, com prova: procurar o valor do segredo no corpo de todas as respostas do teste;
  - `no-store`;
  - o contrato (`sessao`).
- **Hub:**
  - a passagem do exemplo, só com o teclado, contra a Sendcloud de ensaio;
  - credenciais recusadas, transportadora sem resposta e o conflito;
  - o papel do armazém só a ver;
  - capturas a 375, 768 e 1280 px, em claro e escuro, para a página de aprovação (`eurolify-hub-quality-gate`).

## 30. O ecrã «Faturação»: a ligação ao emissor e o relatório OSS (issue #310)

Pedido do Diogo, 12/10/2026 (*«sim, avança com o desenho do ecrã
Faturação»*). **Aprovado pelo Diogo a 12/10/2026**, com a Q1 em A (*«sim,
aprovo o desenho com a Q1 em A»*; `docs/06`, EG).

Hoje tudo o que a fatia 10 faz só se usa pela integração, com uma chave:
- ligar o Moloni pela autorização dele (`docs/29` §17);
- testar a ligação;
- ver o relatório OSS, fechar o período e classificar um documento
  (`docs/37`);
- descarregar os registos.

O Hub não tem nenhum ecrã de faturação (lido em `apps/hub/src/ecras`,
12/10/2026).

Skills: `eu-vat-oss-ioss`, `third-party-extensions`, `headless-commerce`,
`eurolify-design`, `eurolify-hub-modular`, `eurolify-hub-glass-responsive`,
`eurolify-hub-quality-gate`, `observability-security`, `eu-gdpr-privacy`.

Ex.: a dona da «Loja Exemplo» abre «Faturação» e vê:
- a ligação ao Moloni «Pronta, em modo teste»;
- por baixo, o T3 de 2026 com «1 fatura por classificar».

Carrega na fatura, escolhe «Nacional · PT» e grava. O relatório já não tem
impedimentos. Carrega em «Fechar o T3 de 2026», confirma com a passkey e vê
«Fechado a 12/10/2026, por si».

### 30.1 O que entra e o que fica de fora

| Entra |
|---|
| **A ligação de cada entidade legal**: o adaptador, o modo (teste), o estado (`por_testar`, `pronta`, `com_erro`, desligada), quando foi testada e o erro em linguagem comum |
| **Ligar o Moloni** (ou ligar outra vez) pela autorização dele, e **testar** a ligação |
| **O relatório OSS de um período** (trimestre; o mês fica na API): os cinco baldes por país e taxa, as alterações, o que fica à parte, o limiar e o que impede o fecho |
| **Classificar um documento** que o relatório não classifica sozinho (`docs/37` §10, P1-A) |
| **Fechar o período** (só o dono) e ver um período fechado tal como ficou |
| **Descarregar os registos** do art. 63.º-C do Reg. 282/2011 (CSV) |

| Fica de fora, e porquê |
|---|
| **Criar a ligação e os mapas** (a série, (país, taxa) → taxa do emissor, motivo → isenção, os ids do Moloni). Dependem de ids que só se lêem no Moloni, e um mapa errado põe uma taxa errada numa fatura. Ficam pela integração até haver leitura das listas do Moloni (Q1). |
| **Escolher o emissor da entidade** (`eurolify` ou `sistema_proprio`) e **«emitida fora»** (`docs/29` §15). São decisões de faturação com fila própria; entram com o ecrã dos documentos fiscais. |
| **Os documentos fiscais** (a lista, a prova, o PDF, resolver uma divergência). Outro ecrã: as filas de «A decidir» (§28) já os mostram pelo identificador. |
| **Declarar** no portal da AT. O Eurolify nunca declara: dá os números e os registos, e o comerciante apresenta a declaração (Diretiva IVA, art. 369.º-F; `docs/37`). |

### 30.2 Como o Hub lê e escreve

As rotas pelo Hub fazem **o mesmo** que as da chave (`apps/api/src/faturacao/rotas.ts` e `rotas-oss.ts`). Usam a sessão em vez da chave, o comerciante no cabeçalho `Eurolify-Comerciante` e o `eurolify.quem` da pessoa, como em «A decidir» (§28.2).

| Caminho | Quem | O que faz |
|---|---|---|
| `GET /hub/invoicing` | a sessão com `invoices:read` (dono, gestor, apoio) | as entidades legais do comerciante (nome, país, emissor escolhido) e as ligações de cada uma, **sem credenciais** (as mesmas de `GET /invoicing-connections`) |
| `POST /hub/invoicing-connections/{id}/authorize` `{ empresa }` | `invoices:accounts` (só o dono), **autenticação recente** | a mesma `pedirAutorizacao` (`docs/29` §17) |
| `POST /hub/invoicing-connections/{id}/authorize/complete` `{ codigo, estado }` | `invoices:accounts` | a mesma `concluirAutorizacao` |
| `POST /hub/invoicing-connections/{id}/test` | `invoices:accounts` | a mesma `testarLigacao` |
| `GET /hub/tax-reports/oss?entidade=&periodo=` | `tax:read` (dono, gestor, apoio) | o mesmo `relatorioOss` |
| `POST /hub/tax-reports/oss/classifications` | `tax:write` (só o dono) | a mesma `classificarOss` |
| `POST /hub/tax-reports/oss/close` | `tax:write`, **autenticação recente** | o mesmo `fecharOss`; o `fechado_por` passa a ser a pessoa (`pessoa:per_…`) |
| `GET /hub/tax-reports/oss/records?entidade=&periodo=` | `tax:read` | o mesmo CSV, com os mesmos cabeçalhos (sem cache, como anexo) |

- **Autenticação recente** para ligar uma conta e para fechar um período
  (§3): o primeiro dá acesso à emissão; o segundo não se desfaz.
- **O regresso do Moloni.** O servidor configura o `MOLONI_RETORNO_URL`
  com o endereço `/faturacao/moloni` do Hub.
  1. Antes de mandar a pessoa ao Moloni, o ecrã guarda no `sessionStorage`
     do separador o comerciante, a ligação, o `estado` e quando expira.
  2. A API devolve o código no fragmento (`#code=…`, `docs/29` §17,
     revisão do #407).
  3. O ecrã lê o fragmento, apaga-o do endereço e conclui com o `estado`
     guardado. Se o Moloni devolver um `state` diferente do guardado, não
     conclui e diz porquê.
  4. Sem nada guardado (outro separador, outro navegador, mais de 10
     minutos), diz para pedir outra vez.
- **O prazo de espera e as respostas perdidas**, como nas outras escritas do
  Hub (5 s, depois 503).
  - **Ao fechar:** relê o relatório. Se já estiver fechado, dá-o por feito.
  - **Ao classificar:** relê o relatório. Se o documento já não estiver nos
    impedimentos, dá-o por feito.

### 30.3 O ecrã

| Onde | O que mostra | Estados além do normal |
|---|---|---|
| **Entrada** (`/`) | Um módulo «Faturação» na grelha, para quem tem `invoices:read` ou `tax:read`: dono, gestor e apoio; o armazém não o vê. | — |
| **Faturação** (`/faturacao?comerciante=…`) | Uma secção por entidade legal (o nome e o país; com uma só, sem título repetido). **A ligação**: o emissor («Moloni»), «em modo teste» sempre à vista, o estado com texto e o token de estado (regra 3), «testada há 2 dias» e o erro em linguagem comum. Com `invoices:accounts`: «Ligar o Moloni» (sem credenciais), «Ligar outra vez» (com erro ou para mudar de conta) e «Testar». Sem ligação: «Esta entidade ainda não está ligada a um software de faturação. A ligação cria-se pela integração.» (Q1). Por baixo, **«Relatório OSS»**, com o último trimestre acabado e o estado dele («Aberto · 2 impedimentos», «Fechado a …»). | a carregar; erro com «Tentar outra vez»; entidade que escolheu o sistema próprio («Os documentos desta entidade saem do sistema próprio.»); ligação desligada; comerciante errado (como nas outras páginas) |
| **Ligar o Moloni** (diálogo) | O campo «Empresa no Moloni» (o número que o Moloni mostra na área de cliente) e a frase «Vai entrar no Moloni para autorizar o Eurolify. Só as empresas de teste são aceites.». Confirmar pede a autenticação recente e leva ao Moloni. | `invoices.invalid_field` (empresa fora da lista de teste, M8: «Esta empresa não é uma conta de teste.»); `invoices.not_configured` (o endereço de resposta não está configurado: «A ligação ao Moloni ainda não está disponível neste servidor.») |
| **De volta do Moloni** (`/faturacao/moloni`) | «A concluir a ligação ao Moloni…», depois «Ligado. Falta testar.» com o botão «Testar», e por fim o resultado. | sem pedido guardado ou expirado («Este pedido já não vale. Peça outra vez.»); `state` diferente; `invoices.issuer_error` (o Moloni recusou: a frase dele, tapada, e «Peça outra vez»); `invoices.issuer_busy` (documentos a meio: «Há documentos a meio no Moloni; resolva-os antes de mudar a conta.»); usada (409) |
| **Relatório OSS** (`/faturacao/oss?comerciante=…&entidade=lgl_…&periodo=2026-T3`) | **No topo**: o período, com anterior e seguinte. Os trimestres escolhem-se numa lista dos últimos oito, mais o actual com «em curso». Mostra o estado: aberto, ou «Fechado a {data}, por {nome}» com a versão da regra. Sempre a frase: «Estes números ajudam a preencher a declaração OSS. Quem a apresenta é a empresa, no portal das Finanças.» **Os baldes**: os cinco pela ordem do `docs/37` §2.1, cada um com a base e o IVA e as linhas por país e taxa (tabela a partir de 768 px, cartões abaixo, regra 5). As notas de crédito já vêm a negativo, e um valor negativo leva sinal e texto, não só cor. **Alterações de períodos anteriores**, quando houver, com o período de origem. **À parte** (sem somar): as emitidas fora do Eurolify (com o número declarado), as do sistema próprio e as por emitir. **O limiar**: «Vendas à distância em 2026: 4 230,00 € de 10 000,00 €»; com documentos excluídos, «a soma pode estar por baixo: {n} documentos não entraram». **O que impede o fecho**: cada motivo em linguagem comum, com os documentos (os últimos 4 algarismos à vista) e, nos classificáveis, «Classificar». No fim, «Descarregar os registos (CSV)» e, para o dono, «Fechar o {período}». | a carregar; erro; período inválido; período em curso (o botão diz «Só depois de {data}»); com impedimentos (o botão não aparece; a lista diz porquê); só «por emitir» (o diálogo de fechar pede a confirmação, Q-O4); período anterior ao último fechado (só leitura, com a frase do P1-B); CSV recusado (a frase da API); sem `tax:write` (só leitura, sem botões) |
| **Classificar** (diálogo) | O documento (número, data, total) e uma linha por cada linha da prova, pela ordem dela: a descrição, a taxa e os valores, **só de leitura**, e dois campos, o **balde** (lista dos cinco) e o **país** (lista dos 27 e «fora da UE»). O país vem filtrado pelo balde para o ecrã não oferecer o que a API recusa: nacional só o país da entidade, OSS e intracomunitárias os outros 26, exportação fora da UE. Quando a prova não tem data, também **a data**, entre o dia do pedido e hoje. Por fim, o **motivo** (obrigatório, com a frase «Não escreva dados de clientes neste motivo.») e o aviso «Esta decisão fica gravada e não se muda.». | `tax_reports.invalid` (a frase da API); `tax_reports.not_classifiable`; `tax_reports.already_classified` (relê); sem `tax:write` |
| **Fechar** (diálogo) | «Fechar o T3 de 2026? Os números ficam gravados como estão e o período não se reabre. O que chegar depois com data deste período entra como alteração no seguinte.» Com por emitir: a lista deles e a caixa «Vi os pedidos por emitir e quero fechar na mesma». Pede a autenticação recente. | `tax_reports.not_closable` (a lista nova de impedimentos: alguma coisa mudou); `tax_reports.already_closed` (relê); `tax_reports.retry` |

**A régua do país por balde** (no diálogo de classificar) vem do servidor e não é cópia: a rota `GET /hub/tax-reports/oss` passa a devolver `classificavel: { baldes: [{ balde, paises: [...] }] }`, calculado a partir de `PAISES_UE` e do país da entidade, os mesmos que validam em `classificarOss` (regra 8, como o `pode_ser_responsavel` do §28.2).

**Os impedimentos em linguagem comum** (pt, es, en), com o que se pode fazer:

| Código | Texto | Acção |
|---|---|---|
| `periodo_em_curso` | O período ainda não acabou. | — |
| `por_emitir` | Há pedidos pagos por faturar ({n}). | fechar com a confirmação (Q-O4) |
| `divergente` | Há faturas emitidas que não batem com o pedido. | — («A decidir») |
| `declarado_divergente` | Uma fatura já declarada passou a divergente. | — («A decidir») |
| `linhas_desalinhadas` | As linhas da fatura não batem com as do pedido. | «Classificar» (só se a divergência foi resolvida) |
| `sem_balde` | O Eurolify não sabe onde declarar uma linha. | «Classificar» |
| `sem_data` | A fatura não tem data. | «Classificar» |
| `outra_moeda` | Fatura noutra moeda que não o euro. | — (ainda não suportado) |
| `sinal_inesperado` | A fatura tem valores negativos. | — (suporte) |
| `periodo_anterior_aberto` | Um período anterior ainda está aberto ({período}). | ir a esse período |
| `periodo_posterior_fechado` | Já fechou um período a seguir a este. | só leitura |

### 30.4 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| **Números baseados em regras ainda C** (o período pela data do documento, a NC no período dela, a taxa da fatura emitida numa linha classificada, GR/EL) chegarem a um ecrã sem validação (`AGENTS.md`, «Não se erra», regra 7) | o ecrã diz sempre que os números ajudam e que quem declara é a empresa; o módulo só se liga **no ensaio** até o contabilista validar o `docs/37` (ADR-0045: as validações no fim do desenvolvimento, antes do primeiro comerciante de fora). A porta está escrita no `docs/05`, «Antes do primeiro comerciante de fora» (revisão do #408, P2-5) |
| Ler um período fechado como recalculado | o topo diz «Fechado a …» e a página mostra a fotografia, nunca outra conta |
| O apoio descarregar os registos (têm o NIF e o nome dos clientes) | `tax:read` dá-lhe o mesmo que pela chave. O ecrã diz antes de descarregar: «Tem dados pessoais (NIF e nome). Guarde-o só onde guarda a contabilidade.» Se o apoio não deve ter esta leitura, muda-se o papel (`papel_ambitos`), não o ecrã |
| Ligar a conta Moloni de outra pessoa | a autorização só se conclui com o `estado` guardado no separador de quem a pediu; o P2-1 do #407 (prender o código ao pedido) continua por fazer antes do modo real |
| Classificar com um país que a API recusa | o ecrã só oferece os países que o servidor devolve; a API confere outra vez |
| Duas pessoas a fechar o mesmo período | a API fecha um de cada vez por entidade; a segunda recebe `already_closed` e o ecrã relê |
| Um erro do Moloni com dados sensíveis no ecrã | a API já tapa os segredos (`taparSegredos`); o ecrã mostra só a `mensagem` |

### 30.5 Decidido

✅ **Q1: A** (Diogo, 12/10/2026, *«sim, aprovo o desenho com a Q1 em A»*).

**Q1. A ligação ao emissor e os mapas criam-se no Hub nesta parte?** Ex.:
a dona da «Loja Exemplo» ainda não tem ligação. Precisaria de escolher a
série «500», dizer que a taxa de 23 % de PT é a taxa «11» do Moloni e indicar
o artigo dos portes e o cliente «Consumidor final».
- **A (proposta):** não. Nesta parte, o Hub só liga, testa e mostra a
  ligação; criá-la e os mapas ficam pela integração. Os mapas dependem de ids
  que só se lêem no Moloni, e um mapa errado põe uma taxa errada numa fatura.
  Entram numa parte seguinte, com a leitura das listas do Moloni (as taxas,
  as séries, os artigos), para escolher em vez de escrever números.
- **B:** sim, já, com campos de texto para os ids. É mais rápido, mas é
  exactamente o tipo de configuração escrita à mão que o `docs/04` mostra a
  dar faturas erradas.

### 30.6 Antes de dizer que está feito (o pedido do código)

- **API**: as oito rotas pelo Hub fazem o mesmo que as da chave.
  - O gestor e o apoio recebem 403 ao ligar, classificar e fechar; o armazém
    recebe 403 em tudo.
  - Outro comerciante não chega (404, com prova pela falha).
  - Ligar e fechar pedem autenticação recente.
  - `fechado_por` e `decidido_por` são a pessoa.
  - O CSV sai com os mesmos cabeçalhos.
  - `classificavel` vem do servidor.
- **Hub**: a passagem completa só com o teclado:
  - ligar com o Moloni simulado;
  - o regresso com e sem `sessionStorage`;
  - testar;
  - abrir o T3 com um impedimento e classificá-lo;
  - fechar com a passkey;
  - ver o período fechado;
  - descarregar o CSV.

  Também: o papel sem `tax:write`, um período em curso e um posterior
  fechado.
- **Capturas**: a 375, 768 e 1280 px, claro e escuro, para a página de
  aprovação (`eurolify-hub-quality-gate`).

### 30.7 Em código (12/10/2026; pedido #408)

| O quê | Onde |
|---|---|
| as rotas `/hub/invoicing…` (a faturação, ligar, concluir, testar), pelo papel da sessão e com autenticação recente para ligar | `apps/api/src/faturacao/rotas.ts` |
| as rotas `/hub/tax-reports/oss…` (o relatório com `classificavel`, o documento a classificar, classificar, fechar com autenticação recente, os registos) | `apps/api/src/faturacao/rotas-oss.ts`; `paisesPorBalde`, `classificavelOss` e `documentoParaClassificar` em `oss.ts` |
| o módulo, a página «Faturação», o regresso do Moloni e o relatório OSS, com os diálogos | `apps/hub/src/ecras/Faturacao.tsx`, `RelatorioOss.tsx`, `Dialogo.tsx`; a lógica em `apps/hub/src/faturacao.ts` |
| testes: as rotas pelo papel (`apps/api/test/faturacao-hub.test.ts`), a lógica do Hub (`apps/hub/test/faturacao.test.ts`) e as capturas (`scripts/capturas.mjs`, com `/faturacao`) | — |

**Desvio do desenho:** uma rota a mais, `GET /hub/tax-reports/oss/documents/{id}`.
O relatório não traz as linhas da prova, e o diálogo «Classificar» precisa
delas. A rota devolve o número, a data, o total, a data mínima e as linhas;
nunca o NIF nem o nome do cliente.

**Revisão do #408** (agente da sessão, Opus 5.5; 0 P0, 0 P1, 5 P2, 11 P3):
- **P2-1, corrigido:** os erros do relatório e a recusa do Moloni passam a
  ter texto próprio nas três línguas, com o pormenor da API (em português).
- **P2-2, corrigido:** uma resposta perdida conta também com um 5xx sem
  código; no regresso do Moloni, relê a ligação antes de dizer que falhou.
- **P2-5, corrigido:** a porta do ensaio está escrita no `docs/05`, «Antes do
  primeiro comerciante de fora».
- **P2-3, em parte:** já há testes do gestor e do outro comerciante ao
  concluir, testar e descarregar, e do CSV com a mesma primeira linha. Falta
  o teste com um documento real: a rota do documento sem NIF nem nome, e o
  `decidido_por` da pessoa.
- **P2-4, não feito:** a passagem completa do Hub só com o teclado. Está
  feita só contra uma API simulada, fora do repositório; as capturas
  verdadeiras cobrem a página `/faturacao`.
- **P3-1 a P3-3, P3-6, P3-7, P3-9 e P3-10, corrigidos:** um `state` mal
  formado recusa-se; o endereço confere-se antes de guardar; sem sessão, o
  pedido não se apaga; «uma integração» em vez do identificador; a data no
  fuso de Lisboa; o comerciante nunca vazio; «administración tributaria».
- **P3-4, P3-5, P3-8 e P3-11, ficam:** o botão «Classificar» aparece numa
  divergência por resolver, e a API recusa-a com a frase dela; a confirmação
  dos por emitir é a da lista lida; o módulo com `tax:read` sem
  `invoices:read`; dois pormenores de acessibilidade.

**Por fazer:**
- **A exportação:** os países fora da UE ainda não vêm do servidor. O ecrã
  pede o código, e a API confere-o.
- **`periodo_anterior_aberto`:** o impedimento não diz qual é o período.
- **Os erros do relatório em espanhol:** saem com a mensagem genérica.
- **O relatório OSS nas capturas:** não entra, porque o script não sabe o id
  da entidade.
- **A passagem com uma passkey real e no Safari de um iPhone.**

## 31. Envios: os métodos de entrega e o peso da embalagem (issue #393)

Pedido do Diogo, 12/10/2026: *«depois avança com os métodos de entrega»*. A
13/10/2026 aprovou o aspecto dos ecrãs do §29 (*«aprovo; avança com os
métodos de entrega»*). Desenho aprovado pelo Diogo a 13/10/2026 (*«sim, aprovo; avança com o
código»*).

A API já tem quase tudo:
- os métodos (`docs/25` §3.6, Q2; `docs/36` §3.2);
- o peso da embalagem por armazém (`docs/36` Q6, `PUT /warehouses/{id}/packaging`);
- as regras do checkout (`docs/36` R4).

O Hub dá-lhes ecrãs. Só falta na API ler o peso da embalagem, que hoje só se
escreve.

Skills: `eurolify-design`, `eurolify-hub-modular`, `consumer-rights-eu`,
`order-fulfilment`, `eu-localization`, `eurolify-transport-logistics-eu`,
`observability-security`.

Ex.: o gestor abre «Envios» → «Métodos de entrega» e escolhe «Criar um
método». Escolhe o mercado «Portugal» e escreve o nome «Correio registado».
Põe a tarifa de 4,99 €, grátis a partir de 50,00 €, e entrega até 5 dias.
Escolhe a conta «Sendcloud (teste)» e o serviço «Unstamped letter»; o peso
máximo vem do serviço (2 kg) e o gestor confirma-o. Em «Códigos postais»
escreve `1`, `2`, `3`, `4`, `5`, `6`, `7` e `8`: só o continente (os Açores
começam por `9`). No armazém de Lisboa põe a embalagem a 200 g.

### 31.1 O que entra e o que fica de fora

| Entra |
|---|
| **A lista dos métodos**, por mercado: o nome, a tarifa (na moeda do mercado, com ou sem IVA como o mercado), «grátis a partir de», o prazo máximo, a transportadora e o serviço (ou «Manual»), e o estado («Activo» ou «Arquivado»). |
| **Criar um método** (dono e gestor, `shipping:write`): os campos de §31.3. |
| **Mudar um método**, com a versão (409 num conflito), e **arquivar e reactivar**. Arquivar tira-o do checkout. O mercado não muda depois de criado: a API não o deixa. |
| **O peso da embalagem por armazém**, em gramas, somado ao das variantes na etiqueta (`docs/36` Q6). |
| **As restrições que o cliente vê.** O ecrã diz ao comerciante que o prazo máximo e as regiões servidas aparecem ao cliente antes da compra. Fontes: L1 e L3 do `docs/36` §5 (Dir. 2011/83/UE, art. 6.º, n.º 1, al. g); DL 24/2014, art. 7.º). Relidas no `eur-lex` a 13/10/2026: `corpus/consumidores-e-vendas/32011L0083-direitos-dos-consumidores.md` e `legislacao-pt/decreto-lei-24-2014.md`, este consolidado até 03/03/2023, obtido a 10/10/2026. |

| Fica de fora, e porquê |
|---|
| **Aceitar mercadorias perigosas (números ONU) pelo Hub.** A classificação é de um profissional, nunca do nome (L9, `eurolify-transport-logistics-eu`). O ecrã mostra a lista e diz que está vazia por omissão, mas não a muda. Quem precisar muda-a pela API, com a classificação feita. |
| **Opções de entrega respeitadoras do ambiente (L8).** A transposição portuguesa não está no `eur-lex` (Q8 do `docs/36`): **C**. |
| **O IVA dos portes com categorias misturadas (V12):** é o contabilista que decide. O ecrã não promete nada sobre ele. |
| **Criar e mudar mercados e armazéns:** são de outros domínios (`docs/20`, `docs/24`). O ecrã só os lê para escolher. |
| **A etiqueta numa expedição**, que precisa dos ecrãs das encomendas (`docs/27`). |

### 31.2 Como o Hub lê e escreve

Segue o padrão do §29.2:
- a sessão da pessoa e o cabeçalho `Eurolify-Comerciante`;
- **sem `Idempotency-Key`** (`docs/21` §11): a `versao` recusa a repetição;
- `cache-control: private, no-store`, também nos 403;
- a escrita corre com `eurolify.quem = pessoa:per_…`. Hoje o método e a
  embalagem não têm rasto de auditoria (procurei `metodo_entrega` com
  «rasto» nas migrações, a 13/10/2026). Fica assim: um rasto é outro pedido.

| Caminho do Hub | Âmbito | A rota da chave |
|---|---|---|
| `GET /hub/shipping-methods?mercado=` | `shipping:read` | `GET /shipping-methods` |
| `POST /hub/shipping-methods` | `shipping:write` | `POST /shipping-methods` |
| `PATCH /hub/shipping-methods/{id}` | `shipping:write` | `PATCH /shipping-methods/{id}` |
| `GET /hub/markets` | `prices:read` | `GET /markets` |
| `GET /hub/warehouses` | `inventory:read` | `GET /warehouses` (passa a dizer `embalagem_g`) |
| `PUT /hub/warehouses/{id}/packaging` | `shipping:write` | `PUT /warehouses/{id}/packaging` |

- **Os papéis** não mudam: o dono e o gestor têm `shipping:write` (migração
  0074). O armazém e o apoio só vêem, sem botões. Todos os papéis com
  `shipping:read` têm também `prices:read` e `inventory:read`, por isso vêem
  os nomes dos mercados e dos armazéns.
- **O que muda na API:** a lista dos armazéns passa a dizer `embalagem_g`,
  pela chave e pelo Hub. Hoje escreve-se e não se lê.
- **A embalagem não tem versão** (`PUT` sem `versao`): ganha a última
  escrita, como já acontece pela chave. Depois de guardar, o ecrã relê e
  mostra o valor que ficou.
- **A conta e o serviço** escolhem-se das contas `pronta`. Os serviços de
  cada conta vêm de `GET /hub/carrier-accounts/{id}/services` (§29.2), só
  os que servem os países do mercado. **Quem confere é o servidor**: conta
  pronta, serviço declarado, país, peso, telefone e ONU (`docs/36` §3.2).
  O ecrã só sugere.
- **Os montantes** escrevem-se na moeda do mercado e vão em cêntimos, com o
  mesmo apoio dos preços (`preco.ts`, §25).

### 31.3 O ecrã

Dentro do módulo «Envios», três separadores: «Contas» (o que já existe,
§29), «Métodos de entrega» e «Embalagem».

| Ecrã | O que mostra | Estados além do normal |
|---|---|---|
| **Métodos de entrega** (`/envios/metodos`) | Um filtro por mercado. Uma linha por método (cartões no telemóvel): o nome, o mercado, a tarifa, «grátis a partir de», «até N dias», a transportadora e o serviço (ou «Manual»), e o estado. Para o dono e o gestor, «Criar um método». As arquivadas ficam escondidas, com «Mostrar os arquivados». A contagem à vista. | sem mercados (diz que primeiro se cria um mercado, sem botão para isso); sem métodos; a carregar; erro; sem permissão |
| **Criar um método** (`/envios/metodos/novo`) | O mercado. O nome, em cada língua do mercado (a principal é obrigatória). O prazo em texto por língua (opcional, ex.: «2 a 3 dias úteis»). A tarifa e «grátis a partir de», com a moeda e «com IVA» ou «sem IVA», como o mercado. «Pede telefone». A transportadora: «Manual (sem etiquetas)» ou uma conta pronta, e o serviço dela. O prazo máximo, de 1 a 30 dias, com a nota de que o cliente vê «entrega até {data}». Os códigos postais servidos (prefixos; vazio é o país todo), com a nota de que o cliente vê a restrição antes de encomendar. O peso máximo, sugerido pelo serviço. A lista ONU, só a ler. | campos em falta junto ao campo; a recusa do servidor (conta não pronta, serviço desconhecido, país não servido, telefone ou peso) sai com o texto do código; sem contas prontas (só «Manual», com ligação a «Contas»); resposta perdida (o ecrã não repete: diz que o método pode ter ficado criado e manda conferir a lista) |
| **O método** (`/envios/metodos/{shm_…}`) | Os mesmos campos, com «Guardar», e «Arquivar» ou «Reactivar», com confirmação. | conflito (409, com «Recarregar»); arquivado (só leitura, com «Reactivar»); a conta do método arquivada ou por testar (aviso: o checkout não o oferece, `docs/36` R4); sem permissão para mudar |
| **Embalagem** (`/envios/embalagem`) | Uma linha por armazém: o nome, a loja e o peso da embalagem em gramas, com «Guardar» em cada linha. A nota: «Soma-se ao peso das variantes na etiqueta». | sem armazéns (diz que se criam em «Stock»); valor fora de 0 a 100 000 g; a carregar; erro; sem permissão para mudar |

**Os textos** estão em PT, ES e EN. «Manual» quer dizer «sem etiquetas pelo
Eurolify», e o ecrã di-lo.

### 31.4 Por onde é que isto ainda pode sair errado

- **Uma tarifa escrita na moeda errada.** O campo mostra a moeda do
  mercado, e a lista mostra o valor formatado na moeda do mercado.
- **Um prefixo de código postal mal escrito deixa clientes sem entrega**, ou
  entrega onde não se queria. O ecrã mostra os prefixos e um exemplo do
  formato do país, mas não confere a lista contra uma tabela de regiões:
  essa tabela é o `zonas` do `docs/36` §3.2, que ainda não existe.
- **Uma conta arquivada ou que deixou de passar o teste** tira o método do
  checkout sem aviso ao cliente. O ecrã do método di-lo ao comerciante.
- **A embalagem sem versão:** duas pessoas a mudar ao mesmo tempo, ganha a
  última. O ecrã relê depois de guardar.

### 31.5 Antes de dizer que está feito (o pedido do código)

- **API:**
  - as rotas do Hub fazem o mesmo que as da chave;
  - o armazém e o apoio levam 403 nas escritas;
  - o método de outro comerciante dá 404;
  - `no-store`, também nos 403;
  - `embalagem_g` na lista dos armazéns.
- **Hub:**
  - a passagem do exemplo só com o teclado;
  - o conflito, a recusa do servidor (serviço que não serve o país), sem
    contas prontas e sem mercados;
  - o armazém só a ver;
  - capturas a 375, 768 e 1280 px, em claro e escuro, para o OK do aspecto
    (`eurolify-hub-quality-gate`).

### 31.6 Em código (13/10/2026; pedido #413)

- **API:**
  - as seis rotas do §31.2 estão em `src/envios/rotas-hub.ts`;
  - os esquemas e a forma do método (`CorpoNovoMetodo`, `CorpoMudarMetodo`,
    `paraMetodo`) passam a viver ao nível do módulo em
    `src/checkout/rotas.ts`, para a chave e o Hub usarem os mesmos;
  - a lista dos armazéns diz `embalagem_g` (`paraArmazem`);
  - sem migração.
- **Hub:**
  - os separadores «Contas», «Métodos de entrega» e «Embalagem»;
  - `src/ecras/EnviosMetodos.tsx` e o apoio em `src/envios-metodos.ts`;
  - no `PATCH` só vão os campos que mudaram. Assim, um método cuja conta
    deixou de estar pronta ainda pode mudar de tarifa: o servidor só confere
    a conta quando se lhe toca;
  - os códigos dos envios têm, neste ecrã, um texto próprio. Exemplo:
    `shipping.account_not_ready` quer dizer «a conta escolhida não está
    pronta», e não «as credenciais».
- **Testes:**
  - `test/envios-hub-metodos.test.ts` (API, 6);
  - `test/envios-metodos.test.ts` (Hub, 5);
  - as capturas criam um método «Manual» e põem a embalagem.

**Revisão do agente** (Claude Sonnet 5.5, publicada no #413): 0 P0, 0 P1 e
4 P2, todos corrigidos.
- **P2-1:** um método arquivado também se muda. Se a conta dele deixou de
  estar pronta, escolhe-se outra, ou «Manual», antes de reactivar. Há um
  teste da API para isto.
- **P2-2:** num conflito, o que a pessoa escreveu fica no formulário; só
  «Tentar outra vez» o substitui pela versão actual.
- **P2-3:** a embalagem soma-se ao peso na etiqueta. O texto já não diz que
  conta para o peso máximo dos métodos: o checkout só soma as variantes.
- **P2-4:** o texto de «não encontrado» depende do ecrã (o mercado ao criar,
  o método ao mudar, o armazém na embalagem).
- Também corrigidos:
  - a ajuda dos campos continua ligada quando o campo está errado;
  - o campo corrigido deixa de estar marcado;
  - os mercados arquivados não se oferecem num método novo.

**Desvios do §31, declarados:**
- **Os números ONU:** a rota do Hub aceita `aceita_onu`, como a da chave,
  porque o corpo é o mesmo. O ecrã nunca o envia.
- **A embalagem:** a lista mostra o armazém sem o nome da loja.
- **Os prefixos:** não há um exemplo por país, só o exemplo geral da ajuda.
- **Os estados do §31.5 sem prova** nas capturas nem em testes do ecrã:
  - o conflito, a recusa do servidor e o armazém só a ver;
  - a passagem só com o teclado.

  As capturas fazem o caminho normal: vazio, criar «Manual», sem contas
  prontas e a embalagem.

## 32. Faturação: criar a ligação ao Moloni e os mapas no Hub (issue #310)

Pedido do Diogo, 13/10/2026 (*«sim, avança com o desenho da ligação ao
Moloni no Hub»*). É a parte que a Q1 do §30 deixou para depois: «entram numa
parte seguinte, com a leitura das listas do Moloni». **Aprovado pelo Diogo a
13/10/2026**, com a Q1 em A (*«sim, aprovo o desenho com a Q1 em A»*;
`docs/06`, EI).

Hoje a ligação, a série e os mapas só se criam pela integração. É preciso
escrever os números do Moloni à mão: a série, cada (país, taxa) → `tax_id`,
cada código de isenção → motivo do Moloni e os ids da configuração (`docs/29`
§13.2). Um número errado põe uma taxa errada numa fatura (`docs/04`).

Skills: `eu-vat-oss-ioss`, `third-party-extensions`, `headless-commerce`,
`eurolify-design`, `eurolify-hub-modular`, `eurolify-hub-quality-gate`,
`observability-security`.

Ex.: a dona da «Loja Exemplo»:
1. Carrega em «Criar a ligação ao Moloni», liga a conta (§30) e testa.
2. Abre «Configurar». Escolhe a série «Loja online 2026» e, para «IVA 23 %
   (PT)», a taxa «Taxa Normal 23 % · PT» do Moloni. Para o motivo «M16»,
   escolhe o «M16» do Moloni.
3. Procura «Portes» e escolhe o artigo; procura «Consumidor final» e escolhe
   o cliente.
4. Grava. A ligação fica «por testar», testa outra vez e fica «Pronta».

### 32.1 O que diz o Moloni (páginas lidas a 12/10 e 13/10/2026, **M**; nenhuma lida pela API: as credenciais da conta de teste não estão no ambiente)

| O que se escolhe | Método do Moloni | O que devolve |
|---|---|---|
| a série | `documentSets/getAll` (`company_id`; até 50) | `document_set_id`, `name`, `active_by_default` |
| as taxas | `taxes/getAll` | `tax_id`, `value`, `saft_type`, `fiscal_zone` (`docs/eurolify/fontes-api-moloni-11out2026.md` §9) |
| as isenções | `taxExemptions/getAll` | `code`, `name`, `description` |
| os métodos de pagamento | `paymentMethods/getAll` (`company_id`; até 50) | `payment_method_id`, `name` |
| a língua | `languages/getAll` (sem parâmetros) | `language_id`, `code`, `title` |
| o vencimento | `maturityDates/getAll` (`company_id`) | `maturity_date_id`, `name`, `days` |
| a unidade dos artigos criados | `measurementUnits/getAll` (`company_id`) | `unit_id`, `name`, `short_name` |
| a categoria dos artigos criados | `productCategories/getAll` (`company_id`, `parent_id` = 0 para as de topo) | `category_id`, `name`, `num_categories` |
| o artigo dos portes | `products/getBySearch` (`search` no nome, na referência ou no EAN; até 50) | `product_id`, `name`, `reference`, `price` |
| o cliente «Consumidor final» | `customers/getBySearch` (`search` no número, no contribuinte ou no nome; até 50) | `customer_id`, `vat`, `name`, `number` |

**Por medir na conta de teste:** os campos exactos de cada resposta e se
estas leituras contam para o limite de pedidos (§13.5).

### 32.2 O que entra e o que fica de fora

| Entra |
|---|
| **Criar a ligação ao Moloni** de uma entidade que não tem nenhuma activa: sem série nem mapas, «por testar» |
| **Configurar**: a série, as taxas, as isenções, os métodos de pagamento, a língua, o vencimento, a unidade e a categoria dos artigos criados, o artigo dos portes e o cliente «Consumidor final», **sempre escolhidos de uma lista lida do Moloni** |
| **Ver o que falta**: o Eurolify diz que pares (país, taxa), que códigos de isenção e que meios de pagamento precisam de mapa. O que falta não impede gravar, mas fica à vista, e uma fatura que precise dele fica retida (`taxa_sem_mapa`, `isencao_sem_mapa`, motivos que já existem) |

| Fica de fora, e porquê |
|---|
| **Escolher o emissor da entidade** (Eurolify ou sistema próprio): como no §30.1, entra com o ecrã dos documentos fiscais |
| **Criar séries, taxas ou artigos no Moloni**: nunca a partir do Eurolify; cria-se no Moloni e escolhe-se aqui |
| **O adaptador de ensaio**: não lê listas; continua só pela integração |
| **Desligar a ligação**: fica pela integração, porque desligar com documentos a meio tem regras próprias (R15) |

### 32.3 Como o Hub lê e escreve

| Caminho | Quem | O que faz |
|---|---|---|
| `POST /hub/invoicing-connections` `{ entidade_legal }` | `invoices:accounts` (o dono) | a mesma `criarLigacao`, com `adaptador = moloni`, sem série nem mapas; uma activa por entidade (a base já o garante) |
| `GET /hub/invoicing-connections/{id}/issuer-options` | `invoices:accounts` | **lê do Moloni**, com as credenciais da ligação: as séries, as taxas, as isenções, os métodos de pagamento, as línguas, os vencimentos, as unidades e as categorias de topo. **Junta o que o Eurolify precisa de mapear**: os pares (país, taxa) da tabela do Motor de IVA vigentes hoje nos países dos mercados activos do comerciante, os códigos de motivo de isenção do Motor (os de `GET /tax/reasons`) e os meios de pagamento que o comerciante aceita (a régua método → conta, `docs/26`). Nunca escolhe nada |
| `GET /hub/invoicing-connections/{id}/issuer-search?tipo=artigo\|cliente&q=` | `invoices:accounts` | pesquisa no Moloni (`products/getBySearch` ou `customers/getBySearch`), até 50; de cada cliente só o id, o número e o nome, **nunca o contribuinte nem a morada** |
| `PATCH /hub/invoicing-connections/{id}` `{ versao, serie, taxas, isencoes, config }` | `invoices:accounts` | a mesma `mudarLigacao` da chave: fica por testar e, com documentos a meio no emissor, recusa (R15). **Antes de gravar, o servidor relê as listas do Moloni e confere que cada id escolhido existe lá** (uma série apagada entretanto, ou um id escrito à mão por uma integração do Hub, é recusado com `invoices.invalid_field`) |

- **Os erros do Moloni** (credenciais mortas, rede) saem como na ligação
  (`invoices.issuer_error`, tapados). A ligação passa a «com erro» só pela
  renovação, nunca por uma leitura de listas.
- **O limite próprio por empresa** (§13.5) conta também estas leituras.
- **Sem cópia das listas na base.** Lêem-se quando se abre «Configurar» e
  quando se grava. Nada do Moloni fica guardado além dos ids escolhidos.

### 32.4 O ecrã

| Onde | O que muda | Estados além do normal |
|---|---|---|
| **Faturação** (§30.3), uma entidade sem ligação | Para o dono: «Criar a ligação ao Moloni» (em vez da frase da Q1 do §30). Cria e mostra a ligação «Por testar», com «Ligar o Moloni» | já existe uma activa (relê); sem `invoices:accounts` (só a frase) |
| **Faturação**, uma entidade com ligação Moloni ligada | «Configurar», e por baixo do estado «Faltam 2 taxas e 1 método de pagamento» (do `issuer-options`), ou nada quando nada falta | — |
| **Configurar** (`/faturacao/configurar?comerciante=…&ligacao=isx_…`) | Uma secção por grupo, cada uma com listas de escolha preenchidas pelo Moloni, sempre com o nome e o id do Moloni lado a lado (`Taxa Normal 23 % · PT (id 11)`): **Série**; **Taxas** (uma linha por par do Eurolify, «IVA 23 % · Portugal», e a taxa do Moloni a escolher); **Isenções** (uma linha por código); **Métodos de pagamento** (uma linha por meio); **Para os clientes criados** (língua, vencimento); **Para os artigos criados** (unidade, categoria); **Portes** e **Consumidor final** (um campo de pesquisa que mostra até 50 resultados). Por baixo, «Faltam: …» actualizado à medida que se escolhe. «Gravar» grava tudo de uma vez, com a versão lida. Depois de gravar, «A ligação ficou por testar.» e o botão «Testar» | a ler o Moloni; o Moloni recusou ou não respondeu (a frase, tapada, e «Tentar outra vez»); lista vazia no Moloni («O Moloni não tem nenhuma série; crie-a no Moloni e volte.»); conflito (409: «Outra pessoa mudou esta ligação entretanto.», com as escolhas da pessoa guardadas no ecrã); um id que deixou de existir (`invoices.invalid_field`: a frase da API e a lista relida); documentos a meio (`invoices.issuer_busy`); sem permissão |

### 32.5 Por onde é que isto ainda pode sair errado

| Risco | O que o evita |
|---|---|
| **Escolher a taxa errada do Moloni** (uma de 23 % de outra zona fiscal, ou de 13 % em vez de 23 %) | a lista mostra o valor, a zona fiscal e o id; nada vem escolhido (Q1); o teste da ligação não chega para isto. **O contabilista confere os mapas antes do primeiro comerciante de fora** (**C**, `docs/05`) |
| Escolher por nome um cliente ou artigo com nome parecido | a pesquisa mostra o número e a referência ao lado do nome, e guarda-se o id (`AGENTS.md`, «Não se erra», regra 6) |
| Um id que deixa de existir no Moloni depois de gravado | o servidor confere ao gravar; depois disso, a emissão falha no Moloni e o documento fica retido com a frase dele (§13.5), nunca sai com outra coisa |
| Dados pessoais dos clientes do Moloni no Hub | a pesquisa de clientes só devolve o id, o número e o nome; o contribuinte e a morada não saem |
| A leitura gastar o limite do Moloni | o limite próprio por empresa (§13.5); as listas lêem-se só ao abrir e ao gravar |

### 32.6 Decidido

✅ **Q1: A** (Diogo, 13/10/2026, *«sim, aprovo o desenho com a Q1 em A»*).

**Q1. O ecrã sugere a taxa do Moloni quando o valor e a zona fiscal batem?**
Ex.: para «IVA 23 % · Portugal», o Moloni tem a «Taxa Normal» (23 %, zona
PT) e a «Taxa Normal antiga» (23 %, zona PT, já sem uso).
- **A (proposta):** não sugere nem escolhe. As taxas do Moloni com o mesmo
  valor e a mesma zona aparecem **no topo da lista**, e a pessoa escolhe
  sempre. Nada fica escolhido sem alguém o escolher («Não se erra», regra
  6), e duas taxas iguais no Moloni são justamente o caso em que adivinhar
  sai caro.
- **B:** vem pré-escolhida quando só há uma que bate; a pessoa confirma. Poupa
  cliques, mas um «Gravar» distraído grava uma escolha que ninguém fez.

### 32.7 Antes de dizer que está feito (o pedido do código)

- **API**:
  - as quatro rotas pelo papel: só o dono; o gestor, o apoio e o armazém
    recebem 403; outro comerciante, 404;
  - as listas contra o Moloni simulado, incluindo a recusa e a rede;
  - a pesquisa de clientes sem contribuinte nem morada;
  - o `PATCH` recusa um id que não existe no Moloni, com a versão (409) e
    com documentos a meio;
  - o «o que falta» bate com os motivos de retenção (uma fatura com uma
    taxa por mapear fica retida).
- **Hub**:
  - criar, ligar, configurar e testar só com o teclado;
  - o conflito, a lista vazia e a recusa do Moloni;
  - capturas a 375, 768 e 1280 px, em claro e escuro.
- **Na conta de teste do Moloni** (com as credenciais no ambiente e o OK de
  cada escrita): ler as listas a sério antes de abrir isto a um comerciante.

### 32.8 Em código (13/10/2026; pedido #412)

| O quê | Onde |
|---|---|
| as quatro rotas `/hub/invoicing-connections…` (criar, `issuer-options`, `issuer-search`, `PATCH`), só com `invoices:accounts` | `apps/api/src/faturacao/rotas.ts` |
| o que o Eurolify precisa de mapear (`necessarioDe`), o que falta (`faltaNaLigacao`, a mesma chave de `motivosDoConteudo`), ler e pesquisar no emissor, e gravar com a conferência dos ids (`configurarLigacao`) | `apps/api/src/faturacao/repositorio.ts` |
| as listas, a pesquisa e a confirmação de um artigo ou cliente por id (`products/getOne`, `customers/getOne`) no Moloni | `apps/api/src/faturacao/moloni.ts`; o contrato em `adaptador.ts` |
| «Criar a ligação ao Moloni», «Configurar», «Falta mapear: …» e o ecrã `/faturacao/configurar` | `apps/hub/src/ecras/Faturacao.tsx`, `ConfigurarFaturacao.tsx`; a lógica em `apps/hub/src/faturacao.ts` |
| testes: as rotas pelo papel, as listas, a pesquisa sem contribuinte, a conferência ao gravar, o 409, a recusa do Moloni e os documentos a meio (`apps/api/test/faturacao-configurar.test.ts`); a lógica do Hub (`apps/hub/test/faturacao.test.ts`); as capturas com `/faturacao/configurar` | — |

**Desvios do desenho (para o Diogo ou o Bruno confirmarem):**
- **O «Falta mapear» do ecrã Faturação vem de `GET /hub/invoicing`**, não do
  `issuer-options`: conta-se só com a base, sem ler o Moloni a cada abertura
  da página (poupa o limite de pedidos, §13.5).
- **Ao gravar, uma taxa do Moloni com outro valor que o do par é recusada**
  (ex.: a «Taxa Reduzida» de 6 % para «IVA 23 % · Portugal»). O desenho só
  pedia conferir que o id existe; um valor diferente é sempre um erro, e o
  teste da ligação não o apanha (§32.5). A zona fiscal não se confere: as
  regiões (Açores, Madeira) podem ter zonas próprias no Moloni, por medir.
- **O artigo e o cliente conferem-se por id** com `products/getOne` e
  `customers/getOne` (páginas do Moloni lidas a 13/10/2026), em vez de uma
  lista; o «Consumidor final» tem de ter o NIF 999999990 no Moloni.
- **Ao gravar, confere-se só o que muda** (revisão, P2-1), e só se aceitam
  taxas de IVA (P2-2).

**Encontrado pelo Moloni simulado:** a lista das isenções do Moloni
(`{code, name, description}`) tinha a mesma forma que um erro com
`human_errors` e o adaptador lia-a como erro. Um erro é agora só
`{code, description}` com o código a começar pelo número do erro (página
«Controlo de erros» do Moloni, lida a 13/10/2026).

**Revisão do #412** (agente da sessão, Sonnet 5.5; 0 P0, 1 P1, 6 P2, 12 P3):
- **P1-1, corrigido:** o que se pesquisa (`q` de `issuer-search`, que pode
  ser o NIF ou o nome de um cliente) sai tapado do registo da API.
- **P2-1, corrigido:** ao gravar, o servidor confere só o que muda; uma
  escolha antiga que o Moloni já não tem não impede de gravar o resto.
- **P2-2, corrigido:** só as taxas de IVA do Moloni (`saft_type` 1, como na
  leitura dos documentos) entram na lista e podem gravar-se.
- **P2-3, corrigido:** gravar já não desmonta o formulário; o foco vai para
  «Testar»; uma lista vazia não tem rótulo a apontar para texto.
- **P2-4, corrigido:** as leituras do Hub usam no máximo dois terços do
  limite por empresa e nunca esperam; o resto fica para as emissões.
- **P2-5, corrigido:** teste com a base de mercados em PT e ES, taxas antiga,
  vigente e futura, as regiões, uma categoria de outra entidade, um método de
  pagamento e credenciais recusadas (401) sem pôr a ligação com erro.
- **P2-6, não feito:** o Hub não tem testes que desenhem ecrãs (não há
  biblioteca para isso no repositório; acrescentá-la é outra decisão). Os
  estados ficam cobertos pelas capturas e pelas funções testadas.
- **P3 corrigidos:** 1 (só os mercados e os meios da entidade; sem
  categorias arquivadas), 4 (a mensagem segue o estado devolvido), 5 (o texto
  do `invalid_field`), 6 (o «Consumidor final» confere-se ao gravar, pelo
  NIF, sem o mostrar), 7 (criar outra quando a ligação está desligada), 8 (uma
  releitura falhada não apaga as escolhas), 10 (ler sem trancar a ligação),
  12 (uma entidade com sistema próprio não ganha ligação ao Moloni).
- **P3 que ficam:** 2 (só «hoje» e o fuso de Lisboa: a retenção apanha o
  resto), 3 (um método em falta não tem motivo de retenção próprio: rebenta
  na emissão como erro do emissor), 9 (o texto da lista vazia é o mesmo para
  todas as listas), 11 (como o Moloni responde a um id que não existe está
  por medir).

**Por fazer:**
- **Ler as listas na conta de teste do Moloni** antes de abrir isto a um
  comerciante: os campos exactos de cada resposta, se `taxes/getAll` traz
  `fiscal_zone` como o código do país, se `documentSets/getAll` e
  `paymentMethods/getAll` paginam acima de 50 (hoje lê-se só a primeira
  página). Precisa das credenciais no ambiente.
- **A passagem completa só com o teclado** (criar, ligar, configurar e
  testar): as listas e os botões são elementos nativos, mas não foi feita.
- **As capturas do ecrã Configurar** usam listas de exemplo servidas no
  navegador (as capturas não têm Moloni); o resto do ecrã é o verdadeiro.

## 33. Envios: «Expedir» — as expedições, a etiqueta e o seguimento (issue #393)

Pedido do Diogo, 13/10/2026: *«depois avança com o próximo passo dos
envios»*, depois de aprovar o aspecto do §31 (*«aprovo; junta quando ficar
verde»*). Desenho aprovado pelo Diogo a 13/10/2026 (*«sim, aprovo; avança
com o código»*).

A API já tem tudo:
- a vista do armazém (`docs/27` §6, `GET /fulfilment/orders`);
- as expedições (`docs/27` §3.7);
- a etiqueta e o seguimento (`docs/36` §4 e §7.1).

O Hub dá-lhes um ecrã para o trabalho de todos os dias no armazém. Skills:
`order-fulfilment`, `eurolify-transport-logistics-eu`, `eu-gdpr-privacy`,
`eurolify-design`, `eurolify-hub-modular`, `observability-security`.

Ex.: a Rita, do armazém, abre «Expedir» e vê a encomenda de ontem, paga,
com «Correio registado». Abre-a e vê as duas linhas (2 vernizes e 1 lima),
o nome, o telefone e a morada de quem recebe. Carrega em «Criar a
expedição», com tudo por expedir. Depois carrega em «Pedir a etiqueta»: a
etiqueta fica «Emitida», com o número de seguimento. A Rita descarrega o
PDF, imprime-o, cola-o na caixa e carrega em «Marcar como expedida».

### 33.1 O que entra e o que fica de fora

| Entra |
|---|
| **Um módulo «Expedir»** na entrada do Hub, para quem tem `fulfilment:read`: o dono, o gestor, o armazém e o apoio. |
| **As encomendas por expedir**, das mais antigas para as mais recentes, como a API as dá (no máximo 100 de cada vez). A lista diz quantas mostra e, se forem 100, que há mais. |
| **A encomenda na vista do armazém**: as linhas, com a quantidade e quanto já saiu; o método de entrega; quem recebe, com o nome, o telefone e a morada; e as expedições. **Sem** preços, NIF, e-mail nem perfil de faturação (`docs/27` §6). |
| **Criar uma expedição** (`fulfilment:write`: o dono, o gestor e o armazém). Escolhem-se as linhas e as quantidades, e por omissão vai tudo o que falta. O servidor recusa mais do que falta. |
| **A etiqueta**, quando o método tem conta: pedir, ver o estado (por pedir, a pedir, emitida, recusada com o motivo, incerta, anulada), descarregar o ficheiro, anular e «Consultar a transportadora» (uma etiqueta incerta nunca se pede outra vez às cegas, `docs/36` §4.1). |
| **O seguimento**: os eventos da transportadora, normalizados, com a data. |
| **O estado da expedição**, pelas transições da `docs/27` §3.7: «Marcar como expedida» (a saída do stock, com os lotes que o servidor escolhe: os que expiram primeiro; **com conta, só depois de a etiqueta estar emitida**); «Cancelar» uma criada que não saiu (**com uma etiqueta viva, anula-se primeiro**); e, **só num método «Manual»**, a transportadora e o seguimento escritos à mão e «entregue», «devolvida» ou «perdida». |

| Fica de fora, e porquê |
|---|
| **Escolher os lotes à mão:** o servidor escolhe os que expiram primeiro. Escolher outro lote vai para um pedido à parte. |
| **Mudar o serviço de uma expedição:** é uma decisão de uma pessoa, com motivo (`docs/27` R6). O ecrã não o oferecia; desde 13/10/2026 oferece-o, com a correcção do peso (`docs/36` §19). |
| **Imprimir ou pedir etiquetas em lote:** nesta parte, uma expedição de cada vez. |
| **Corrigir à mão o estado de uma expedição com etiqueta.** Nesse caso, quem decide «entregue» é o seguimento da transportadora (`docs/36` §4.2). O ecrã não oferece estes botões. |
| **O resto da encomenda:** os preços, o pagamento, a linha do tempo (`orders:read`), cancelar e as devoluções. Ficam para os ecrãs das encomendas e da pós-venda. |

### 33.2 Como o Hub lê e escreve

Segue o padrão do §29.2:
- a sessão da pessoa e o cabeçalho `Eurolify-Comerciante`;
- sem `Idempotency-Key` (`docs/21` §11);
- `cache-control: private, no-store`, também nos 403;
- quem escreve fica `pessoa:per_…` nos movimentos e na etiqueta (nas rotas
  da chave fica `chave:key_…`).

| Caminho do Hub | Âmbito | A rota da chave |
|---|---|---|
| `GET /hub/fulfilment/orders` | `fulfilment:read` | `GET /fulfilment/orders` |
| `GET /hub/fulfilment/orders/{id}` | `fulfilment:read` | `GET /fulfilment/orders/{id}` |
| `POST /hub/orders/{id}/shipments` | `fulfilment:write` | `POST /orders/{id}/shipments` |
| `PATCH /hub/shipments/{id}` | `fulfilment:write` | `PATCH /shipments/{id}` |
| `POST /hub/shipments/{id}/label` | `fulfilment:write` | `POST /shipments/{id}/label` |
| `GET /hub/shipments/{id}/label` | `fulfilment:read` | `GET /shipments/{id}/label` |
| `GET /hub/shipments/{id}/label/file` | `fulfilment:read` | `GET /shipments/{id}/label/file` |
| `POST /hub/shipments/{id}/label/void` | `fulfilment:write` | `POST /shipments/{id}/label/void` |
| `GET /hub/shipments/{id}/events` | `fulfilment:read` | `GET /shipments/{id}/events` |
| `POST /hub/shipments/{id}/refresh` | `fulfilment:write` | `POST /shipments/{id}/refresh` |

- **Os papéis não mudam:**
  - `fulfilment:write`: o dono, o gestor e o armazém;
  - `fulfilment:read`: também o apoio, que só vê.
- **Uma resposta perdida:**
  - Ao **criar uma expedição**, o ecrã relê a encomenda em vez de repetir.
    O servidor só recusa um segundo pedido que passe do que falta: uma
    expedição parcial repetida seria aceite. Por isso o ecrã diz para
    conferir as expedições antes de criar outra (revisão do #418, P2-2).
  - Ao **pedir uma etiqueta**, a etiqueta fica «a pedir» ou «incerta», e só
    «Consultar a transportadora» a resolve (`docs/36` R2).
- **O ficheiro da etiqueta** descarrega-se por um pedido com a sessão, e não
  fica em nenhuma cache. É um documento com dados pessoais: o ecrã diz que se
  apaga 30 dias depois de a expedição acabar (`docs/36` Q7).

### 33.3 O ecrã

| Ecrã | O que mostra | Estados além do normal |
|---|---|---|
| **Expedir** (`/expedir`) | Uma linha por encomenda (cartões no telemóvel): o número, a data, o estado («Paga», «Em preparação», «Expedida em parte»), o método de entrega, o número de artigos por expedir e a localidade. A contagem à vista. | nada por expedir; a carregar; erro; sem permissão; 100 mostradas (diz que há mais e que são as mais antigas) |
| **A encomenda** (`/expedir/{ord_…}`) | Quem recebe (o nome, o telefone e a morada) e o método. As linhas, com «por expedir» e «já saiu». O formulário «Criar a expedição», com uma quantidade por linha, preenchida com o que falta. As expedições, cada uma com o estado e a etiqueta. | tudo já saiu (sem formulário); recusa do servidor (mais do que falta, sem armazém, a encomenda não está para expedir); conflito; resposta perdida (relê); só ver |
| **A expedição**, dentro da encomenda | **Com conta:** a etiqueta (o estado, o motivo de uma recusa, o seguimento com a ligação pública da transportadora, o peso), «Pedir a etiqueta», «Descarregar a etiqueta», «Anular», «Consultar a transportadora», o seguimento e «Marcar como expedida». **Manual:** a transportadora e o seguimento escritos à mão, «Marcar como expedida» e depois «entregue», «devolvida» ou «perdida». Em ambos, «Cancelar» enquanto está criada. | etiqueta recusada (o motivo e o que fazer); incerta (não se pede outra; consultar); a transportadora sem resposta; sem `ENVIOS_CHAVE` no servidor; conflito; confirmação antes de cancelar, anular e marcar como perdida |

**Os textos** estão em PT, ES e EN. Cada estado tem uma cor, por token. Os
dados de quem recebe não vão para o título da janela.

### 33.4 Por onde é que isto ainda pode sair errado

- **Uma etiqueta paga duas vezes.** O servidor só deixa uma viva por
  expedição, e numa incerta só se pode consultar. O ecrã nunca repete o
  pedido sozinho.
- **Marcar como expedida sem a caixa ter saído** tira o stock. Pede-se
  confirmação, e o texto diz que a saída do stock não se desfaz pelo ecrã.
- **O telefone e a morada à vista** de quem tem `fulfilment:read`. É a vista
  mínima da `docs/27` §6. Nada vai para os registos nem para o
  armazenamento do navegador.
- **Nesta parte, as etiquetas não se imprimem em lote.** Uma loja com muitas
  encomendas vai precisar disso (pedido seguinte).

### 33.5 Antes de dizer que está feito (o pedido do código)

- **API:**
  - as rotas do Hub fazem o mesmo que as da chave;
  - o apoio leva 403 nas escritas;
  - a encomenda e a expedição de outro comerciante dão 404;
  - `no-store`, também nos 403 e no ficheiro;
  - o `quem` da pessoa nos movimentos e na etiqueta;
  - a vista sem preços, NIF nem e-mail (comparar as chaves exactas da resposta).
- **Hub:**
  - a passagem do exemplo contra a Sendcloud de ensaio, nos testes;
  - a etiqueta recusada, a incerta e o conflito;
  - o apoio só a ver;
  - capturas a 375, 768 e 1280 px, em claro e escuro, para o OK do aspecto.

### 33.6 Em código (13/10/2026)

- **API:**
  - as dez rotas do §33.2 estão em `src/envios/rotas-hub-expedir.ts`;
  - a sessão com o âmbito e a escrita com `eurolify.quem` passam a uma
    função partilhada (`ferramentasDoHub`, em `src/envios/rotas-hub.ts`);
  - a vista do armazém, os esquemas das expedições e as formas da etiqueta
    e dos eventos passam ao nível do módulo, para a chave e o Hub usarem os
    mesmos;
  - sem migração.
- **Hub:**
  - o módulo «Expedir» (`fulfilment:read`), antes de «Envios»;
  - `src/ecras/Expedir.tsx` e o apoio em `src/expedir.ts`;
  - o descarregamento da etiqueta usa um endereço `blob:` que se revoga
    logo a seguir;
  - o nome de quem recebe nunca vai para o título da janela.
- **Testes:**
  - `test/envios-hub-expedir.test.ts` (API, 3). A encomenda paga vem do
    cenário partilhado `test/envios-cenario.ts`, que passou a servir também
    o teste das etiquetas.
  - `test/expedir.test.ts` (Hub, 5).
- **Capturas:**
  - a lista vazia é contra a API verdadeira;
  - a lista com uma encomenda e a página da encomenda usam **respostas
    simuladas da API**, porque o ensaio não tem uma encomenda paga. Os dados
    são fictícios.
  - Nas capturas confere-se:
    - o título da janela sem o nome de quem recebe;
    - que, com a etiqueta emitida, não se pode pedir outra;
    - que uma quantidade a mais fica marcada no campo.
- **Sem prova:**
  - a passagem só com o teclado;
  - a etiqueta recusada e a incerta no ecrã (estão nos testes da API das
    etiquetas);
  - o apoio só a ver, nas capturas.

**Revisão do agente** (Claude Sonnet 5.5, publicada no #418): 0 P0, 2 P1 e
7 P2.

**Corrigido:**
- **P1-1:** o mapa dos erros do ecrã usa os códigos que o servidor dá
  (`shipments.*`, `orders.invalid_transition`). Um teste confere que cada
  código do mapa existe no servidor. Para isso, os códigos do stock
  passaram a `src/stock/erros.ts`, um ficheiro sem dependências.
- **P1-2:**
  - com conta, «Marcar como expedida» só aparece com a etiqueta emitida;
  - «Cancelar» não aparece com uma etiqueta viva (emitida, incerta ou a
    pedir), e o ecrã diz que se anula primeiro;
  - um teste da API confere a recusa do servidor.
- **P2-1:** um erro ao reler a página mostra-se também quando já há dados,
  com «Tentar outra vez». O texto da resposta perdida já não diz que releu.
- **P2-2:** a afirmação sobre a resposta perdida foi corrigida aqui, no
  código e no teste. Um teste documenta que uma expedição parcial repetida
  é aceite.
- **P2-3:** uma falha ao ler a etiqueta tem «Tentar outra vez».
- **P2-4:** a confirmação de «perdida» já não diz de quem é a perda
  (era uma regra sem fonte).
- **P2-6:**
  - chaves exactas também no detalhe, em quem recebe e nas linhas;
  - o isolamento cobre todas as rotas, sem condição;
  - `no-store` nos 404.
- **P2-7:** o texto de anular diz «antes de marcar como expedida, e se a
  transportadora deixar».
- **P3-1, P3-2 e P3-5:**
  - o ficheiro já apagado tem texto próprio;
  - a ligação do seguimento só se abre com `https://`;
  - a lista dos eventos tem estilo.

**Fica, declarado:**
- **P2-5:** pedir, anular e consultar a etiqueta exigem o `quem`, mas a
  base não o guarda em nenhuma tabela. Está provado na expedição, na saída
  do stock e na transição da encomenda.
- **P2-6 (d):** a passagem do exemplo contra a Sendcloud de ensaio não está
  nos testes. A API usa a transportadora de ensaio (CTT), com o contrato
  inteiro.
- **P3-3, P3-4, P3-6 e P3-7:**
  - as leituras da etiqueta sem guarda de ordem;
  - o 400 de validação sem `no-store`;
  - o espanhol nos códigos sem texto;
  - «entregue» sem confirmação.

## 34. Pagamentos: a fila de diferenças no Hub (issue #287)

Pedido do Diogo, 14/10/2026 (*«sim, avança com o desenho»*). **Aprovado pelo
Diogo a 14/10/2026**, com a Q1 em a) (*«sim, aprovo o desenho com a Q1 em
a)»*: autenticação recente sempre; `docs/06`, ES).

É a porta P2-6 do `docs/26` («Portas antes do modo real»): a fila de
diferenças resolve-se no Hub, por uma pessoa com sessão. Hoje só se resolve
pela integração, com a chave do dono:

- `GET /payment-issues`;
- `POST /payment-issues/{id}/resolve` (`apps/api/src/pagamentos/rotas.ts`).

A lista «A decidir» (§28) já mostra cada diferença (`fila_pagamento`), com o
motivo, o dono e o prazo, mas não tem para onde levar quem a quer resolver.

Skills: `payments-psd2-sca`, `eurolify-finance-reconciliation-eu`,
`eurolify-payment-readiness-eu`, `headless-commerce`, `eurolify-design`,
`eurolify-hub-modular`, `eurolify-hub-glass-responsive`,
`eurolify-hub-quality-gate`, `observability-security`, `eu-gdpr-privacy`.

Ex.: a EuPago avisa um pagamento de 24,90 € para a encomenda ord_…7c1d, que
esperava 29,90 €. Fica uma diferença «montante diferente» na fila, e a dona
da «Loja Exemplo» vê-a em «A decidir». Carrega nela e vê:

- esperado 29,90 €, recebido 24,90 €;
- o método (MB WAY) e o estado do pagamento.

Confirma no back-office da EuPago que o cliente pagou mesmo 24,90 € e
escreve «Cliente pagou menos 5 €; combinado pagar a diferença por
transferência». Confirma com a passkey. A diferença fica «Resolvida a
14/10/2026, por si», com o texto.

### 34.1 O que entra e o que fica de fora

| Entra |
|---|
| **A lista das diferenças** abertas, e as resolvidas num separador, por ordem de chegada: o motivo em linguagem comum, a prova (montantes, moedas, estados; nunca dados do cliente) e o pagamento a que se refere |
| **Resolver uma diferença** (só o dono, `payments:resolve`), com o texto da resolução, obrigatório |
| **Num pagamento incerto, decidir se foi pago** (`capturado`) ou não (`falhado`), depois de ver a conta no prestador. A base já obriga a decidir (revisão do #288, P2-2) |
| **A ligação a partir de «A decidir»**: cada diferença leva a esta página |

| Fica de fora, e porquê |
|---|
| **Reconciliar um reembolso** (`reembolso_incerto`, `reembolso_por_confirmar`, `reembolso_desconhecido`). O estado do reembolso decide-se na pós-venda (`POST /refunds/{id}/reconcile`, `docs/30` §13, P7). Aqui só se fecha a diferença com o texto, como hoje pela API; a página diz isso. |
| **Contas e métodos de pagamento** (as credenciais da EuPago, a régua). Outro ecrã, com as outras portas do `docs/26`. |
| **Consultar o prestador a partir do Hub** (`POST /payments/{id}/check`). Fica para depois: a consulta já corre sozinha de minuto a minuto. |
| **Resolver várias de uma vez.** Cada diferença é um caso, e decide uma pessoa (`AGENTS.md`, «Não se erra em documentos fiscais», regra 5). |

### 34.2 Como o Hub lê e escreve

As rotas pelo Hub fazem **o mesmo** que as da chave. Usam a sessão, o
comerciante no cabeçalho `Eurolify-Comerciante` e o `eurolify.quem` da pessoa
(`pessoa:per_…`), como em «Faturação» (§30.2).

| Caminho | Quem | O que faz |
|---|---|---|
| `GET /hub/payment-issues?estado=aberta\|resolvida` | a sessão com `payments:read` (dono, gestor, apoio) | a mesma `listarDiferencas`, mais o resumo do pagamento de cada uma (encomenda, método, montante, moeda e estado), para o ecrã não pedir um a um |
| `POST /hub/payment-issues/{id}/resolve` `{ resolucao, pagamento? }` | `payments:resolve` (só o dono), **autenticação recente** (Q1) | a mesma `resolverDiferenca`; o `resolvida_por` passa a ser a pessoa |

- **O prazo de espera e as respostas perdidas**, como nas outras escritas do
  Hub (5 s, depois 503). Ao resolver, relê a lista: se a diferença já
  aparecer resolvida, dá-a por feita.
- **Um processo automático continua sem resolver**: a rota pede uma sessão de
  pessoa, e a base só aceita `pessoa:…` ou `chave:…` em quem resolve
  (`0044_pagamentos.sql`, gatilho da diferença).

### 34.3 O ecrã

| Onde | O que mostra | Estados além do normal |
|---|---|---|
| **Entrada** (`/`) | Um módulo «Pagamentos» na grelha, para quem tem `payments:read`: dono, gestor e apoio; o armazém não o vê. Com diferenças abertas, o número delas. **No código (§34.7), aceite pelo Diogo a 14/10/2026:** o rótulo é «Diferenças de pagamento» e o número não se mostra. | — |
| **Diferenças de pagamento** (`/pagamentos/diferencas?comerciante=…`) | Dois separadores: «Por resolver» e «Resolvidas». Cada diferença: o motivo (texto, regra 3), quando chegou, a encomenda (os últimos 4 caracteres à vista), o método, o montante e o estado do pagamento. Mostra também a prova em linguagem comum, como «esperado 29,90 €, recebido 24,90 €» ou «passou de autorizado a cancelado». As resolvidas mostram o texto, quem e quando. Para o dono, em cada aberta, o botão «Resolver». Tabela a partir de 768 px, cartões abaixo (regra 5). | a carregar; erro com «Tentar outra vez»; sem diferenças («Não há diferenças por resolver.»); comerciante errado (como nas outras páginas); sem `payments:resolve` (só leitura, sem botões) |
| **Resolver** (diálogo) | O resumo da diferença e o campo «O que se fez» (obrigatório, até 2000 caracteres). Num **pagamento incerto**: «O cliente pagou?» com «Sim, foi pago» e «Não, não foi pago», obrigatório, e a frase «Confirme no back-office do prestador antes de decidir. Se disser que foi pago, a encomenda passa a paga e segue para a fatura.» Num **reembolso**: «O estado do reembolso decide-se na devolução. Aqui só fica registado o que se fez.» Confirmar pede a autenticação recente (Q1). | `payments.invalid_transition` (o pagamento já não está incerto: «O pagamento mudou entretanto; feche e abra outra vez.»); `payments.immutable` (já resolvida por outra pessoa: dá-a por feita e relê) |
| **A decidir** (§28) | Cada linha `fila_pagamento` passa a levar a «Diferenças de pagamento», com a diferença aberta. | — |

Textos em português, espanhol e inglês. A prova mostra-se pelos campos que a
API já grava (montantes, moedas, estados, referências do prestador). Nunca
mostra o corpo do aviso, que pode trazer o telefone do MB WAY (`docs/26` §7).

### 34.4 Testes (no código)

- **API:**
  - o dono resolve, com o texto e a pessoa no `resolvida_por`;
  - num incerto, sem decidir dá erro; com «capturado», a encomenda fica paga;
  - o gestor e o apoio lêem e não resolvem; o armazém não lê;
  - outro comerciante não vê nem resolve (404);
  - sem autenticação recente, recusa (Q1);
  - a lista não traz o corpo dos avisos.
- **Hub:**
  - a lista e os dois separadores;
  - o diálogo nos três casos (normal, incerto, reembolso);
  - o erro de já resolvida;
  - as capturas em telemóvel, tablet e computador, nos temas claro e escuro.

### 34.5 Pergunta para o Diogo ou o Bruno

**Q1. Resolver uma diferença pede autenticação recente (a passkey outra vez,
se a última foi há mais de 10 minutos)?**

- **a) Sempre** ⭐: resolver fica no registo como decisão de uma pessoa sobre
  dinheiro. Num incerto, «foi pago» põe a encomenda paga e acorda a fatura.
  É a regra de «fechar um período» na Faturação (§30.2).
- **b) Só num pagamento incerto:** é o único caso em que a resolução muda o
  estado do dinheiro; nos outros, só se escreve o que se fez.

### 34.6 O que fica por verificar

- A prova de cada motivo em linguagem comum: as chaves que a API grava em
  cada caso (`apps/api/src/pagamentos/repositorio.ts`) leram-se no código.
  Uma chave nova num motivo futuro aparece como texto em bruto até haver
  tradução.
- Os textos em espanhol e inglês saem do português aprovado; não são
  aprovados palavra a palavra.

### 34.7 Em código (14/10/2026; ES)

- **API (`apps/api/src/pagamentos/`):**
  - `GET /hub/payment-issues?estado=` faz o mesmo que `GET /payment-issues`,
    pela sessão com `payments:read`, e junta o resumo do pagamento de cada
    diferença (`diferencasParaOHub`);
  - `POST /hub/payment-issues/{id}/resolve` faz a mesma
    `resolverDiferenca`, com `payments:resolve` e autenticação recente
    sempre (Q1 «a»), e o `resolvida_por` é a pessoa.
- **Hub (`apps/hub/src/`):**
  - o ecrã `DiferencasPagamento.tsx` (`/pagamentos/diferencas`), com os dois
    separadores e o diálogo de resolver;
  - as regras do ecrã em `pagamentos.ts`: a prova em linguagem comum por
    motivo, o caso do diálogo (incerto, reembolso, normal) e o endereço;
  - o módulo «Pagamentos» na entrada, para `payments:read`;
  - a ligação a partir de «A decidir» (fila `pagamento`).
- **Textos novos em pt, es e en:**
  - os três motivos de reembolso, que antes saíam como código também em «A
    decidir»;
  - os estados do pagamento em palavras.
- **Dois desvios do desenho, aceites pelo Diogo a 14/10/2026** (*«sim, aceito
  os dois desvios»*; revisão do #458, P2-4):
  - **o número no módulo:** a entrada não mostra o número de diferenças
    abertas. Nenhum módulo da entrada mostra números hoje, e isso pedia mais
    uma leitura à API em cada abertura da entrada. O número vê-se em «A
    decidir»;
  - **o rótulo do módulo** é «Diferenças de pagamento», não «Pagamentos»:
    com a letra do navegador a 32 px e o ecrã a 375 px, «Pagamentos» não
    cabe numa linha e partia a palavra, o que as capturas recusam. Duas
    palavras quebram entre elas. É também o título do ecrã.
- **Testes:**
  - API: `pagamentos-api.test.ts`, «pelo Hub»: os papéis, outro comerciante,
    sem autenticação recente, o incerto obrigado a decidir, a pessoa em
    quem resolveu e a encomenda paga;
  - Hub: `test/pagamentos.test.ts` e `test/modulos.test.ts`;
  - capturas: a lista lida da API verdadeira, a lista e as resolvidas em
    375, 768 e 1280, claro e escuro, e o diálogo de um incerto.
- **Revisão do agente (Sonnet 5.5, #458), sem P0 nem P1:**
  - **P2-1:** o aviso do diálogo num reembolso passa a dizer que o reembolso
    se decide pela integração e que um reembolso incerto continua na fila
    «Reembolso» de «A decidir» (lido na 0066: a fila lista os `incerto` e
    `falhado`);
  - **P2-2:** testes novos da API: o dono de uma loja com o cabeçalho de
    outra, «não foi pago» pelo Hub, a resolução só com espaços, a cache e a
    ordem das resolvidas. **Fica por fazer:** o Hub não tem testes de
    componentes em nenhum ecrã, por isso o diálogo, o «já resolvida» e a
    resposta perdida só se vêem nas capturas e por leitura;
  - **P2-3:** as resolvidas vêm das mais recentes, só as últimas 200, e o
    ecrã di-lo quando chega a esse número;
  - **P2-4:** os dois desvios acima, aceites;
  - **P3-2, P3-3, P3-4, P3-5, P3-6 e P3-7, corrigidos:** a lista sem cache;
    o comentário trocado no `api.ts`; o `docs/26` em dia; só espaços
    recusado nas duas rotas; «Cancelar» desligado durante o envio e os
    rádios com `aria-required`; o erro de uma releitura não esconde a lista;
  - **ficam:** P3-1 (o `daSessao` repetido da faturação), P3-8 (o
    `payments.immutable` lido sempre como «já resolvida») e P3-9 (uma chave
    com `payments:resolve` resolve pela rota antiga; é anterior).


## 35. Encomendas: lista e ficha (issue #475, Peça 14)

**Estado:** desenho escrito sob a autorização geral do Diogo de 16/10/2026
(avançar sem consultar a cada passo); **o aspecto fica à espera do OK dele no
pedido**.

É a Peça 14 da Fase 1 (`docs/10` §6.1: «sem ecrãs de encomendas nem de
definições»). A API das encomendas já existe (`docs/27`; `GET /orders`,
`GET /orders/{id}`, `GET /orders/{id}/timeline`, `orders:read`) e o Hub tem
só a vista do armazém («Expedir», §33), que não mostra preços, nem contacto,
nem faturação. Falta ao dono, ao gestor e ao apoio ver uma encomenda inteira.

Skills seguidas: `eurolify-design`, `eurolify-hub-modular`,
`eurolify-hub-glass-responsive`, `eurolify-hub-quality-gate`,
`order-fulfilment`, `eu-gdpr-privacy`.

Ex.: o apoio da «Loja Exemplo» recebe uma pergunta sobre a encomenda de
16/10/2026 às 10:12, terminada em …7c1d. Abre «Encomendas», filtra por «Paga»,
carrega nela e vê dois artigos, o total de 29,59 € (base, IVA e portes), a
morada de entrega, o método de pagamento (MB WAY), o estado do documento
fiscal e o rasto: «à espera de pagamento → paga, o prestador de pagamentos,
10:13».

### 35.1 O que se mostra e a quem

| Entra | Quem |
|---|---|
| **A lista** (`GET /hub/orders`): a data, o fim do identificador, o estado e o total; as 100 mais recentes; filtro por estado. **Sem nome, e-mail, telefone, morada nem NIF** | `orders:read`: o dono, o gestor e o apoio |
| **A ficha** (`GET /hub/orders/{id}`): estado, linhas (artigo, SKU, quantidade, preço unitário, IVA, total), totais (base, IVA, portes, total), método de pagamento, entrega (método, data-limite que o cliente viu, morada ou ponto de recolha), contacto, faturação (quem emite, estado do documento, cópia do perfil) | `orders:read` |
| **O rasto** (`GET /hub/orders/{id}/timeline`): cada mudança de estado, quando e por quem (nome da pessoa, «chave de API», «cliente», «prestador de pagamentos»…), com o motivo | `orders:read` |
| Uma ligação para a vista do armazém (§33) | quem tem `fulfilment:read` |

**Fica de fora:** qualquer acção. Cancelar, expedir, reembolsar, corrigir a
morada ou emitir documentos **não são deste ecrã**: expedir faz-se em
«Expedir» (§33), as devoluções em «Devoluções» (`docs/36` §22.10), as
diferenças de pagamento em §34, e o resto continua pela API. **Nenhuma
acção nova de negócio.**

**O armazém não vê o módulo** (`orders:read` não está no papel, `docs/21` §5;
a encomenda traz o contacto e a faturação): tem «Expedir». O módulo, como os
outros, esconde-se por `ambitoNecessario`, mas **esconder não é autorizar**:
a API recusa com 403 (`member.role_escalation`) a quem não tem `orders:read`.

### 35.2 Como o Hub lê (uma regra, um sítio)

- **Três rotas de sessão, só de leitura**, em `apps/api/src/checkout/
  rotas-hub-encomendas.ts`, a chamar **as mesmas funções** das rotas da
  chave (`listarEncomendas`, `lerEncomenda`, `paraEncomenda`,
  `transicoesDaEncomenda`), com o mesmo âmbito. A única novidade da API é o
  filtro `?estado=` na lista (um `where` na mesma consulta) e o `limite` na
  resposta, para o ecrã dizer «as 100 mais recentes» em vez de cortar em
  silêncio.
- **O estado vem da API.** O Hub só escolhe o texto de cada um dos onze
  (`a_aguardar_pagamento`, `paga`, `em_preparacao`, `expedida_parcial`,
  `expedida`, `entregue`, `concluida`, `cancelada_sem_pagamento`,
  `cancelada`, `devolvida_parcial`, `devolvida`); um estado que o Hub não
  conhece sai como a API o deu.
- **Os totais e o IVA vêm da API.** O Hub não soma, não arredonda e não
  escolhe taxas: mostra `totais`, `base`/`iva`/`total` de cada linha e,
  da decisão de IVA gravada na linha, a taxa (`tributada`, em centésimas de
  ponto), «Isenta» ou «Sem decisão de IVA» (`bloqueada`). Uma decisão que
  não percebe diz «IVA não legível» e não inventa.
- **Os montantes são cêntimos** (como em §25.3); formata-se pela moeda da
  encomenda. Moedas com outras casas decimais: **não verifiquei**.
- **A cópia do perfil de faturação** segue a regra da API: numa ficha
  pseudonimizada por um pedido de apagamento, só sai com `customers:billing`
  (o dono; `docs/23` §15.13). O Hub não decide: se vier nula e a ficha estiver
  guardada por obrigação fiscal, diz «Reservado ao dono».
- **Sem cache:** as três respostas levam `Cache-Control: private, no-store`
  (têm dados pessoais), também num 403.
- **O estado do documento fiscal** mostra o registo do Eurolify e diz-o no
  próprio ecrã: *«a prova do que saiu é o documento emitido, não este
  registo»* (regra fiscal 4). O Hub não decide se há ou não documento.

### 35.3 O ecrã

- **Entrada:** módulo «Encomendas» (`/encomendas?comerciante=…`), entre «A
  decidir» e «Expedir». Ícone: um saco de compras, desenhado no código.
- **Lista:** título «Encomendas — {loja}»; o filtro «Estado» (um `select`
  com rótulo); a frase da contagem (`role="status"`: nenhuma, uma, várias, ou
  «as 100 mais recentes»); a tabela com *Encomenda* (ligação «Encomenda de
  {data}» e o fim do identificador), *Estado* e *Total*.
- **Ficha** (`/encomendas/ord_…?comerciante=…`): título «Encomenda de
  {data}»; o estado e o fim do identificador; quatro cartões — *Artigos*
  (tabela), *Totais*, *Entrega* (e *Contacto do cliente*) e *Faturação* —
  e o *Rasto da encomenda* (lista ordenada por data).
- **Estados e cores:** o nome do estado vai sempre escrito; a cor é um reforço
  (os mesmos tokens de §33: espera, em curso, saiu, problema), nunca o único
  sinal.
- **Vazio, a carregar, erro:** «Ainda não há encomendas.» / «Não há
  encomendas neste estado.»; «A carregar…»; uma encomenda que não existe ou é
  de outra loja diz «Esta encomenda não existe, ou não é desta loja» (404;
  nunca se distingue «não existe» de «é de outro comerciante»). Se o rasto
  falhar, a ficha fica e o cartão do rasto di-lo.
- **Mobile (375 px):** a tabela vira cartões com o rótulo de cada célula
  (`data-rotulo`, o padrão `.tabela-larga`, que vale até 60 em ≈ 960 px); os
  cartões da ficha empilham-se; as moradas e os identificadores partem em
  qualquer sítio (`overflow-wrap`). **Tablet (768 px):** o mesmo padrão em
  cartões, com mais largura. **Desktop (1280 px):** a coluna de leitura do Hub,
  tabelas em tabela.
  Vidro funcional como nos outros ecrãs, com o alternativo opaco.
- **Acessibilidade:** um só `h1`; secções com `aria-labelledby`; cabeçalhos de
  tabela com `scope`; a ligação de cada encomenda leva o fim do identificador
  no nome (duas encomendas no mesmo minuto não se confundem); datas em
  `<time>`; o contacto em ligações `mailto:` e `tel:`; o foco do filtro não se
  perde ao mudar de estado; sem informação só pela cor; texto a 200 %.

### 35.4 Dados pessoais (`eu-gdpr-privacy`)

- **A lista não tem dados pessoais**, nem o título da janela. O cliente é
  um identificador interno que nem se mostra.
- **A ficha tem o contacto, a morada e o NIF**, que a rota da chave já dá a
  quem tem `orders:read`; o Hub não alarga o acesso: só mostra o que a API dá,
  com `no-store`. Nada disto vai para o endereço, para o armazenamento do
  navegador nem para a pesquisa de módulos.
- **O rasto** mostra o nome de quem fez só se for membro da equipa; uma chave
  mostra «Chave de API» e **nunca o identificador**; o cliente aparece como
  «Cliente».
- O texto do **motivo** de uma transição mostra-se como a API o dá: é texto
  do sistema ou de quem decidiu; **não verifiquei** se algum motivo futuro
  pode trazer dados de um cliente (ver 35.6).

### 35.5 Por onde é que isto ainda pode sair errado

| Risco | O que o desenho faz |
|---|---|
| O Hub mostrar um valor refeito e diferente do que o servidor decidiu | Só se mostram `totais` e os `base`/`iva`/`total` gravados; testes do Hub conferem que a decisão de IVA não se percebe ⇒ não se inventa |
| O armazém ver o contacto e a faturação por esta rota | A rota recusa 403 sem `orders:read` (teste na API que falha sem a protecção); o módulo esconde-se, mas a API é que decide |
| Uma encomenda de outro comerciante | A leitura passa por `comComerciante` (RLS); teste: a lista de B não tem a de A, e a ficha e o rasto de A dão 404 a B; uma sessão de B com o cabeçalho de A não passa |
| Uma lista cortada em silêncio | A API manda o `limite`; ao chegar a ele o ecrã diz «as {n} mais recentes» |
| A lista antiga com outro filtro | Mudar o filtro limpa a lista e ignora respostas atrasadas (`ultimo`) |
| Uma resposta guardada em cache com dados pessoais | `private, no-store` também no 403 |
| Um 404 que revele que a encomenda existe noutra loja | A mesma mensagem para as duas |
| «Documento emitido» lido como prova fiscal | O ecrã diz que é o registo do Eurolify; a prova é o documento (regra fiscal 4) |
| Um estado novo na API sem texto no Hub | Sai o código; o teste `encomendas.test.ts` obriga os onze de hoje a ter texto nas três línguas. **Fica:** nada avisa quando a API ganhar um décimo segundo |
| Uma acção por engano | Não há botões de escrita; teste: POST/PUT/PATCH/DELETE na encomenda dão erro |

### 35.6 O que não verifiquei

- **O aspecto** (cores, densidade, ordem dos cartões): à espera do OK do
  Diogo; as capturas dizem se cabe, não se agrada.
- **Moedas** que não o euro: o formato usa o `Intl`; não se conferiu uma a
  uma (como em §25.3).
- **Os motivos** das transições com texto livre: lido que o sistema grava
  texto próprio; não procurei todos os sítios que gravam motivo.
- **A percepção de «estado do documento»** por um comerciante real: sem
  pesquisa com comerciantes.
- **Leitor de ecrã real** (NVDA/VoiceOver): só por leitura do marcado e pelos
  papéis; **teclado** só pelas capturas e pelo marcado.
- **Encomendas com muitas linhas** (mais de dezenas): a ficha mostra todas.
- **Pagamento e reembolso na ficha:** não se mostram (o pagamento está em §34
  e as devoluções em «Devoluções»); ficam para depois, se o Diogo quiser.

### 35.7 Pergunta para o Diogo ou o Bruno

**Q1.** O apoio vê a ficha com o NIF e a morada de faturação (como a rota da
chave já permite). Querem que o NIF só saia ao dono (`customers:billing`) mesmo
numa ficha normal, para cumprir à risca a minimização de dados? Muda uma linha
na API; o ecrã já aguenta o campo em falta. **Recomendado: sim**; fica a decisão de quem tem o papel de apoio a ver o NIF
ao atender.
