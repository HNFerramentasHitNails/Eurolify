# O repo `scaleway/scaleway-skills` — avaliado, não instalado (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«https://github.com/scaleway/scaleway-skills
verifica se ajuda»* — a meio da preparação da conta da Scaleway (ADR-0011).

## O que se fez

- Clone de leitura (`--depth 1`) em `/home/user/scaleway/scaleway-skills` na
  sessão; último commit no `main` `8bb1261`, 18/05/2026. Lidos o `README.md`,
  a única skill e os fluxos do GitHub.
- Pedidos de alteração: há 11 números (1 a 11, `git ls-remote`). Abertos por
  `git fetch` os 1, 3, 4, 5, 7, 8 e 9; o 2 é o commit que está no `main`; os
  6, 10 e 11 vistos só pelo nome do ramo (`dependabot/…`). **Não sei quais
  estão abertos** — os `refs/pull` também existem para os fechados.
- **Nada foi instalado nem copiado.**

## Números (contados a 03/10/2026 na cópia)

| O quê | Resultado |
|---|---|
| Skills no `main` | **1**, `skills/scw-install/SKILL.md`; a secção «Skills» do README está vazia |
| Ficheiros no repositório | 9 (licença Apache 2.0) |
| Pedidos de alteração (os 11 números) | todos actualizações automáticas de dependências ou o acerto do `rumdl`; nenhum traz skills |
| O pedido que a skill faz primeiro (`api.github.com/repos/scaleway/scaleway-cli/releases/latest`) | **403** nesta sessão |

## Leitura

- A skill só ensina a instalar o `scw`: escolhe a última versão pela API do
  GitHub, descarrega e põe no caminho. **Não confere a soma** e manda usar
  sempre a última versão.
- Daqui falha no primeiro passo (403). O setup script do ADR-0011 faz o mesmo
  com a versão fixa (2.63.0) e a soma oficial, e funciona.
- Não cobre nada do que importa ao Eurolify: permissões (IAM), só leitura, MCP,
  variáveis, região, alertas.
- Serve só para confirmar o nome dos ficheiros das releases
  (`scaleway-cli_<versão>_linux_amd64`), que é o que o setup script usa.
  **Não se instala** em `.agents/skills`.

## O que ficou por verificar

- Se a Scaleway publica skills noutro sítio: procurei só neste repositório, nos
  ramos e nos pedidos de alteração dele.
