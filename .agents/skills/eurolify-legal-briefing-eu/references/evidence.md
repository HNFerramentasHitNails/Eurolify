# Evidência jurídica e autorização

Preserva o significado W/M/C do projeto. Não cria um novo significado para converter pesquisa em aprovação.

- **W:** confirmação por pesquisa web, normalmente resumo. Usa `W · texto lido` apenas para artigos efetivamente lidos, identificados na ficha; não significa leitura de todo o diploma ou de todas as alterações.
- **M:** facto medido ou decisão documentada na memória, com data e origem. Não torna uma decisão comercial numa norma legal.
- **C:** conhecimento geral ou conclusão ainda não confirmada para o caso. Exige confirmação antes de sustentar a ativação.

O rótulo W/M/C, a leitura da fonte, a implementação, o teste e a aprovação por profissional são dimensões separadas. Uma skill, uma página oficial ou um teste verde não certificam uma loja.

## Preencher uma ficha

1. Usa `../templates/rule-record.yaml`; identifica entidade, papel, países/territórios, produto, canal, contrato e hipótese factual.
2. Distingue obrigação legal, orientação não vinculativa, norma técnica, recomendação de engenharia e decisão comercial.
3. Regista URL oficial, título/ato, artigo/anexo, versão, data de consulta, trecho relevante e extensão realmente lida.
4. Para fontes resumidas, procura o texto vigente antes de uma decisão vinculativa. Uma versão original histórica pode ter artigos ultrapassados.
5. Separa publicação, entrada em vigor, aplicação e transposição. Documenta exceções e validação nacional pendente, sem copiar automaticamente conclusões entre países.
6. Regista quem validou profissionalmente, qualificação/jurisdição, âmbito e limitações somente quando existir validação real. Não inventa nomes, assinaturas, datas ou pareceres.
7. Relaciona requisitos a decisão/ADR, implementação, teste, integração e evidência. Sem evidência suficiente, entrega o bloqueio e a pergunta que o resolve.

## Regras de fonte

Prioridade: texto oficial atualizado, autoridade nacional competente, interpretação/orientação oficial. Contactos num diretório oficial não comprovam que o conteúdo do sítio nacional foi lido.

Usa o catálogo como ponto de partida, não como base de conhecimento jurídica definitiva. Os extratos de pesquisa são resumos com data; volta a consultar a fonte quando a decisão exige a versão vigente. As lacunas ficam explícitas, incluindo fontes inacessíveis e jurisdições não analisadas.

## Exemplo de conclusão permitida

“Foi localizado o artigo que regula o identificador dos medicamentos abrangidos. Falta verificar se o produto e o vendedor estão autorizados no país; por isso, não é possível ativar a venda.”

Não concluir: “DataMatrix implementado, medicamentos legais nos 27 países.” A decisão de ativação continua sujeita a autorizações, enquadramento do caso e governação do projeto.
