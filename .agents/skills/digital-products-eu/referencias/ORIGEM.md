# Origem desta skill

| Origem | Versão (data) | Licença declarada | O que se trouxe |
|---|---|---|---|
| zip `Eurolify___Skills_de_Produtos_Digitais_e_Cart_es-oferta_na_UE.zip` enviado pelo Diogo na sessão de 04/10/2026 (sha256 começa por `0cfde2da3973376b`), pasta `.claude/skills/eurolify-digital-products-eu` | 1.0.0 (revista a 04/10/2026, segundo o próprio pacote) | MIT (no cabeçalho do `SKILL.md`; o autor não está identificado) | `SKILL.md` → `../SKILL.md`; `references/legal-rules.md` → `regras-legais.md`; `references/implementation-tests.md` → `desenho-e-testes.md` |

Instalada a 04/10/2026, a pedido do Diogo (*«sim, instala as duas skills»*).

**Alterações feitas** (o conteúdo não é igual ao original):

- nome `eurolify-digital-products-eu` → `digital-products-eu`, como as outras
  skills de regras;
- em `.agents/skills/` com uma ligação em `.claude/skills/` (ADR-0010), e não
  copiada para `.claude/skills/` como mandava o README do pacote;
- reescrita em português de Portugal, com as palavras do repositório;
- **marcas W/M/C**: tudo **C**, menos o art. 16.º, alínea m), da Dir.
  2011/83/UE, que a `consumer-rights-eu` já tinha como **W · texto lido**;
- ligada às skills do Eurolify (consumidor, IVA, RGPD, pagamentos, catálogo);
- o «procedimento» do pacote (inspeccionar o repositório, migrações, código)
  ficou de fora: o código de um domínio só depois do desenho dele (ADR-0023).

**Não verificado:** nenhuma das fontes citadas foi lida no EUR-Lex. A sessão
de 04/10/2026 tentou três endereços e recebeu uma resposta vazia (código 202).
