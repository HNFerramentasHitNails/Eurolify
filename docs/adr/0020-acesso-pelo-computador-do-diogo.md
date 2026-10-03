# ADR-0020 · O Claude chega à VPS pelo Claude Code no computador do Diogo, por SSH

- **Estado:** aceite · completa o [ADR-0016](0016-o-claude-opera-a-vps.md)
  (por onde o Claude chega à máquina)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** `docs/11-preparacao-da-vps.md` §7, ponto 2

## Contexto

O ADR-0016 deu ao Claude o controlo da VPS e deixou por resolver por onde lá
chega. Medido a 03/10/2026 a partir de uma sessão do Claude Code na cloud: a
porta 22 do `github.com` não respondeu em 8 s, e a da VPS
(`57.129.168.39:22`) também não, em 10 s. Não se distingue se o bloqueio é da
rede da sessão ou da VPS. Os caminhos estavam no `docs/11` §5: a) o Claude
Code no computador do Diogo ou do Bruno, por SSH; b) um servidor MCP na VPS,
por HTTPS. A proposta era a a).

Resposta do Diogo, a 03/10/2026: *«vamos avançar com o acesso pelo meu
computador»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| **a) O Claude Code no computador do Diogo, por SSH** | Não abre nada na VPS além do SSH; cada comando pede autorização no ecrã do Diogo | Só funciona com o computador do Diogo ligado; a chave vive nesse computador |
| b) Um servidor MCP na VPS, por HTTPS | Opera-se a partir da cloud | Mais uma porta aberta para uma ferramenta com acesso total; autenticação forte por fazer |

## Decisão

O Claude opera a VPS a partir do **Claude Code no computador do Diogo
(Windows)**, por **SSH com uma chave do Diogo**. Quando o Bruno operar, faz o
mesmo no computador dele, com a chave dele (ADR-0016, ponto 3).

## Consequências

- **A trava é o pedido de autorização do Claude Code** (proposta): os
  comandos `ssh` não entram na lista dos que correm sem perguntar, e não se
  usa o modo que salta autorizações quando se opera a VPS. Assim, cada comando
  na máquina passa pelo «sim» de quem pediu (ADR-0016, ponto 2).
- **A chave** (proposta): própria para a VPS (não a do GitHub), com frase-passe,
  carregada no agente de SSH do Windows (que vem desligado por omissão, segundo
  a documentação da Microsoft). A data de troca está por decidir (ADR-0016,
  ponto 3; `docs/11` §3.1).
- As sessões do Claude na cloud continuam a fazer o resto do trabalho
  (documentos, desenho) e não chegam à máquina.
- **O que pode partir:**
  - um «permitir sempre» num comando `ssh` tira a confirmação de todos os
    comandos seguintes na máquina;
  - um computador perdido ou comprometido com a chave carregada dá acesso à
    máquina: revoga-se a chave primeiro e investiga-se depois (`AGENTS.md`);
  - na máquina, o que o Claude faz com a chave do Diogo aparece como feito
    pelo Diogo: o registo «quem, o quê, quando» do ADR-0016 não distingue os
    dois sem mais nada.

## O que ficou por verificar

- Se o computador do Diogo chega à porta 22 da VPS (não testado).
- Se a VPS aceita entrar por palavra-passe (não testado).
- Se o Claude Code no Windows do Diogo vê as 14 skills (ADR-0010).
