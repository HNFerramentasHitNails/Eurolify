# O repo `40RTY-ai/shopify-admin-skills` — avaliado, não instalado (03/10/2026)

**Pedido do Diogo (03/10/2026):** *«https://github.com/40RTY-ai/shopify-admin-skills
achei esta skill do shopify. verifica se pode ser util?»*

**Como se leu:** clone de leitura (`--depth 1`) em `/home/user/40rty-ai/shopify-admin-skills`
na sessão; último commit `6765cb4`, 14/08/2026. Lidos: `README.md`, `CLAUDE.md`,
`SKILL.md`, `LICENSE`, os scripts, uma rotina e 5 skills (fusão de clientes,
procura de duplicados, IVA, `llms.txt`, o resumo da categoria «agentic»).
**Nada foi instalado nem copiado.**

## O que é (contado na cópia de 03/10/2026)

- **116 skills** em 11 categorias (`find skills -name SKILL.md`), todas marcadas
  `status: stable`, e **21 rotinas** agendadas que avisam por Slack.
- Cada skill é uma receita para um assistente operar **uma loja Shopify** pela
  API GraphQL de Administração; as que escrevem têm `dry_run: true` por omissão.
- Licença **MIT**.

## Serve ao Lumavo? Como referência, não como código

O Lumavo substitui o Shopify; estas skills só falam com o Shopify. O que vale:

1. **Uma lista de 116 tarefas reais de um comerciante** (devoluções por motivo,
   conciliação de pagamentos, stock parado, clientes em risco…). Serve para
   conferir se a API de Administração e o MCP do Lumavo respondem a tudo isto —
   registado na skill `headless-commerce`.
2. **O formato**: cada tarefa declara as operações da API que usa, uma secção de
   segurança e o ensaio sem escrever por omissão — o mesmo padrão que o Lumavo
   quer para as ferramentas MCP.
3. **A categoria «agentic»** (10 skills: `llms.txt`, dados estruturados do
   produto, GTIN, texto alternativo das imagens, políticas legíveis por IA) é uma
   boa lista do que o Lumavo deve gerar **de raiz** para os agentes de compras.

## O que choca com as regras do Lumavo (não se importa tal como está)

- **Identidade pelo nome:** a procura de duplicados junta clientes por e-mail,
  telefone **ou nome**, e a fusão manda confirmar que são a mesma pessoa por
  «e-mail, telefone, nome». Contraria a regra 1.4 de
  `docs/04-licoes-dos-sistemas-actuais.md` (NIF primeiro, nunca pelo nome,
  decide uma pessoa). E as duas skills contradizem-se: uma diz que a API não
  funde clientes, a outra usa a fusão da API.
- **IVA:** o resumo de impostos agrupa pelo **nome da linha de imposto** e por
  estado/província (lógica americana), sem os quatro baldes do OSS nem notas de
  crédito — é exactamente o erro das regras 2.7 e 2.8.
- **Rotinas presas à loja do autor:** 8 das 21 rotinas, o `CLAUDE.md` e o
  `scripts/dev-session.sh` têm escrito o domínio `91pqhx-iy.myshopify.com`.
  Instaladas sem mexer, apontariam para a loja de outra pessoa.
- **Operações em lote** (preços, etiquetas, expedições) — aceitáveis noutros
  domínios, nunca no fiscal.
- A categoria «agentic» encaminha para um serviço de auditoria de terceiros
  (`agentiq.report`). **Não verifiquei** de quem é.

## Para a loja Shopify que a empresa já tem (fora do Lumavo)

Algumas skills **só de leitura** podiam ajudar a operar a loja actual, mas isso é
outro projecto: instalar um plugin com acesso de escrita a uma loja em produção
toca em clientes e faturação e passa pelo Bruno.

## O que ficou por verificar

- Li 5 das 116 skills; as conclusões sobre as outras são pelo título e pela
  categoria.
- Não corri nada contra loja nenhuma.
