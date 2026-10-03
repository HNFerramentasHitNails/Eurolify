# Um nome para substituir «Lumavo»: domínios e marca (03/10/2026)

Pedido do Diogo (03/10/2026): *«preciso de um nome legal para registar a marca
dentro da UE e comprar o dominio e subsituir o lumavo»*. É a decisão D-12
(`docs/06-decisoes-em-aberto.md`), que até hoje dizia «não verifiquei».

## O que se fez

- **«Lumavo» verificado:** `lumavo.com` está registado desde 15/04/2009
  (registador NameSilo, expira a 15/04/2028; RDAP da Verisign,
  `rdap.verisign.com/com/v1/domain/lumavo.com`, consultado a 03/10/2026) e
  `lumavo.eu` está ocupado (consulta ao registo pelo MCP da Vercel,
  `get_bulk_availability`, 03/10/2026). `lumavo.io` e `lumavo.app` estavam
  livres. A marca «Lumavo» **não** foi procurada nas bases de marcas.
- **Critérios para o nome novo:** palavra inventada (sem significado para
  comércio, para não ser recusada por descritiva); pronuncia-se igual em PT,
  ES, IT, FR, DE e EN; sem palavrão conhecido; `.com` e `.eu` livres; ninguém a
  usar o nome na web.
- **Lista curta**, com `.com` e `.eu` livres a 03/10/2026:

| Nome | Na web (pesquisa entre aspas, 03/10/2026) | A favor | Contra |
|---|---|---|---|
| **Taruvia** ⭐ | só uma «Taruvia Ventures», empresa da Nigéria registada em 2020 | «via» lê-se em toda a UE; «taru» é colmeia em estónio e lenda em finlandês ([Wiktionary](https://en.wiktionary.org/wiki/taru)) | 4 sílabas; parecido com «Tarvia», marca antiga de alcatrão dos EUA |
| Albovia | só um género de plantas ([Wikidata](https://www.wikidata.org/wiki/Q17406430)) | «alba» (madrugada) + «via» | 4 sílabas; soa a farmácia ou planta |
| Nalvamo | nada encontrado | 3 sílabas, o ritmo de «Lumavo»; sem significado nenhum | não evoca nada |

- **Descartados:** Astelvo (a italiana Astelav, peças de electrodomésticos com
  APIs para clientes, desde 1963, soa quase igual); Lumaporta (mantém «Luma»,
  que tem muitas marcas — não verifiquei quais); Dozeva («doze» em inglês é
  dormitar); Quirana (lê-se «ki» ou «kwi» conforme a língua; «kirana» é
  mercearia na Índia); Ervama («erva»).

## Segunda volta: um nome que lembre um animal (03/10/2026)

O Diogo não quis nenhum dos três: *«quero algo que se possa identificar como
uma animal ou uma especia, porque seria giro fazer o logo com algum animal»*.

- **Os nomes científicos puros estão todos ocupados**: Upupa, Lutra, Alcedo,
  Ciconia, Alauda, Merops têm o `.com` registado (RDAP da Verisign) e o `.eu`
  ocupado (Vercel), 03/10/2026. O mesmo para as variações de polvo e camaleão
  que testei.
- **Lista curta**, com `.com` e `.eu` livres a 03/10/2026:

| Nome | Animal | Na web (pesquisa entre aspas, 03/10/2026) | A história |
|---|---|---|---|
| **Lincavo** ⭐ | lince | nada com esse nome; em italiano lê-se «l'incavo» (a reentrância) | «olhos de lince», ver tudo ([Priberam](https://dicionario.priberam.org/olho%20de%20lince)); o lince-ibérico é de Portugal e Espanha |
| Lontravo | lontra | nada | a lontra é «o mamífero das águas limpas» ([RTP Ensina](https://ensina.rtp.pt/artigo/lontra-o-mamifero-das-aguas-limpas/)) |
| Ciconova | cegonha | apelido eslovaco raro (Cicoňová), ~8 pessoas | a ave das entregas, que atravessa a Europa |

- **Descartados nesta volta:** Upupia (poupa) — «upupić» é um verbo
  coloquial polaco para ridicularizar alguém ([sjp.pl](https://sjp.pl/upupia));
  Lincela — personagem infantil portuguesa «Lince Lincela»; Lontria — lugar em
  Itália (La Lontria, Marradi), livre mas menos claro; Alcedix (guarda-rios) —
  livre e limpo, mas ninguém lá reconhece o animal; Medusa — é o nome de um
  motor de comércio por API, concorrente directo.
- ⚠️ **A tomada de ferramentas e as mãos dadas a dormir são da lontra-marinha**
  (Pacífico), não da lontra europeia — não usar essas histórias.

## Números (com data e como se contaram)

- **03/10/2026, `.com` por RDAP da Verisign** (404 = não registado): dos 50
  primeiros nomes inventados à mão, **49 tinham o `.com` registado**; de 700
  gerados por programa, 168 livres; de 900 de três sílabas, 250 livres; de 80
  com sentido (luz, estrela, ponte, porto), 12 livres. Os livres soam quase
  todos mal — os nomes curtos e bonitos já estão registados.
- **`.eu`** pelo MCP da Vercel: dá «ocupado» a nomes que parecem não existir
  (ex.: `olvele.eu`); só usei os «livre». Uma disponibilidade é desse instante,
  não reserva nada.
- **Repositório:** `grep -rio lumavo` fora do `.git` dá **217 ocorrências em
  36 ficheiros** (03/10/2026). Mais: o nome do repositório no GitHub, a pasta
  da skill `lumavo-design`, a apresentação de 48 páginas, o documento
  partilhável e os estudos de logótipo (desenhados para «Lumavo»).

## Custos (a confirmar no dia da compra)

- **Domínios na Scaleway** (já escolhida, ADR-0004; europeia): `.com`
  12,34 €/ano e `.eu` 5,98 €/ano, sem IVA
  ([página da Scaleway](https://www.scaleway.com/en/domain-names/), lida a
  03/10/2026; não diz se a renovação custa o mesmo). O MCP da Scaleway é só
  de leitura (decisão I), logo a compra faz-se na consola por uma pessoa.
- **`.eu`:** a Luckytarget, empresa estabelecida na UE, pode registar
  (art. 4.º, n.º 2, do Regulamento (UE) 2019/517 —
  [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32019R0517);
  **W**, texto não lido).
- **Marca da UE no EUIPO**, pedido electrónico: 850 € a 1.ª classe, 50 € a
  2.ª, 150 € cada uma a partir da 3.ª ⇒ **1.050 € para as classes 9, 35 e
  42** (software, serviços de comércio, software como serviço). Fonte:
  escritórios de advogados em 2026
  ([ds.solutions](https://ds.solutions/en/eu-trademark-cost/),
  [njordlaw](https://www.njordlaw.com/european-union-trademark-eutm)); a
  página do EUIPO deu 403. **W**. As classes são proposta minha, a confirmar.
- **SME Fund 2026** (75 % das taxas, até 700 €): segundo fontes secundárias, o
  vale de marcas esgotou em Agosto de 2026. Não confirmado no EUIPO (403).

## O que ficou por verificar

- 🔴 **Nenhum candidato (das duas voltas) foi procurado nas bases de marcas** (EUIPO eSearch e
  TMview): as duas recusam pedidos automáticos a partir da sessão (resposta
  `302 → error/revise.html` da firewall, 03/10/2026). Tem de ser uma pessoa no
  browser: [TMview](https://www.tmdn.org/tmview/) com o nome, classes 9, 35 e
  42, e ver também nomes parecidos.
- O significado dos nomes nas 24 línguas da UE: só verifiquei o que está
  escrito acima. Pronúncia «igual em todas» é opinião minha, não testada com
  falantes.
- Nomes de empresas no registo comercial de cada país: não procurei.
- A disponibilidade dos domínios muda a qualquer momento.
- Nada foi comprado nem registado.
