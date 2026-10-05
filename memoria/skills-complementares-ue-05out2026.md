# Skills complementares de engenharia e conformidade UE — 05/10/2026

## O que se fez

- O Diogo entregou um pacote (ZIP «Skills Complementares de Engenharia e
  Conformidade UE», versão 1.0.0, preparado a 05/10/2026) com 15 skills novas.
- Instaladas em `.agents/skills/` com uma ligação cada em `.claude/skills/`
  (regra do ADR-0010). Nenhuma skill existente foi alterada; nenhum nome
  coincidia com os 22 que já existiam.
- No `AGENTS.md` entraram só duas linhas na tabela de skills: a de engenharia
  (`eurolify-engineering-execution`) e a coordenadora jurídica
  (`eurolify-legal-briefing-eu`), que encaminha para as outras 13.
- As fontes, a matriz dos 27 países, o calendário e o modelo de ficha vivem
  só em `eurolify-legal-briefing-eu/references/` e `templates/`.

## Números (com data e como se contaram)

- 05/10/2026, `ls .agents/skills | wc -l`: 37 skills (22 + 15).
- 05/10/2026, script de validação na sessão: 15/15 com `name` igual à pasta,
  referências locais e dependências existentes, ligações a funcionar;
  `countries.json` com 27 países; `sources.jsonl` com 51 entradas;
  `source-gaps.jsonl` com 1 lacuna (alteração ao AI Act, fonte não lida).
- O que `eurolify-engineering-execution` cita do código existe no `main` de
  05/10/2026: `comComerciante`, `set_config(…, true)` em
  `apps/api/src/comerciante/repositorio.ts`, `EXIGIR_BASE` em
  `.github/workflows/verificar.yml`.

## O que ficou por verificar

- `agentskills validate` não correu aqui (ferramenta não instalada); o pacote
  diz que passou do lado de quem o preparou — não verificado.
- O conteúdo jurídico (fontes, datas do calendário, contactos dos 27 países)
  não foi reconferido: é uma fotografia de 05/10/2026, com todas as
  validações nacionais «pendentes». As fontes vêm marcadas **W** (resumo lido,
  não o texto legal), como em `docs/03-regulamentar-ue.md`.
- `eurolify-commerce-coverage-eu` cita páginas de ajuda do Shopify (4 entradas
  em `sources.jsonl`) como referência de funcionalidades, não como regra. Ficam
  sob a regra do `AGENTS.md`: o comportamento do Shopify nunca é regra.
- Sobreposição com as skills existentes: `eurolify-payment-readiness-eu` e
  `eurolify-finance-reconciliation-eu` tocam em `payments-psd2-sca`;
  `eurolify-tax-pos-invoicing-eu` em `eu-vat-oss-ioss`;
  `eurolify-country-readiness-eu` no motor de regras por país
  (`apps/api/src/regras/`, ADR-0034). As novas dizem-se complementares e
  mandam usar as existentes primeiro; não se conferiu linha a linha se
  alguma regra diverge. Ao contrário do pacote de 04/10/2026
  (`pacote-complementar-skills-04out2026.md`), este foi instalado: nomes
  novos, nenhum repete uma pasta existente.
