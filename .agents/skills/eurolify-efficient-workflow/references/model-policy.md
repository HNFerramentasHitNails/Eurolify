# Política de modelos e escalonamento

Esta é uma política proposta, não um benchmark. Confirmar versão do Claude Code, fornecedor, modelos disponíveis e limites organizacionais antes de configurar.

## Modelo inicial por tarefa

- **Haiku:** pesquisa localizada, extração de factos já presentes, classificação simples e inventários sem decisões de risco.
- **Sonnet:** implementação diária, testes e alterações delimitadas com contratos conhecidos.
- **Opus 5.5:** arquitetura ambígua, decisões entre domínios, isolamento/segurança, concorrência, migrations difíceis, revisão crítica e problemas particularmente longos/difíceis.

A documentação apresenta Sonnet para programação diária, Opus para raciocínio complexo e Haiku para tarefas simples/eficientes; os aliases resolvem de acordo com fornecedor e disponibilidade ([modelos Claude Code](https://code.claude.com/docs/en/model-config)). As associações detalhadas acima são decisões deste pack.

Por decisão do utilizador, não utilizar Fable, nem como fallback ou próximo degrau de escalonamento. Esta preferência não é apresentada como benchmark universal. Avaliar eficiência total, incluindo contexto, tentativas e retrabalho; Haiku e Sonnet são o padrão da Eurolify para a pesquisa e a execução; Opus 5.5 para a análise e a revisão, e noutras tarefas quando der melhor resultado global observado, dizendo porquê.

## Mecanismos reais

`/model sonnet`, `/model opus` e `/model haiku` são opções de sessão; `opusplan` combina Opus no planeamento com Sonnet na execução ([configuração](https://code.claude.com/docs/en/model-config)). A versão concreta de um alias pode mudar, pelo que reprodução exige registar o modelo resolvido, quando disponível.

Um agente personalizado pode definir `model: haiku`, `sonnet`, `opus` ou outro valor suportado, e limitar ferramentas com `tools`; verificar a precedência entre invocação, definição, ambiente e modelo principal ([subagentes](https://code.claude.com/docs/en/sub-agents)). Uma configuração é um mecanismo real, mas a sua existência não prova que uma tarefa foi delegada.

O subagente `eurolify-critical-review` (`.claude/agents/`) fixa `model: claude-opus-5-5`, identificador documentado, em vez de depender do alias `opus` ([subagentes](https://code.claude.com/docs/en/sub-agents)). Se o fornecedor não aceitar esse identificador, confirmar a configuração equivalente de Opus 5.5 com o utilizador; não substituir silenciosamente por outro modelo.

O Claude Code também documenta overrides de modelo em skills, sujeitos à versão e política da organização; este pack evita esses campos para preservar o formato portátil e usa agentes separados ([skills](https://code.claude.com/docs/en/skills)). Não inventar configurações universais que garantam roteamento em todas as instalações.

## Eficiência sem atalhos

Não usar modo de contexto expandido, esforço máximo ou agentes em paralelo como defaults. Avaliar contexto e esforço segundo necessidade; opções e comportamento dependem do modelo ([configuração](https://code.claude.com/docs/en/model-config)).

Cada delegação precisa de objetivo, input mínimo, restrições, ficheiros e resultado esperado. Receber achados/caminhos/evidência, não uma segunda narrativa completa do projeto.

Não delegar validação jurídica ou fiscal final a Haiku por ser uma extração curta. Um modelo mais forte também não substitui fonte primária, profissional ou responsável humano.

## Medir

Comparar tarefas semelhantes, mantendo qualidade e verificação. Registar modelo real, duração observada, utilização disponibilizada pelo runtime, tentativas, ficheiros reabertos e defeitos encontrados depois.

Consultar `/usage` e `/context` quando disponíveis e distinguir utilização de sessão, limites do plano e faturação de API ([custos](https://code.claude.com/docs/en/costs)). Não estimar custo ou poupança a partir de bytes, linhas ou número de agentes.
