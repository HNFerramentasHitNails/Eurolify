# Índice da memória do Eurolify

> Chamava-se **Lumavo** até 03/10/2026 (ADR-0009): as memórias anteriores
> usam o nome antigo, e a skill `lumavo-design` é hoje a `eurolify-design`.

> Só o índice: **uma linha por memória, no máximo 300 caracteres**. O trabalho
> vive no ficheiro. Um título não é a memória — abrir o ficheiro antes de
> afirmar. Todo o número traz a data em que foi medido.

## Arranque

- [🔴 O Diogo e o Bruno decidem tudo neste repositório (faturação incluída); 4 regras da UE para o Claude: seguir as skills, só regras da UE com fonte, nunca inventar, dados na UE — 03/10/2026](liberdade-e-regras-ue-03out2026.md)
- [🔴 O Lumavo é da Luckytarget Lda, com marca própria; nenhuma marca existente se usa (ordem do Diogo) — 03/10/2026](dono-e-marca-luckytarget-03out2026.md)
- [Arranque do Lumavo: o pedido do Diogo, proposta, desenho e 12 skills; fontes e o que não foi verificado — 03/10/2026](arranque-do-projecto-03out2026.md)

## Para decidir

- [Apresentação para Bruno e Cila, 64 páginas (v11: Eurolify, a folha de 9 logótipos no lugar dos 18 rascunhos, a D-13 e o tempo por fases); o estudo 5 (estrelas da UE) arrisca recusa no EUIPO; páginas não vistas — 03/10/2026](apresentacao-bruno-cila-03out2026.md)
- [⚠️ O alojamento gerido foi substituído pela VPS (ADR-0015). Alojamento: dedicado, Vercel + Supabase ou europeu gerido; preços oficiais lidos e contas por escala; decidido o europeu gerido (G), na Scaleway (H); e as decisões E (de raiz) e F (toda a UE) — 03/10/2026](alojamento-e-custos-03out2026.md)
- [⚠️ Sem efeito com a VPS (ADR-0015). Scaleway: conta preparada (R, ADR-0011), ensaio + chave só de leitura, `scw` 2.63.0 pelo binário; o MCP só de leitura deixa ler segredos, `--read-only` falha; listas sem permissão dão vazio; portador da chave por ver — 03/10/2026](scaleway-mcp-e-deploy-03out2026.md)
- [⚠️ O ensaio passou para a VPS (ADR-0015). Publicação na Scaleway: um só ensaio, actualizado a cada entrada no `main` (U, ADR-0014); o endereço fica público (o modo privado não abre no browser); base do ensaio em PostgreSQL gerido, não a SQL sem servidor; ≈ 12–28 €/mês — 03/10/2026](scaleway-publicacao-ensaio-03out2026.md)
- [🔴 Alojamento numa VPS operada pelo Diogo e pelo Bruno (V, ADR-0015) e o Claude a operá-la com acesso total (W, ADR-0016); guia em `docs/11`; por onde o Claude chega à máquina por resolver (SSH da cloud não respondeu) — 03/10/2026](vps-operada-por-nos-03out2026.md)
- [Extensões de terceiros: 7 tipos, os mesmos contratos para o Lumavo e para terceiros, regras fiscais e legais não extensíveis, loja (DSA, ciber-resiliência); decididos K e L (parceiros convidados na Fase 2) — 03/10/2026](extensoes-de-terceiros-03out2026.md)
- [D-1 decidida: vender desde o início (ADR-0006); fases reorganizadas, D-14 antes da Fase 1 (os preços só antes da peça 13, ADR-0012), e o «outros países» que tinha escapado ao varrimento da decisão F — 03/10/2026](d1-vender-desde-o-inicio-03out2026.md)
- [Pagamentos e envios na UE: 27 países com fonte, conferidos por amostragem; Mollie cobre os métodos locais; o pagamento na entrega no Leste é parceria de envios — 03/10/2026](pagamentos-e-envios-ue-03out2026.md)
- [Modelo de receita estudado (D-14): concorrência, 9 fontes de receita, base decidida (N: mensalidade por escalões, sem taxa sobre as vendas); preços por decidir, antes da peça 13 e não antes do código (S, ADR-0012) — 03/10/2026](modelo-de-receita-03out2026.md)
- [Estimativa (D-13): decidido o A (O, ADR-0008), Diogo e Bruno com Claude Code e Codex; Fase 1 15–29 meses a tempo inteiro, 28–52 a meio (hipótese C), tempo por fases no docs/10 §9; o Codex não lê o CLAUDE.md — 03/10/2026](estimativa-prazo-e-custo-03out2026.md)
- [Regras e skills num sítio só (Q, ADR-0010): `AGENTS.md` para o Claude Code e o Codex, `CLAUDE.md` só importa; skills em `.agents/skills` com ligações em `.claude/skills`; por testar numa sessão de Codex — 03/10/2026](agents-md-um-sitio-03out2026.md)
- [✅ Nome: Eurolify (D-12, ADR-0009), escolhido pelo Diogo depois de 5 voltas; .com e .eu livres a 03/10; Lumavo ocupado (.com desde 2009); «apoiado pela UE» sem o ser é prática desleal; a Vercel erra no .eu — 03/10/2026](marca-nome-e-dominios-03out2026.md)

## Referências externas avaliadas

- [O repo 40RTY-ai/shopify-admin-skills: 116 skills só para Shopify; serve de lista de tarefas e de formato, não se instala (identidade pelo nome, IVA pelo nome da taxa) — 03/10/2026](skills-shopify-admin-avaliadas-03out2026.md)
- [As skills de design de 3 repos juntadas numa só (lumavo-design): 38 referências por etapa, 75+ de fora e porquê; a regra da Vercel copiada em vez de ligada — 03/10/2026](skills-de-design-juntadas-03out2026.md)
- [A mcp-builder (Anthropic) juntada à headless-commerce, sem os programas; o que o Lumavo muda ao guia (só leitura na Fase 1) — 03/10/2026](mcp-builder-juntado-03out2026.md)
- [O repo scaleway/scaleway-skills: 1 skill só (instalar o `scw`), que pede à API do GitHub (403 daqui), não confere a soma e usa sempre a última versão; não se instala — 03/10/2026](scaleway-skills-avaliado-03out2026.md)
