# VIES: a saída da VPS medida (#233, #377), 12/10/2026

## O que se fez

- **#377 juntado** a 12/10/2026 (`d731b94`), com o OK do Diogo («sim»). A
  medição fixa (`eurolify-medir`, fluxo `medir`) ganhou a secção «saída para
  o VIES»: pede o `check-status` da API REST da Comissão (sem NIF nenhum) e
  diz se o `VIES_URL` está no `/etc/eurolify/api.env` (nunca o valor).
- **Alteração à máquina:** o fluxo `aplicar-script` (corrida 38225041820,
  08:41 UTC) instalou o `/usr/local/sbin/eurolify-medir` novo; o registo da
  máquina diz «preparar.sh terminou: 1 alteração(ões), 1 aviso(s)».
- **Revisão do agente** (`eurolify-critical-review`, Opus 5.5, ADR-0035):
  0 P0, 0 P1, 2 P2, 4 P3; tratados, salvo P3-4 (até 10 s a mais na medição).
- Ficou no GitHub o ramo `vies-medir-saida`, enviado por engano com o primeiro
  commit; não se conseguiu apagar desta sessão (o servidor cortou a ligação).

## Números (com data e como se contaram)

Fluxo `medir`, corrida 38225375150, 12/10/2026 às 08:44 UTC:

- «a partir da máquina (não do contentor da API): HTTP 200 em 0.093416 s»;
- «VIES: disponível»;
- «VIES_URL no api.env: não (a consulta está desligada)».

Na mesma medição, fora deste tema:

- «verificacao: failed, resultado exit-code, fim Mon 2026-10-12 07:00:06 UTC»;
- «Reinício pedido pelas actualizações» e «38 updates can be applied
  immediately».

## O que ficou por verificar

- **A API (no contentor) chegar ao VIES:** só se mede a partir da máquina.
  A prova final é a primeira consulta da fila depois de ligar.
- **Ligar:** pôr `VIES_URL=https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`
  no `/etc/eurolify/api.env` e recriar a API. Muda a configuração da máquina:
  Diogo ou Bruno (AGENTS.md, «Operar a VPS», regra 1).
- **Porque falhou a verificação das 07:00** e qual é o aviso do
  `preparar.sh`: não li.
