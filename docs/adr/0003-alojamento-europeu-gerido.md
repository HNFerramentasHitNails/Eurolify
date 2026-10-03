# ADR-0003 · O Lumavo fica alojado num fornecedor europeu, com serviços geridos

- **Estado:** aceite · completado pelo [ADR-0004](0004-fornecedor-scaleway.md)
  (fornecedor: Scaleway, 03/10/2026)
- **Data:** 03/10/2026
- **Quem decidiu:** Diogo
- **Decisão em aberto de origem:** D-3 (`docs/06-decisoes-em-aberto.md`)

## Contexto

O Diogo perguntou se valia começar num servidor dedicado ou directamente na
Vercel e na Supabase. A análise, com os preços lidos nas páginas oficiais a
03/10/2026, está em `memoria/alojamento-e-custos-03out2026.md` e na D-3.

Em resumo: a máquina custa da mesma ordem nas três opções (centenas de euros
por mês até à escala média), por isso a escolha não é pelo preço. O
dedicado deixa toda a operação connosco. A Vercel e a Supabase são empresas
norte-americanas (a região UE não muda quem pode ser obrigado a entregar os
dados); a Supabase põe a base de dados à frente do browser; as funções da
Vercel param aos 800 s.

Resposta do Diogo, a 03/10/2026: *«sim, fica o europeu gerido»*.

## Opções consideradas

As quatro da D-3: europeu gerido, servidores dedicados, Vercel + Supabase,
AWS/Google/Azure na região UE.

## Decisão

O núcleo do Lumavo e o seu Hub ficam num **fornecedor europeu, com serviços
geridos**: base de dados PostgreSQL gerida com segunda máquina e cópias,
contentores para a API e os processos sempre ligados, e armazenamento de
ficheiros — tudo na UE.

As lojas dos comerciantes ficam onde cada um quiser (Vercel, Lovable, Bolt,
Emergent…): falam com o Lumavo pela API, e esse alojamento é deles.

## Consequências

- **Fica por escolher o fornecedor.** A Scaleway (Paris) foi o exemplo com
  preços lidos; a OVHcloud não foi verificada. A escolha faz-se comparando os
  dois com os mesmos critérios (base gerida com segunda máquina, contentores,
  tráfego, regiões, certificações, contrato de tratamento de dados).
- **Constroem-se duas coisas que a Supabase daria feitas:** a autenticação
  (OAuth 2.1/OIDC, já prevista em `02-arquitectura.md` §4.2) e o caminho de
  publicação (do repositório ao ar, testado).
- **Não é o OK para código.** O ADR-0001 diz que a configuração de alojamento
  conta como código: abrir a conta e montar seja o que for espera pelo OK.
- O argumento «europeu» passa a ser verdadeiro de ponta a ponta no núcleo; os
  subcontratantes que recebam dados (e-mail, IA, pagamentos) têm de ser vistos
  um a um (skill `eu-gdpr-privacy`).

## O que ficou por verificar

- Preços e serviços da OVHcloud; o preço do tráfego na Scaleway.
- A que número de comerciantes corresponde cada tamanho de máquina — não
  medido.
