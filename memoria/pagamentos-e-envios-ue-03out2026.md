# Pagamentos e envios mais usados na UE, e com quem fazer parcerias (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«Para os pagamentos e para os envios, lista
os mais usados dentro da europa ou de cada pais da UE, para que possamos depois
abrir parcerias.»*

## O que se fez

- `docs/07-pagamentos-e-envios-por-pais.md`: parceiros que cobrem vários países
  (§1), os 27 países com fonte em cada linha (§2), a proposta de por onde
  começar (§3) e as mudanças recentes (§4).
- A pesquisa por país foi feita por **um** agente (168 consultas). Conferi por
  amostragem: a tabela europeia da Worldpay 2025 (11 países), a ANACOM, a
  BNetzA e a CNMC — tudo bateu.
- Skills `eu-localization`, `payments-psd2-sca` e `order-fulfilment` passam a
  apontar para o `docs/07` em vez de terem a sua própria lista.

## Números que mais pesam (com a fonte no `docs/07`)

- Países Baixos: A2A 67 % do valor online, iDEAL usado por 86 % (Worldpay, 2024).
- Polónia: A2A 70 % (BLIK, Przelewy24) (Worldpay, 2024).
- Alemanha: PayPal usado por 68 %; DHL mais de 40 % das encomendas (BNetzA).
- Portugal: CTT 43,5 % das encomendas (2.º trim. 2024, ANACOM); MB WAY o meio
  mais usado online (Marktest, 2025).
- Espanha: Correos 17,5 %, redes urgentes 39,0 %, última milha 33,0 % (CNMC, 2024).
- **Pagamento na entrega no Leste:** Bulgária 50,3 %, Hungria 59 %, Eslováquia
  43 %, Chéquia 39 % — é parceria de envios, não de pagamentos.

## Correcções feitas no caminho

- Um resumo de pesquisa dava aos Países Baixos «iDEAL 66 %, PayPal 47 %»; a
  Worldpay diz A2A 67 % e iDEAL usado por 86 %. O número errado não foi usado.
- Escrevi que o Wero chegou ao online em França e na Bélgica em jan./2026; as
  fontes divergem — ficou «ao longo de 2026, datas por país não confirmadas».

## O que ficou por verificar

Ver a secção «O que ficou por verificar» do `docs/07` (marcas de pagamento nos
países pequenos, quotas de transportadores sem nome em 8 países, sedes de
alguns parceiros, linhas lidas por resumo automático).
