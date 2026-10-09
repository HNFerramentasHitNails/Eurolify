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

- **O nome do canal e do mercado** de cada publicação: a API só dá os
  identificadores (`chn_…`, `mkt_…`) e não há rota que dê os nomes
  (procurei `/markets`, `/channels` e `/stores` em `apps/api/src`, 09/10). A
  ficha mostra «Canal» e «Mercado» com o identificador (sem o inventar em
  nome) até a API os dar — **a pedir ao dono do domínio Preços e mercados**
  (`docs/20`); os nomes nunca se escrevem à mão no ecrã.
- **O preço**: é do domínio Preços (`docs/20`), sem rota de leitura por
  artigo para o Hub.
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
| **Alterar uma variante** (peso, GTIN, conteúdo, dimensões): **não há rota nem função** (`docs/14` §7.1: «Falta `PATCH /variants/{id}` … desenha-se antes do código»). É o que resolve o impedimento `peso_em_falta`. **A pedir ao dono do Catálogo (#77)**; o Hub junta-se quando existir. |
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
| `pessoa:per_…` de quem **é ou foi** membro deste comerciante | `{ tipo: "pessoa", nome }`, o nome da conta (pseudonimizada: «Pessoa pseudonimizada», que é o que fica guardado, `docs/21` §13 ponto 7) | o nome |
| `pessoa:per_…` que nunca foi membro deste comerciante | `{ tipo: "pessoa", nome: null }` | «Pessoa de fora desta equipa» (não devia acontecer; não se mostra o nome de quem não é da equipa) |
| `chave:key_…` deste comerciante | `{ tipo: "chave", nome }`, o nome da chave | «Chave «{nome}»» |
| `chave:key_…` que não é deste comerciante, ou apagada | `{ tipo: "chave", nome: null }` | «Chave de API» |
| `sistema:<tarefa>` ou `catalogo:<motivo>` | `{ tipo: "sistema", nome: null }` | «Automático»; com `catalogo:verificacao_falhou`, «Automático» e, na publicação, o motivo com o texto que a ficha já usa («Deixou de cumprir as regras de publicação», `textos/pt.ts` linha 404) |
| outro valor | `{ tipo: "outro", nome: null }` | o valor guardado, tal como está |

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
| `publicacao` | «uma publicação» (canal e mercado pelo identificador, como a ficha, §12.2) |
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
