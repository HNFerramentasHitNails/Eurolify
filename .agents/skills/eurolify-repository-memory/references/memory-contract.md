# Contrato da memória

## Estrutura de referência

Preservar nomes e convenções existentes; estas categorias são semânticas, não uma ordem para renomear o repositório.

| Tipo | Fonte preferencial | Papel no contexto |
|---|---|---|
| Regras operacionais obrigatórias | `AGENTS.md` e imports aprovados | Carregar o necessário conforme regras atuais |
| Decisão aprovada | ADR com autor, data e estado | Abrir quando afeta a tarefa |
| Especificação atual | Documento canónico do domínio | Ler secções relevantes e dependências |
| Memória temática | `memoria/<tema>.md` e índice | Factos datados, provas e evolução |
| Estado da implementação | Código, testes e commit | Fonte atual, não descrição antiga |
| Handoff transitório | Checkpoint/issue/PR conforme convenção | Reabrir só para continuar trabalho |
| Histórico/anexo | Originais e versões no Git | Recuperar quando necessário |

## Índice compacto

Na Eurolify, seguir o limite existente de uma linha por memória e até 300 caracteres, sem reescrever os nomes antigos das memórias datadas (`AGENTS.md`, «Memória»). Não repetir a memória inteira no índice.

Uma entrada útil contém tema, estado quando relevante, data e caminho. Criar secções por domínio quando o índice crescer; novos subíndices e alterações às leituras obrigatórias exigem aprovação, porque não se devem sobrepor ao arranque atual.

## Leitura progressiva

1. Regras de entrada atuais e índice.
2. Pesquisa por termos e caminhos, incluindo sinónimos do tema.
3. Trecho que sustenta a decisão.
4. Documento integral só se contexto, ambiguidades ou dependências exigirem.
5. Histórico/commit original quando datas, conflitos ou autoria forem importantes.

Exemplo de diagnóstico:

```bash
rg -n 'VIES|perfil fiscal' memoria docs
sed -n '40,95p' docs/<ficheiro-identificado>.md
git show <commit>:<caminho>
```

Não interpretar pesquisa vazia como prova universal de ausência. Ampliar termos e verificar fonte/branch antes de concluir.

## Escrita

**Na Eurolify, uma memória segue o formato do `AGENTS.md`** («Memória»: um ficheiro por tema, com a data no nome, e as secções «o que se fez», «números (com data e como se contaram)» e «o que ficou por verificar»). O modelo abaixo serve só para um checkpoint ou para os campos de uma entrada; não substitui esse formato.

```text
Tema:
Data do facto / data da verificação:
Estado: confirmado | proposta | por_verificar | substituído
Autor/decisor:
Facto ou decisão:
Evidência: ficheiro e linhas, commit, PR ou URL oficial
Consequências:
Substitui / contradiz:
Próxima revisão, quando aplicável:
```

Facto confirmado por uma ferramenta, afirmação do utilizador e inferência do assistente devem permanecer distintos. Uma verificação fiscal/legal é datada, não uma verdade eterna.

Guardar resultados de testes com comando, ambiente e resultado, não apenas “passou”. Quando o commit mudar, invalidar pressupostos relevantes em vez de reutilizar cegamente o checkpoint.

## Consolidação segura

Duplicado exato é candidato à revisão, não autorização para apagar. Comparar consumidores, referências, contexto e estado antes de escolher fonte única.

Para conteúdo obsoleto, manter prova e ligação ao sucessor; preserva citações/história. Não reescrever decisões antigas como se sempre tivessem sido as novas.

Objetivo: eliminar duplicação do contexto carregado, não necessariamente eliminar ficheiros. Um documento longo fora da conversa pode ser perfeitamente adequado.

## Medição e confidencialidade

As recomendações oficiais incluem instruções concisas, skills especializadas sob pedido e inspeção do consumo de contexto ([Claude Code: custos](https://code.claude.com/docs/en/costs)). Não prometer “tokens mínimos” ou poupança percentual sem medição.

O script do pack calcula bytes/linhas e duplicados exatos, não semântica, obsolescência, competência da fonte ou tokens. Não pesquisa rede, não segue symlinks, não lê ficheiros não Markdown e não imprime corpos dos documentos.

Todos os caminhos, títulos e relatórios devem respeitar a confidencialidade do repositório. Não publicar o relatório nem enviar documentos privados para serviços externos só para resumir.
