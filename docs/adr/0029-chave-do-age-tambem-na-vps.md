# ADR-0029 · A chave privada das cópias do ensaio fica também na VPS, para a reposição semanal

- **Estado:** aceite · muda o ponto 1 do
  [ADR-0027](0027-copias-alertas-registos-e-endereco-do-ensaio.md) (a chave
  privada do `age` ficava só fora da VPS) · **só para o ensaio**
- **Data:** 04/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** contradição encontrada pelo Claude ao
  desenhar o script (C3): o ADR-0027 punha a chave privada fora da VPS **e** uma
  reposição semanal automática das cópias na VPS

## Contexto

O ADR-0027 decidiu cópias diárias cifradas com `age` para o Scaleway Object
Storage, com só a chave pública na VPS, e um ensaio de reposição semanal
automático na própria VPS. Sem a chave privada, a VPS não decifra as cópias
que estão fora, e por isso não as pode repor.

Pergunta feita ao Diogo, com duas opções — a) a reposição semanal usa o
`pg_dump` local, antes de cifrar, e uma vez por mês o Diogo decifra uma cópia
da Scaleway no computador dele (recomendada); b) a chave privada fica também
na VPS, só para o root. Resposta, a 04/10/2026: *«b»*.

## Opções consideradas

| Opção | A favor | Contra |
|---|---|---|
| a) Reposição semanal do `pg_dump` local + decifrar à mão uma vez por mês | Quem entrar na VPS não lê as cópias que estão fora | A cópia cifrada só se prova uma vez por mês, à mão |
| **b) A chave privada também na VPS (root)** | A reposição semanal prova, sem ninguém, a cópia que está fora (descarregar, decifrar, repor) | Quem tiver root na VPS lê todas as cópias; a cifra só protege contra uma fuga do lado da Scaleway |

## Decisão

A chave privada do `age` das cópias do ensaio fica **também na VPS**, num
ficheiro legível só pelo root (`/etc/eurolify/`), posto lá na preparação, nunca
pelo repositório nem pelo chat. A reposição semanal descarrega a cópia mais
recente da Scaleway, decifra-a e repõe-a numa base temporária.

## Consequências

- A cifra das cópias passa a proteger **contra uma fuga do lado da Scaleway**,
  não contra quem tenha root na VPS.
- O ensaio não tem dados pessoais reais (ADR-0018): o que a cifra protege no
  ensaio é pouco. **Para a produção, esta decisão não vale**: decide-se de novo
  (`docs/11` §7, ponto 4).
- A chave privada continua também fora da VPS, com o Diogo: perder a VPS não
  torna as cópias ilegíveis.
- **O que pode partir:** uma chave de emergência ou uma sessão roubada com
  root lê as cópias de 14 dias.

## O que ficou por verificar

- Nada de novo: as contas e os segredos do ensaio criam-se na Fase D.
