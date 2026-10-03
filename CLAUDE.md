# Lumavo — regras de trabalho

Plataforma de comércio electrónico europeia da **Luckytarget Lda**: núcleo por
API, Hub de gestão, regras europeias de raiz e aberta a qualquer IA. **Projecto
em desenho: não há código** (ADR-0001). Trabalham aqui o **Bruno** e o **Diogo**, à vez, cada um na
sua conta de Claude Code.

## 🔴 Antes da primeira resposta

1. Ler `README.md`, `docs/00-proposta.md` e `docs/06-decisoes-em-aberto.md`.
2. Ler `memoria/MEMORY.md` e abrir as memórias do tema — **um título do índice
   não é a memória**.
3. Ver o estado dos ADR em `docs/adr/`: **o ADR-0001 proíbe código** até um
   ADR novo o substituir com o OK escrito do Bruno ou do Diogo.
4. `git fetch origin main` e `git log --oneline -15 origin/main`: o outro pode
   ter mexido desde a última sessão.

## 🔴 Marca própria — nunca uma marca existente

Ordem do Diogo, 03/10/2026: o Lumavo é desenvolvido dentro da **Luckytarget
Lda**, com marca própria. **A marca HN Hit Nails não se usa no Lumavo** — nem
em documentos, nem em ecrãs, nem em exemplos, nem em nomes de ficheiros. Os
sistemas actuais da empresa (Hub interno, loja online, plataforma de formação)
servem só como **fonte de regras e de casos medidos**, citados sem a marca e sem
nomes de clientes.

**Este ficheiro são REGRAS.** O que se descobre (medições, decisões, estado) vai
para `memoria/`, um ficheiro por tema e uma linha no índice.

## 🔴 Não se erra em documentos fiscais

Herdado dos sistemas actuais, onde custou faturas reais
(`docs/04-licoes-dos-sistemas-actuais.md`):

1. **Varrer, não remendar.** Uma regra que muda de sítio só está tratada quando
   **todos** os sítios que a liam estão listados e tratados.
2. **Uma rede temporária tem data de fim escrita.**
3. **Perguntar «por onde é que isto ainda pode sair errado?» antes de dizer que
   está feito.** Se a resposta for «não sei», não está feito.
4. **A prova do que saiu é o documento**, nunca o nosso registo.
5. **Nunca em lote**: correcções e reenvios fiscais preparam-se numa fila e
   decide uma pessoa.
6. **Nunca decidir identidade pelo nome** nem deixar o sistema escolher sozinho
   o registo «melhor».
7. Uma regra fiscal ou legal só entra no desenho com **fonte** e marcada
   **W/M/C** como em `docs/03-regulamentar-ue.md`; as **C** não chegam a um
   ecrã sem verificação ou validação profissional.

## 🔴 Uma regra, um sítio — e o sítio é a API

Tudo o que decide preço, IVA, disponibilidade, permissões ou estados vive **no
servidor do Lumavo**. Os frontends (Lovable, Vercel, Bolt, Emergent, apps) e as
IAs **usam** a decisão, nunca a refazem. Os momentos legais — checkout,
confirmação, livre resolução, documento fiscal — são servidos pelo Lumavo.

## Quem decide

| O quê | Quem |
|---|---|
| Ler, medir, investigar, escrever documentos de desenho | livre, para qualquer pessoa |
| Decisões de negócio (D-1, D-13, D-14…) | Bruno e Cila |
| Faturação, NIF, IVA, identidade de clientes, Moloni | **Bruno** |
| Avançar para código (substituir o ADR-0001) | Bruno ou Diogo |
| Alterar decisões já tomadas | quem as tomou |

*(Proposta escrita a 03/10/2026; confirmar com o Bruno.)*

## Como responder

- Português de Portugal, directo, sem entusiasmo de circunstância. Tratar pelo
  nome (Bruno, Diogo). **Uma pergunta de decisão por resposta.**
- **Um exemplo concreto** (nome, número, data, valor) — um, não quatro.
- Antes de afirmar um facto: a fonte (ficheiro e linha, consulta e resultado,
  página e data) ou **«não verifiquei»**. Não há terceira via.
- Nunca afirmar pela negativa («não existe», «não há») sem dizer como se
  procurou.
- Um número traz a pergunta a que responde, como foi contado e **a data**.
  Corrigir um número é corrigi-lo **onde está escrito**.
- Dizer sempre o que **não** foi verificado, o que falhou e o que a alteração
  pode ter partido.
- Textos de produto e de interface no **masculino universal** («os clientes»).
- Se a mesma coisa for repetida duas vezes, o erro é de leitura: parar e reler.

## Git — o `main` é partilhado

- **O `main` é o que conta**: é o que a sessão seguinte lê. Uma sessão com
  ramo designado trabalha nele e leva o resultado ao `main`.
- `git fetch origin main` **antes de escrever e antes do push**; ler o
  ficheiro que está no `main` antes de o substituir.
- **Nunca `git rebase origin/main`** com o ramo da sessão: a via é
  `git checkout -B tmp origin/main` + `git cherry-pick -x <sha>` +
  `git push origin HEAD:main`, um commit de cada vez.
- Um commit por assunto; a mensagem diz o assunto em português.
- **Nunca segredos no repositório** (chaves, palavras-passe, tokens).

## Memória (`memoria/`)

- Um ficheiro por tema, com a data no nome (`tema-03out2026.md`) e as secções
  «o que se fez», «números (com data e como se contaram)» e «o que ficou por
  verificar».
- `memoria/MEMORY.md` é **só o índice**: uma linha por memória, **no máximo 300
  caracteres** (a regra que evitou o índice de 1,2 MB do ecossistema).
- Memória nova = ficheiro novo + uma linha no índice. O que se acrescenta a um
  tema vai para o ficheiro dele.

## Skills deste repositório (`.claude/skills/`)

| Skill | Usar quando |
|---|---|
| `platform-architect` | fronteiras de domínio, monólito modular, eventos, ADR |
| `headless-commerce` | desenhar a API da Loja e de Administração, webhooks, SDK, MCP (traz o guia `mcp-builder` da Anthropic em `referencias/`) |
| `eu-gdpr-privacy` | dados pessoais, consentimento, pedidos dos titulares, retenção |
| `eu-vat-oss-ioss` | IVA, NIF, VIES, OSS, faturas e notas de crédito |
| `payments-psd2-sca` | pagamentos, autenticação forte, reembolsos, conciliação |
| `marketplace-dsa` | qualquer coisa com vendedores terceiros |
| `consumer-rights-eu` | checkout, preços, livre resolução, devoluções, garantia |
| `product-compliance-eu` | campos regulamentares, cosméticos, químicos, embalagens, recolhas |
| `catalog-pim` | artigos, variantes, kits, traduções, publicação por canal |
| `order-fulfilment` | reservas, encomendas, expedição, devoluções, transportadoras |
| `observability-security` | ameaças, permissões, segredos, auditoria, registos |
| `eu-localization` | línguas, moedas, mercados, moradas, fusos, métodos por país |
| `lumavo-design` | qualquer ecrã, tema, componente ou fluxo; pesquisa com comerciantes; revisão de interface (traz 38 referências de terceiros em `referencias/`) |

## Agentes

Não pôr vários agentes em paralelo sem perguntar — nos sistemas actuais já se
esvaziou a janela de créditos de 5 horas num só pedido. Um agente dirigido a
uma pergunta concreta, sim; e destilar o que devolver.

## Relação com os sistemas actuais da empresa

- A memória de trabalho desses sistemas vive no repo `bruno-88/claude`; os
  repositórios de onde vieram as regras estão listados em `memoria/` (fontes).
- Mexer em qualquer desses sistemas obedece às regras do `CLAUDE.md` **desse**
  repositório, não a estas.
- O Lumavo **não fala com o software de faturação de um cliente que já tem
  sistema de gestão**: quem emite é o sistema dele (decisão D-10 por tomar).
