# Alojamento do Lumavo: servidor dedicado, Vercel + Supabase, ou europeu gerido — e quanto custa (03/10/2026)

**Pergunta do Diogo (03/10/2026):** *«Preciso que me digas na sinceridade se
vale trabalhar logo dentro de um servidor dedicado, ou trabalhando diretamente
com o vercel e supabase. Que nivel de valores podemos chegar usando a máxima
capacidade do lumavo para varios comerciantes espalhados por toda a europa??»*

Na mesma mensagem, duas decisões, registadas em `docs/06` como **E** (de raiz,
ADR-0002) e **F** (produto para vender a todos os comerciantes da UE, nativo
para toda a UE). A F era a segunda vez que ele o pedia: a discordância
«Portugal e Espanha primeiro» saiu da proposta, das fases, da D-6 e da skill
`eu-localization`.

## O que se fez

- ✅ **Decidido pelo Diogo a 03/10/2026:** *«sim, fica o europeu gerido»* —
  ADR-0003, decisão G em `docs/06`. Fornecedor: **Scaleway** (*«fica a
  scaleway»*, decisão H, ADR-0004), sem comparação com a OVHcloud.
- A D-3 foi reescrita em `docs/06` com quatro opções e a recomendação
  **a) serviços geridos de um fornecedor europeu**.
- Corrigido um contra meu: a D-3 dava contra a Supabase «o caminho de
  publicação do Hub». Isso é do Lovable, não da Supabase.
- «Valores» foi lido como **custo de infraestrutura à escala**. Receita é a
  D-14 (não estudada); não se inventou.

## Números (preços lidos nas páginas oficiais a 03/10/2026; 730 h por mês)

| Preço | Valor | Fonte |
|---|---|---|
| Supabase Pro / Team | $25 / $599 por mês; o Team traz SOC2 e ISO 27001 | supabase.com/pricing |
| Supabase compute | Large 2 vCPU/8 GB $110 · XL 4/16 $210 · 2XL 8/32 $410 · 4XL 16/64 $960 · 8XL 32/128 $1.870 | supabase.com/docs/guides/platform/compute-and-disk |
| Supabase PITR (7 dias) | $100/mês | supabase.com/pricing |
| Supabase tráfego | 250 GB incluídos no Pro, depois $0,09/GB | supabase.com/pricing |
| Supabase regiões UE | Irlanda, Paris, Frankfurt, Estocolmo (e Londres, Zurique, fora da UE) | supabase.com/docs/guides/platform/regions |
| Vercel Pro | $20 por lugar; 1 TB incluído, depois $0,15/GB; 1 M invocações, depois $0,60/M | vercel.com/pricing |
| Vercel funções | Pro: 300 s por omissão, 800 s máximo (1.800 s em beta) | vercel.com/docs/functions/limitations |
| Scaleway PostgreSQL gerido (Paris) | DB-POP2-2C-8G €0,1434/h (≈ €105/mês) + segunda máquina €0,076/h (≈ €55) ⚠️; DB-PRO2-S 8 vCPU/32 GB €0,438/h (≈ €320) + segunda máquina €0,2321/h (≈ €169) ⚠️; disco €0,0993/GB/mês; cópias €0,03/GB/mês | scaleway.com/en/pricing/managed-databases |
| Scaleway contentores | €0,00001 por vCPU-s e €0,000002 por GB-s ⇒ 1 vCPU + 2 GB sempre ligado ≈ €36,8/mês | scaleway.com/en/pricing/serverless |
| Hetzner dedicados | AX42-1 €97,30/mês; AX102-1 €257,30 (preços desde 15/06/2026, sem IPv4) | docs.hetzner.com/…/price-adjustment |

⚠️ **Corrigido a 03/10/2026, mais tarde:** a segunda máquina estava contada
pela coluna «Multi-AZ option» (≈ €44 e ≈ €136), que só vale para réplicas de
leitura. A nota da página diz *«Additional node could be another node from
the same type, a Read Replica or a HA node. Multi-AZ option is available on
Read Replica only»*: a segunda máquina paga-se pela coluna «Additional nodes»
(€0,076/h na POP2-2C-8G, €0,2321/h na PRO2-S). Lido no HTML da página, não
por resumo. Os totais passaram de ≈ €225 a ≈ €234 e de ≈ €680 a ≈ €710, e
foram corrigidos no ADR-0004, no `docs/09` e no `docs/10` (e, por arrasto,
o custo fixo por mês dos cenários B e C).

**Contas (configurações escolhidas por mim, não medidas):**

| Escala | Vercel + Supabase | Europeu gerido (Scaleway) | Dedicados (Hetzner) |
|---|---|---|---|
| Início: base 2 vCPU/8 GB, 2 contentores | ≈ $265 (Pro 25 + Large 110 − crédito 10 + PITR 100 + 2 lugares Vercel 40) | ≈ €234 (105 + segunda máquina 55 + 2 contentores 74) ⚠️ | ≈ €195 (2 × AX42) + operação |
| Médio: base 8 vCPU/32 GB com segunda máquina, 6 contentores | ≈ $565 sem segunda máquina (como se contrata não verifiquei); ≈ $1.140 com o Team | ≈ €710 (320 + 169 + 221) ⚠️, mais disco e cópias (≈ €65 por 500 GB) | ≈ €612 (2 × AX102 + 1 × AX42) + operação |

**Tráfego das montras, o que cresce de verdade** (exemplo meu: 1.000 lojas ×
10.000 visitas/mês × 2 MB de imagens = 20 TB/mês): Supabase ≈ $1.780/mês
((20.000 − 250) × 0,09); Vercel ≈ $2.850/mês ((20.000 − 1.000) × 0,15). Na
Scaleway e na Hetzner **não verifiquei** o preço do tráfego.

**Capacidade:** 10.000 comerciantes × 500 encomendas/mês = 5 milhões/mês ≈
2 por segundo em média. O que pesa é a leitura das montras, não as encomendas.

## Leitura

- A máquina custa da mesma ordem nas três opções (centenas de euros por mês até
  à escala média). A escolha não é pelo preço.
- Dedicado: a operação (base, cópias, segunda máquina, actualizações, alarmes)
  fica connosco, e ninguém na equipa a faz hoje.
- Vercel + Supabase: empresas norte-americanas (a região UE muda onde estão os
  dados, não quem pode ser obrigado a entregá-los — CLOUD Act, segundo artigos
  lidos em pesquisa, lei não lida); a base à frente do browser repete o modelo
  das 77 funções abertas do Hub interno (18/09/2026); funções que param aos
  800 s não servem processos sempre ligados.
- O custo dominante não é a infraestrutura: são pessoas, suporte e a validação
  fiscal e jurídica por país (D-13, não estimado).

## O que ficou por verificar

- Os tamanhos de máquina por escala são palpite meu; **não medi** que carga
  faz um comerciante.
- Como se contrata alta disponibilidade e réplicas na Supabase, e quanto custam.
- O preço do tráfego na Scaleway e na Hetzner; os preços da OVHcloud.
- O CLOUD Act: resumos de artigos de pesquisa; o texto da lei não foi lido.
- O preço do DB-PRO2-XS. ~~A correspondência exacta entre cada nó Scaleway e o
  seu Multi-AZ~~ → verificada a 03/10/2026: era a coluna errada (⚠️ acima).
- As especificações do AX42 (8 núcleos, 64 GB) vêm de um resumo de pesquisa; o
  preço vem da página da Hetzner.
