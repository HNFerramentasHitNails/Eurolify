# Imagens: metadados retirados e ficheiros sem uso (#179) — 09/10/2026

## O que se fez

- **Desenho e código** no #215 (decisão `docs/06` CV), com a migração 0035.
- **Metadados:** `catalogo/sem-metadados.ts` percorre o JPEG, o PNG e o WebP e deixa de fora os blocos de metadados, sem voltar a codificar a imagem.
  - **Fica:** no JPEG, a orientação e o JFIF sem miniatura; também o perfil de cor e o Adobe.
  - **Recusa-se** (400) uma imagem que não se consegue percorrer até ao fim, ou que tem mais de 65 536 blocos.
- **Ficheiros sem uso:** a tabela interna `ficheiro_sem_uso` e a limpeza diária na própria API (`catalogo/limpeza-ficheiros.ts`). O ficheiro sai ao fim de 7 dias, na fila dos envios do comerciante; um envio novo dos mesmos bytes renova a contagem.
- **VPS:** a `eurolify-verificacao` avisa com ficheiros sem uso há mais de 9 dias, e o `preparar.sh` dá o EXECUTE ao `eurolify_limpeza`.
- **Pessoas nas imagens:** são responsabilidade do comerciante (subcontratante). Ficou uma pergunta ao jurista (`docs/12`, B, ponto 8) e a linha T9 no `docs/17`.
- **Publicado no ensaio:** o registo diz «migrar: aplicadas 0035_catalogo_ficheiros_sem_uso». O script da VPS também foi aplicado.

## Números (com data e como se contaram)

- **Testes da API, 09/10/2026:** 929 de 929, contados pelo vitest no meu ambiente. O teste das imagens tem 23 casos.
- **Pixels:** as 10 imagens de teste deram os mesmos pixels antes e depois de limpas. Comparei-as com o Pillow, no meu ambiente; no CI, o teste só compara se houver Python com o Pillow.
- **Ficheiro com 5 milhões de marcadores:** sem o limite de blocos, era aceite em 2,1 s; com ele, é recusado de imediato. Medido pela mutação.

## O que ficou por verificar

- Quantos navegadores aplicam a orientação do EXIF no WebP e no PNG (lá não fica).
- Os ficheiros que ficaram no disco sem linha na tabela (se o COMMIT falhar) não são limpos.
- As imagens de teste que já estavam no ensaio continuam com os metadados.
