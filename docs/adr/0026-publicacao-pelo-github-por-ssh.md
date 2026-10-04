# ADR-0026 · Publica-se no ensaio pelo GitHub por SSH, com as imagens construídas no GitHub

- **Estado:** aceite · põe em prática o [ADR-0005](0005-publicacao-pelo-github.md)
  (ponto 1) e o [ADR-0014](0014-um-so-ensaio.md) na VPS do
  [ADR-0015](0015-alojamento-numa-vps.md)
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** `docs/11-preparacao-da-vps.md` §7, ponto 6
  (Coolify ou o GitHub por SSH); A4 do pedido de 04/10/2026

## Contexto

- A Coolify pede no mínimo 2 núcleos, 2 GB e 10 GB de disco
  (`coolify.io/docs`, por resumo, 03/10/2026; memória da VPS) e traz uma
  página de administração onde quem chega primeiro ao registo fica
  administrador. A VPS do ensaio é uma VPS-1 com 3,7 GiB sem swap (ADR-0021).
- O GitHub Packages (GHCR) só aceita, para autenticar, *«a personal access
  token (classic)»*; para puxar imagens chega o âmbito `read:packages`; dentro
  do GitHub Actions serve o `GITHUB_TOKEN`; uma imagem pode puxar-se pelo
  resumo (`@sha256:…`) — `docs.github.com`, *Working with the Container
  registry*, lido a 04/10/2026.
- Ter um utilizador no grupo `docker` equivale a dar-lhe root na máquina
  (conhecimento prévio; a documentação do Docker não foi relida a 04/10/2026).

Inclinação do Diogo no pedido: *«GitHub por SSH, com as imagens construídas no
GitHub e não na VPS»*. Pergunta feita, com o desenho abaixo: *«Fica a b), com
este desenho?»* Resposta, a 04/10/2026: *«fica a b)»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Coolify na VPS | Painel; publica a partir do GitHub | ≥ 2 GB numa máquina de 3,7 GiB; mais uma página de administração; mais uma peça a operar |
| **b) GitHub por SSH, imagens construídas no GitHub** | Nada de construção nem painel na VPS; o caminho está no repositório e é revisto | O caminho é nosso: escrever e manter |

## Decisão

1. **No `main`**, o GitHub Actions corre o lint, os tipos e os testes,
   constrói a imagem e envia-a para o **GHCR** (privado), com o
   `GITHUB_TOKEN`. A imagem identifica-se pelo **resumo** (*digest*).
2. O fluxo entra na VPS por SSH como **`eurolify-publicar`**: sem sudo, **fora
   do grupo `docker`**, com a chave limitada por
   `restrict,command="/usr/local/bin/eurolify-pedir-publicacao"`. O comando
   fixo só aceita um resumo de imagem (64 caracteres hexadecimais) e deixa-o
   num ficheiro de pedido.
3. **Quem publica** é um serviço do `systemd` (root) que reage ao pedido:
   puxa a imagem do GHCR **pelo resumo**, corre as migrações, troca o
   contentor, verifica o `/health` e, se falhar, **volta à versão anterior**.
   Cada publicação fica registada na máquina (ADR-0016, ponto 4).
4. **Pedidos só com documentos não reconstroem nem republicam** (filtro por
   caminhos) — responde à pergunta deixada no ADR-0014.
5. A chave de publicação vai para os segredos do GitHub a partir do
   computador do Diogo, lida de ficheiro, sem passar pelo chat.

## Consequências

- Uma chave de publicação roubada só pede a publicação de uma imagem que **já
  existe no GHCR**, construída pelo nosso fluxo; não dá consola nem `docker`.
- **Um segredo novo na VPS:** um token pessoal clássico com `read:packages`,
  legível só pelo root. Um token clássico **não se limita a um repositório**:
  lê todos os pacotes da conta `HNFerramentasHitNails`. Tem data de fim e
  troca-se com ela (proposta: 90 dias), e entra nos alertas (A5).
- O `docs/11` §3.6 e §7 passam a dizer que está decidido.
- **O que pode partir:**
  - uma migração errada corre na única base do ensaio (ADR-0014); o serviço
    pára antes de trocar o contentor se a migração falhar, mas uma migração
    que «passa» e estraga dados só a revisão a apanha;
  - um `main` partido deixa o ensaio na versão anterior, parado até alguém
    corrigir — sem alertas, ninguém sabe;
  - o token do GHCR a expirar pára as publicações (a data de fim tem de estar
    nos alertas).

## O que ficou por verificar

- Se o GHCR aceita um token fino (*fine-grained*): a página só fala no
  clássico.
- O pacote do Docker Engine e a versão a instalar no Ubuntu 26.04 (decide-se
  no script, C3).
- O tamanho da imagem e o tempo de uma publicação (medem-se na primeira).
