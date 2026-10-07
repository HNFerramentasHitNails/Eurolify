# Índice da memória do Eurolify

> Chamava-se **Lumavo** até 03/10/2026 (ADR-0009): as memórias anteriores
> usam o nome antigo, e a skill `lumavo-design` é hoje a `eurolify-design`.

> Só o índice: **uma linha por memória, no máximo 300 caracteres**. O trabalho
> vive no ficheiro. Um título não é a memória — abrir o ficheiro antes de
> afirmar. Todo o número traz a data em que foi medido.

## Arranque e regras

- [🔴 O Diogo e o Bruno decidem tudo neste repositório (faturação incluída); 4 regras da UE para o Claude: seguir as skills, só regras da UE com fonte, nunca inventar, dados na UE — 03/10/2026](liberdade-e-regras-ue-03out2026.md)
- [🔴 O Lumavo é da Luckytarget Lda, com marca própria; nenhuma marca existente se usa (ordem do Diogo) — 03/10/2026](dono-e-marca-luckytarget-03out2026.md)
- [Arranque do Lumavo: o pedido do Diogo, proposta, desenho e 12 skills; fontes e o que não foi verificado — 03/10/2026](arranque-do-projecto-03out2026.md)
- [Regras e skills num sítio só (Q, ADR-0010): `AGENTS.md` para o Claude Code e o Codex, `CLAUDE.md` só importa; skills em `.agents/skills` com ligações em `.claude/skills`; por testar numa sessão de Codex — 03/10/2026](agents-md-um-sitio-03out2026.md)

## Código e revisão

- [OK para código (AE, ADR-0023): só por PR com as duas revisões, domínio só depois do desenho; revisões impostas com o GitHub Pro na conta pessoal (AF, ADR-0024), Codex automático, Bruno precisa de conta — 04/10/2026](ok-para-codigo-04out2026.md)
- [Fatia 2 (Comerciante), código: migração 0001 com RLS forçado e eurolify_api sem BYPASSRLS, estados e activação na base, Kysely 0.29 (Migrator em kysely/migration), 21 testes contra PostgreSQL 18.6 local por Docker — 04/10/2026](fatia-2-comerciante-codigo-04out2026.md)
- [Catálogo (fatia 3), parte 1: artigos e variantes na base (migração 0002, RLS, SKU único também entre arquivadas, GTIN com dígito de controlo, tipos digitais desligados, SKU sem maiúsculas na 0003), 24 testes; listas de unidades são proposta — 05/10/2026](catalogo-codigo-05out2026.md)
- [Catálogo, parte 2a: kits (migração 0004, sem ciclos com bloqueio por comerciante, componente novo activo, componente em uso não se apaga), 16 testes; regras da parte são proposta — 05/10/2026](catalogo-kits-05out2026.md)
- [Catálogo, parte 2b: opções e valores (migração 0005; opções só num rascunho; com opções, cada variante activa completa e sem combinação repetida; fila por artigo; P12: textos fixos fora do rascunho), 27 testes; regras da parte são proposta — 05/10/2026](catalogo-opcoes-05out2026.md)
- [Catálogo, parte 3a: categorias e colecções (migração 0007; árvore sem ciclos com fila por comerciante; arquivam-se, não se apagam; endereço único; a fila antes da linha), 22 testes; regras da parte são proposta — 05/10/2026](catalogo-categorias-05out2026.md)
- [Catálogo, parte 3b: traduções (migração 0009; original guardado, estado calculado; quem traduz; revisão só de IA; língua de origem passa para o comerciante e fica fixa com catálogo; publicada a 06/10), 15+4 testes; regras são proposta — 05/10/2026](catalogo-traducoes-05out2026.md)

## Alojamento e VPS

- [🔴 VPS operada por nós (V, ADR-0015) e pelo Claude (W, ADR-0016), VPS-1 até à migração (AC; X era VPS-3); guia `docs/11`. ⚠️ No Reino Unido: só ensaio, sem dados pessoais, até 31/03/2027 (Y, Z); acesso pelo PC do Diogo (AA); palavra-passe fechada — 03/10/2026](vps-operada-por-nos-03out2026.md)
- [⚠️ O alojamento gerido foi substituído pela VPS (ADR-0015). Alojamento: dedicado, Vercel + Supabase ou europeu gerido; preços oficiais lidos e contas por escala; decidido o europeu gerido (G), na Scaleway (H); decididas E (de raiz) e F (toda a UE) — 03/10/2026](alojamento-e-custos-03out2026.md)
- [⚠️ Sem efeito com a VPS (ADR-0015). Scaleway: conta preparada (R, ADR-0011), ensaio + chave só de leitura, `scw` 2.63.0; o MCP só de leitura deixa ler segredos, `--read-only` falha; listas sem permissão dão vazio; portador da chave por ver — 03/10/2026](scaleway-mcp-e-deploy-03out2026.md)
- [⚠️ O ensaio passou para a VPS (ADR-0015). Publicação na Scaleway: um só ensaio, actualizado a cada entrada no `main` (U, ADR-0014); o endereço fica público; base do ensaio em PostgreSQL gerido, não a SQL sem servidor; ≈ 12–28 €/mês — 03/10/2026](scaleway-publicacao-ensaio-03out2026.md)
- [VPS, passo 10b (#70): eurolify_migrador dono da base com a ligação em migrar.env gerada na máquina; eurolify_api NOLOGIN até a API usar a base; ensaio local com a migração 0001 a correr como o dono — 04/10/2026](vps-utilizadores-da-base-04out2026.md)
- [VPS, passos 10b e 10c (#107): eurolify_api com LOGIN e a ligação em api-base.env gerada na máquina; a API recria-se, publicações trancadas, cada uma prova que chega à base (chave inventada → 401) — 06/10/2026](vps-api-ligada-a-base-06out2026.md)
- [Identidade: POST /keys e revogação (#107, 0012): a base acha quem pede pelo resumo do segredo, T9 e a última gestora na base, tranca por comerciante; idempotência em tabela, o segredo não se repete (409) — 06/10/2026](identidade-criar-revogar-chaves-06out2026.md)
- [Identidade, parte B: opções para contas de pessoas (biblioteca, servidor na VPS, gerido na UE), licenças e memória lidas por resumo; VPS medida: 781 MiB usados de 3,7 GiB, 2 núcleos; decidido construir na API (ADR-0036) — 06/10/2026](identidade-parte-b-opcoes-06out2026.md)
- [Limpeza diária da idempotência (#107, 0013): função na base, eurolify-limpeza às 05:00 como superutilizador (RLS forçado), a verificação das 07:00 avisa se parar; ensaio local completo — 06/10/2026](idempotencia-limpeza-06out2026.md)

## Negócio, fases e estimativa

- [D-1 decidida: vender desde o início (ADR-0006); fases reorganizadas, D-14 antes da Fase 1 (preços só antes da peça 13, ADR-0012); AD (ADR-0022, 04/10): relatório OSS, núcleo das devoluções e lotes passam para a Fase 1, estimados — 03/10/2026](d1-vender-desde-o-inicio-03out2026.md)
- [Modelo de receita estudado (D-14): concorrência, 9 fontes de receita, base decidida (N: mensalidade por escalões, sem taxa sobre as vendas); preços por decidir, antes da peça 13 e não antes do código (S, ADR-0012) — 03/10/2026](modelo-de-receita-03out2026.md)
- [Estimativa (D-13): decidido o A (O, ADR-0008), Diogo e Bruno com Claude Code e Codex; Fase 1 17–32 meses a tempo inteiro, 31–58 a meio (hipótese C; com a AD, 04/10), tempo por fases no docs/10 §9; o Codex não lê o CLAUDE.md — 03/10/2026](estimativa-prazo-e-custo-03out2026.md)

## Marca e apresentação

- [✅ Nome: Eurolify (D-12, ADR-0009), escolhido pelo Diogo depois de 5 voltas; .com e .eu livres a 03/10; Lumavo ocupado (.com desde 2009); «apoiado pela UE» sem o ser é prática desleal; a Vercel erra no .eu — 03/10/2026](marca-nome-e-dominios-03out2026.md)
- [Apresentação para Bruno e Cila: v0.8 e PDF: reescrita em 25 páginas num deck novo (o feito, 4 pedidos à mão; o antigo não abre desta conta); antes 66 páginas (v25 e PDF); estudo 5 arrisca recusa no EUIPO; páginas não vistas — 03/10/2026](apresentacao-bruno-cila-03out2026.md)

## Pagamentos, envios e extensões

- [Pagamentos e envios na UE: 27 países com fonte, conferidos por amostragem; Mollie cobre os métodos locais; o pagamento na entrega no Leste é parceria de envios — 03/10/2026](pagamentos-e-envios-ue-03out2026.md)
- [Extensões de terceiros: 7 tipos, os mesmos contratos para o Lumavo e para terceiros, regras fiscais e legais não extensíveis, loja (DSA, ciber-resiliência); decididos K e L (parceiros convidados na Fase 2) — 03/10/2026](extensoes-de-terceiros-03out2026.md)

## Fontes externas avaliadas

- [O repo 40RTY-ai/shopify-admin-skills: 116 skills só para Shopify; serve de lista de tarefas e de formato, não se instala (identidade pelo nome, IVA pelo nome da taxa) — 03/10/2026](skills-shopify-admin-avaliadas-03out2026.md)
- [As skills de design de 3 repos juntadas numa só (lumavo-design): 38 referências por etapa, 75+ de fora e porquê; a regra da Vercel copiada em vez de ligada — 03/10/2026](skills-de-design-juntadas-03out2026.md)
- [A mcp-builder (Anthropic) juntada à headless-commerce, sem os programas; o que o Lumavo muda ao guia (só leitura na Fase 1) — 03/10/2026](mcp-builder-juntado-03out2026.md)
- [O repo scaleway/scaleway-skills: 1 skill só (instalar o `scw`), que pede à API do GitHub (403 daqui), não confere a soma e usa sempre a última versão; não se instala — 03/10/2026](scaleway-skills-avaliado-03out2026.md)
- [As skills de regras da UE do Perplexity (2 versões): não se instalam — erros conferidos no EUR-Lex; serviram para 5 datas e o DSA na Fase 1 no `docs/03` e para 4 skills nossas (consumidor, RGPD, produto, segurança), com os artigos lidos — 03/10/2026](skills-ue-perplexity-avaliadas-03out2026.md)
- [O repo mart337i/odoo-skills: skills para programar Odoo, não uma lista de módulos; não se instala; 7 ideias de back-office e as 8 portas levadas a 3 skills (linha do tempo, tarefas, vistas, automáticas, módulos, permissões por campo, impressos) — 03/10/2026](odoo-skills-avaliado-03out2026.md)
- [O PDF «Apresentação de Projeto» do Perplexity: não se envia como está (erros, microserviços, taxa sobre vendas, 1,8 M€ sem contas); na apresentação: o mercado (757 mil M€ é previsão de 2026) e o financiamento (o EIC exige TRL 6–8) — 04/10/2026](pdf-perplexity-apresentacao-avaliado-04out2026.md)
- [Skills de produtos digitais e de cartões-oferta (zip do Diogo): instaladas como `digital-products-eu` e `gift-cards-eu`, tudo C (EUR-Lex não leu); corrigidos «cursos em linha»; choque com a carteira da `eu-vat-oss-ioss` por decidir — 04/10/2026](skills-digitais-e-cartoes-oferta-04out2026.md)
- [Pacote complementar (26 skills): lido, não instalado (10 repetem as nossas); o prompt seguido por ordem do Diogo — docs/eurolify/, motor de regras dos 27 (tudo por verificar), P3 decidida, diagnóstico de apoios — 04/10/2026](pacote-complementar-skills-04out2026.md)
- [Pacote de eficiência: auditoria só de leitura (0 ficheiros iguais; decisões em 3 sítios) → #52, #54, #56; 6 skills instaladas (sessão, gestão, modelos, memória, diagnóstico, prova); Sonnet/Haiku/Opus 5.5, sem Fable; poupança não medida — 04/10/2026](skills-de-eficiencia-instaladas-04out2026.md)
- [Skills complementares de engenharia e conformidade UE (zip do Diogo, 15): instaladas com ligações; 2 linhas no AGENTS.md (engenharia e coordenação jurídica); validação estrutural OK, `agentskills` não correu; fontes W, países todos pendentes — 05/10/2026](skills-complementares-ue-05out2026.md)
- [VPS: voltar a uma publicação pelo MCP decide pela base (#113/#115, #120/#122): só à anterior, «migrou:» e linhas «falhou» no publicacoes.log, --emergencia por SSH; 134 verificações; o formato novo na VPS não lido — 06/10/2026](vps-voltar-a-publicacao-06out2026.md)
- [Preços e mercados, parte 1 (#129 desenho, #134 código, 0017): 6 tabelas, regras na base, histórico com moeda e IVA, 31 testes (7 em concorrência), 2 revisões Sonnet; 0017 aplicada no ensaio (corrida 37474635285); parte 2 por fazer — 06/10/2026](precos-e-mercados-06out2026.md)
- [Contas de pessoas (#140): B1 #141 juntado e 0018 no ensaio (revisão Opus: 1 P1 tratado; CE até 31/03/2027); B2 #142 passkeys e rotas do Hub em curso; o que se leu do @simplewebauthn e do @fastify/cookie; npm audit 0 — 06/10/2026](contas-de-pessoas-06out2026.md)
- [Catálogo parte 4 (#139, 0019): publicação por canal × mercado e a verificação C2 no servidor, a base repete o essencial, Conformidade e media «não verificado» (CF); 4 revisões Sonnet; 0019 aplicada no ensaio (corrida 37500645084) — 06/10/2026](catalogo-publicacao-06out2026.md)
- [Eventos de domínio (#143, 0021): evento_saida escrita por gatilhos, API sem acesso, eventos imutáveis; 6 eventos de produto, preço e mercado; quem nunca sai nos webhooks (CH); 2 revisões Sonnet; 0021 no ensaio (corrida 37591885738) — 07/10/2026](eventos-dominio-07out2026.md)
- [Catálogo: reverificar as publicações (#146, 0023): a que falha sai de venda, motivo verificacao_falhou (CJ); 5 operações, só quando conta; 300 publicações em 2,2 s locais; 2 revisões Sonnet; 0023 no ensaio (corrida 37601413981) — 07/10/2026](catalogo-reverificacao-07out2026.md)
- [API do Catálogo, parte 1 (#150): 4 consultas com catalog:read, listas com total (docs/18 §2a), só leitura, versão Eurolify-Versao 2026-10, «quem» não sai (CL); 2 revisões Sonnet; publicado no ensaio (corrida 37619755261) — 07/10/2026](catalogo-api-consultas-07out2026.md)
