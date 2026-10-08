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
| Entrar com passkey | Entrar com palavra-passe + TOTP (B3b; as rotas existem) |
| Aceitar um convite e criar a conta (nome + passkey) | Aceitar um convite com uma conta que já existe (`/hub/invitations/accept`) |
| Escolher o comerciante (quem é membro de vários) | Mudar de papel, tirar da equipa (rotas existem) |
| Equipa: ver membros e convites em aberto; convidar; cancelar um convite | Passkeys, sessões abertas, códigos de recuperação, recuperar a conta, chaves de API (B3: desenho na §9, 08/10/2026) |
| Sair | A montra, o checkout e o resto do Hub |

Cada ecrã só mostra o que o servidor decide: o papel, o que se pode fazer e
os erros vêm da API (`eurolify-design`, regra 8). O Hub não guarda nada no
navegador além do cookie da sessão (que nem lê: é `HttpOnly`) e da língua
escolhida.

## 2. Onde vive

| O quê | Proposta |
|---|---|
| Código | `apps/hub`: React + Vite, ficheiros estáticos (ADR-0025) |
| Anfitrião | `hub.eurolify.eu` (decidido com a publicação, §7): o nginx serve os ficheiros estáticos e encaminha `/hub/*` para a API — o mesmo anfitrião, por isso o cookie `__Host-` e o `SameSite=Strict` funcionam sem CORS (`docs/21` §3) |
| Caminhos das páginas | `/entrar`, `/convite`, `/equipa`; nunca debaixo de `/hub/`, que é da API |
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
| **Aceitar convite** (`/convite#…`) | «Foi convidado para trabalhar no Hub», campo «O seu nome» (1 a 100 caracteres), botão «Criar a conta com uma passkey» | `POST /hub/invitations/accept/options` → navegador → `POST /hub/invitations/accept-new` | sem segredo na ligação; convite que não vale (a mesma mensagem para expirado, usado, cancelado ou inexistente — a API não distingue, de propósito); o e-mail já tem conta (`invite.account_exists`: aceitar com uma conta existente fica para depois — §1 — e o ecrã diz isso e manda falar com quem convidou); nome inválido; a carregar; 429. **Depois de criar a conta**, os 10 códigos de recuperação que a API devolve, **uma vez**: «Copiar», o aviso de que não voltam a aparecer e um botão «Já os guardei» antes de seguir (`docs/21` §7) |
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
| O site | `infra/vps/ficheiros/nginx-hub.conf` | os estáticos, `/hub/` para a API com o `X-Forwarded-For` reescrito pelo nginx — só se o pedido original começar por `/hub/`, e com o caminho já normalizado (revisão do #160, P1-1: `/products/a%2F..%2F..%2Fhub%2Fb` chegava à rota `/products`); `try_files $uri /index.html` para `/entrar`, `/convite`, `/equipa`; `index.html` sem cache, `assets/` com cache longa; cabeçalhos: CSP (`default-src 'self'`, `frame-ancestors 'none'`), HSTS, `Referrer-Policy: no-referrer`, `nosniff`, `Permissions-Policy`. Liga-se só com o certificado e o `nginx -t`; se falhar, desliga-se outra vez |
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
| **A minha conta** (`/conta`, ligação no cabeçalho) | três blocos: Passkeys, Sessões abertas, Códigos de recuperação | os de cada bloco | sem sessão (vai para `/entrar`); a carregar; erro por bloco (um bloco que falha não esconde os outros) |
| **Passkeys** | nome, criada em, último uso (ou «nunca»); a contagem; o conselho de ter duas (`docs/21` §7: o Hub pede para registar duas) quando só há uma | `GET /hub/passkeys` | — |
| **Acrescentar passkey** | campo «Nome desta passkey» (ex.: «Telemóvel»; 1 a 100), botão | `POST /hub/passkeys/options` → navegador → `POST /hub/passkeys` | autenticação recente (§3); cancelada pela pessoa (sem vermelho); passkey já registada neste dispositivo; sem suporte |
| **Retirar passkey** | botão por passkey, com confirmação que diz que **todas as sessões terminam** (as outras; esta continua) | `POST /hub/passkeys/{id}/remove` | é a última forma de entrar (a API recusa: o ecrã explica que é preciso outra passkey ou a palavra-passe primeiro); autenticação recente |
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

**Falta na API:** o `/hub/me` não diz se a pessoa tem a palavra-passe
activa. Proposta: um campo `palavra_passe: "activa" | "pendente" | null`
(sem nenhum dado secreto), no mesmo pedido da B3b, com teste.

**Por decidir (Diogo ou Bruno), antes da B3b:** o segredo do autenticador
mostra-se **só como texto** (escreve-se à mão na aplicação; nenhuma
biblioteca nova) ou também **como código QR** (mais simples para quem
configura; uma biblioteca nova no Hub, a escolher e a rever).

### 9.3 B3c — chaves de API

| Ecrã | O que mostra | Rotas da API | Estados |
|---|---|---|---|
| **Chaves** (`/chaves?comerciante=mer_…`, ligação ao lado de «Ver a equipa», só para o dono) | as chaves do comerciante: nome, tipo (servidor ou pública), âmbitos, prefixo, criada em/por, expira, estado | `GET /hub/keys` | sem permissão (403, o ecrã não oferece a quem não é dono); vazio |
| **Criar chave** | nome, tipo, âmbitos (só os que o papel tem), expira (opcional); depois, **o segredo uma vez**, com Copiar e aviso | `POST /hub/keys` | autenticação recente; âmbitos acima do papel (a API recusa) |
| **Revogar** | botão por chave activa, com confirmação | `POST /hub/keys/{id}/revoke` | autenticação recente; já revogada |

### 9.4 O que não muda

- Nada disto mexe nas regras: a API e a base decidem; os ecrãs só não
  oferecem o que vai ser recusado e mostram a recusa.
- Os segredos (códigos, segredo do autenticador, segredo da chave) nunca vão
  para o URL, o armazenamento do navegador nem os registos; mostram-se uma
  vez e o ecrã esquece-os ao sair.

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
