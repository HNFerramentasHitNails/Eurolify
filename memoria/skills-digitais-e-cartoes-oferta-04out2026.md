# Skills de produtos digitais e de cartões-oferta — instaladas, tudo C (04/10/2026)

**Pedido do Diogo (04/10/2026):** enviou o zip
`Eurolify___Skills_de_Produtos_Digitais_e_Cart_es-oferta_na_UE.zip` a seguir à
pergunta P3 do desenho do Catálogo (`docs/14`, que tipos de artigo entram na
Fase 1), e depois *«sim, instala as duas skills»*.

## O que se fez

- Li os 7 ficheiros do zip (README, 2 `SKILL.md`, 4 referências) na pasta
  temporária da sessão.
- Comparei com as nossas skills: as fontes são todas da UE (EUR-Lex, Comissão);
  nenhuma de fora da UE.
- Instalei como `digital-products-eu` e `gift-cards-eu` em `.agents/skills/`,
  com ligação em `.claude/skills/` (ADR-0010) — o README do pacote mandava
  copiar para `.claude/skills/`. Reescritas em português de Portugal, com as
  regras do repositório; o «procedimento» de código ficou de fora (ADR-0023).
  O que mudou está em `referencias/ORIGEM.md` de cada uma.
- `consumer-rights-eu`: a linha dos conteúdos digitais dizia «cursos em
  linha»; passou a «cursos gravados», com a nota de que um curso ao vivo com
  professor é serviço (**C**).
- `AGENTS.md` (tabela das skills), `README.md`, `docs/05` (contagem) e a P3 do
  `docs/14` actualizados.

## Choques encontrados

1. `consumer-rights-eu` punha «cursos em linha» nos conteúdos digitais —
   corrigido (acima).
2. `eu-vat-oss-ioss` (notas de crédito): na carteira, «o uso do saldo é
   desconto» (regra do Bruno, 28/09/2026, já **C**). O pacote diz que um vale
   usado é forma de pagamento. **Não se mudou**: a `gift-cards-eu` diz que a
   regra da `eu-vat-oss-ioss` vale para a carteira até o Diogo ou o Bruno
   decidirem com o contabilista.

## Números (com data e como se contaram)

- Zip: 7 ficheiros, 34.882 bytes (`wc -c`, 04/10/2026); sha256 começa por
  `0cfde2da3973376b`.
- Testes que impedem o lançamento: 16 (digitais) e 21 (cartões-oferta),
  contados nas tabelas do pacote.
- Exemplo MPV conferido: 36 / 1,23 = 29,27 € de base, 6,73 € de IVA
  (`python3`, 04/10/2026).
- Skills no repositório: 16 em `.agents/skills`, 16 ligações em
  `.claude/skills` (`ls | wc -l`, 04/10/2026).

## O que ficou por verificar

- **Nenhuma fonte foi lida**: o EUR-Lex devolveu uma resposta vazia (código
  202) em três endereços (`legal-content/EN`, `eli/…/oj/eng`,
  `legal-content/PT`), por `curl` e pelo `WebFetch`. Por isso tudo é **C**,
  menos o art. 16.º, alínea m), da Dir. 2011/83/UE, que já era **W · texto
  lido** na `consumer-rights-eu`. A ler: Dir. 2016/1065 (arts. 30.º-A, 30.º-B,
  73.º-A, considerandos 11 e 12), Dir. 2019/770 (arts. 2.º, 3.º, 5.º–18.º,
  considerando 23), Reg. 282/2011 (arts. 7.º, 9.º-A, 24.º-B, 24.º-F), PSD2
  (arts. 3.º, alínea k), e 37.º), Reg. 2018/302.
- O autor do pacote: o `SKILL.md` declara licença MIT, sem autor.
- A P3 continua por decidir (proposta: físico e serviço na Fase 1).
