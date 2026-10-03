# O repo `mart337i/odoo-skills` — avaliado para ideias do Hub, não instalado (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«Verifica estas skills para perceber o que
podemos de implementar a nivel de modulos no hub. que complementem o
eurolify»*, e depois *«só quero ver se dá para aproveitar alguma coisa para o
hub do eurolify, náo para usar o odoo»*. A seguir: *«sim, regista e leva às
skills»*.

## O que se fez

- Clone só de leitura (`--depth 1`) em `/home/user/mart337i/odoo-skills` na
  sessão; último commit `634b2db`, 01/10/2026; licença MIT (`package.json`).
  **Nada foi instalado nem copiado.**
- Lidos: `README.md`, `CLAUDE.md`, a lista das 21 skills, a `odoo-idea-gates`,
  `skills/odoo/ARCHITECTURE.md`, a lista de segurança web, a lista de revisão
  de relatórios e, dos guias da versão 19, as partes citadas abaixo (mixins,
  vistas, acções, dados, segurança, transacções).
- Levadas sete ideias às skills `platform-architect`, `eurolify-design` e
  `observability-security`, como desenho do Eurolify, sem código nem Odoo.

## Veredicto: não se instala; dá ideias de back-office

- **Não é uma lista de módulos de negócio**: são skills para *programar*
  módulos de Odoo (base de dados do Odoo vista pelo código, ecrãs em XML,
  OWL, relatórios, migração entre versões, testes, segurança), versões 17 a 20.
  Os nomes de módulos aparecem só em exemplos de código.
- **Não se instala**: o Eurolify é de raiz (ADR-0002); 15 das 21 skills só
  servem a quem escreve Odoo. O instalador copia para as skills globais e muda
  para uma cópia de segurança as que tiverem o mesmo nome — contra o ADR-0010.
- A sugestão de um conector Eurolify ↔ Odoo ficou de fora: o Diogo não quer
  Odoo.

## As ideias levadas às skills

| # | Ideia | Fonte no repositório | Skill |
|---|---|---|---|
| 1 | Linha do tempo de cada registo (estados, campos, notas, e-mails, anexos) | `skills/odoo-19.0/references/odoo-19-mixins-guide.md`, linhas 15–196 | `platform-architect` |
| 2 | Tarefas sobre um registo, com pessoa, prazo e estado; as filas fiscais viram tarefas, item a item | idem, linhas 197–230 | `platform-architect` |
| 3 | Vistas do Hub: lista com colunas opcionais, quadro por estados, calendário, tabela dinâmica, filtros guardados, barra de estados | `odoo-19-view-guide.md`, linhas 36–359 | `eurolify-design` |
| 4 | Tarefas automáticas aos bocados, com progresso, falhas por registo isoladas, bloqueio do registo, contagem de falhas (3 seguidas / 5 em 7 dias, valores de partida) que avisa | `odoo-19-actions-guide.md`, linhas 251–316 | `observability-security` |
| 5 | Módulos ligáveis com dependências, permissões e dados próprios; dados entregues em duas classes (do comerciante depois de instalados / do Eurolify, actualizados sempre) | `skills/odoo/ARCHITECTURE.md`; `odoo-19-data-guide.md`, linhas 29–46 | `platform-architect` |
| 6 | Permissões em quatro camadas, até ao campo | `odoo-19-security-guide.md`, linhas 27–195 | `observability-security` |
| 7 | Lista de revisão dos documentos impressos (várias páginas, cabeçalho repetido, sem página em branco, traduzido) | `skills/odoo-report-design/REPORT-REVIEW-CHECKLIST.md` | `eurolify-design` |

Ao adaptar, juntaram-se as regras do Eurolify: a linha do tempo entra no RGPD
(exportação e apagamento do titular); as tarefas não autorizam decisões
fiscais em lote; as faturas não são documentos do Eurolify (software
certificado); o campo escondido não sai pela API, exportações, linha do tempo
nem IA.

**Não levado:** o método das 8 «portas» da `odoo-idea-gates` (decidir se um
módulo deve existir: experiência directa, solução existente, gasto existente,
50 compradores alcançáveis, alvo estreito, encaixe, custo de manter, valor em
menos de 30 minutos). Fica aqui; pode ir para a `platform-architect` se o
Diogo ou o Bruno quiserem.

**Não serve:** OWL, os guias por versão no seu detalhe, migração de módulos e
de relatórios entre versões.

## Números (com data e como se contaram)

- 21 skills (README e `.claude-plugin/plugin.json`), 134 ficheiros, 1,8 MB sem
  o `.git` (`find`, `du`, 03/10/2026).
- Nomes de módulos do Odoo nas skills, só em exemplos de código (`grep -o`,
  03/10/2026): «mail» 222, «sale» 152, «portal» 104, «account» 58, «project»
  30, «payment» 27, «crm» 16, «stock» 15.
- Antes de levar a ideia 6, procurei «por campo», «ao nível do campo», «campo
  sensível» e «preço de custo» nos `docs/` e nas skills: só apareceram
  traduções por campo; permissões por campo não estavam escritas.

## O que ficou por verificar

- Li só os guias da versão 19, e destes só as partes citadas; não li a skill de
  testes nem as de site e portal.
- Os valores 3 e 5 falhas são os do Odoo, copiados como ponto de partida; não
  há dados do Eurolify que os justifiquem.
- Não falei com comerciantes sobre estas vistas nem sobre as tarefas.
