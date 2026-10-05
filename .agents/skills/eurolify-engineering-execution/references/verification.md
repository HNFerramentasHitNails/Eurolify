# Testes que provam a proteção

Lê quando muda código ou testes. Usa `eurolify-evidence-before-done` para o fecho e `eurolify-fault-first-debugging` quando há falhas repetidas; não duplica a sua governação.

## Matriz proporcional

| Alteração | Evidência mínima relevante |
|---|---|
| Regra pura | Entradas normais, inválidas e de fronteira; invariantes |
| SQL/RLS | PostgreSQL real, papel API, acesso cruzado e sem contexto, escrita e rollback |
| Estado/versão | Transição permitida e recusada; duas operações efetivamente sobrepostas |
| HTTP | Pedido e resposta, esquema, papel sem acesso, erro normalizado e campos não divulgados |
| Integração | Adaptador simulado para falhas; contrato/sandbox quando disponível, sem efeitos reais |
| Migração | Base anterior com dados, nova base, incompatibilidade e falha controlada |
| Hub | Percurso completo, teclado, carregamento, vazio, erro, conflito e acesso recusado |

Um teste unitário não prova RLS. Uma resposta HTTP simulada não prova o prestador real. Um tipo correto não prova o comportamento. Evita snapshots extensos que apenas tornam difícil perceber o que mudou.

## Torna o teste discriminatório

Escolhe uma proteção central da alteração e, numa cópia/ramo local de ensaio, retira ou altera deliberadamente essa proteção: o teste específico tem de falhar pelo motivo esperado. Restaura imediatamente o código, revê o diff e repete o teste.

Não precisa de instalar uma ferramenta de mutation testing para isto. Nunca faz esta experiência na VPS nem deixa a mutação na entrega. Se o teste continuar verde, corrige o teste antes de alegar que prova a proteção.

Em concorrência, usa barreiras ou estado observado da base; limita a espera e limpa ligações no erro. Testes que dependem de “dormir 300 ms” podem passar sem ter criado a disputa.

## Executa os comandos reais

Confere `package.json`, o pacote afetado e `.github/workflows/verificar.yml` atuais. Na consulta de 05/10/2026, o gate de código tem:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm tipos
pnpm teste
pnpm construir
```

Para testes da base, usa somente uma base descartável e confirma que `BASE_DADOS_URL` aponta para ela; o gate atual usa `EXIGIR_BASE=1`. Não imprime a ligação, não copia segredos para comandos/documentos e não interpreta testes saltados por falta de PostgreSQL como prova de isolamento.

Segue os restantes jobs de CI quando a alteração os afeta; estes cinco comandos não substituem verificações de infraestrutura, imagem ou revisão previstas no projeto. Um teste focado durante a edição não dispensa o gate final.

## Não otimiza o verde

- Não baixa cobertura, remove assertions, muda o contrato esperado ou ignora testes para a alteração passar.
- Um teste instável exige causa identificada, não retries infinitos.
- Usa dados fictícios explícitos, relógio controlado e limpeza isolada. Testes não dependem do estado da loja real.
- Numa correção, acrescenta uma regressão que falhe com a versão antiga e passe com a correção.
- Revê a saída inteira: stderr, stdout, códigos de saída e logs das subprocessos. Sanitizar um campo não chega se um `throw` posterior voltar a imprimir o erro bruto.

## Fecho para gestão

Comunica o que mudou para o comerciante, o que foi realmente testado, o que não foi verificado e o próximo passo. Distingue: desenhado, implementado, testado, revisto e publicado. Não declara uma destas etapas por inferência a partir da outra.
