# Desenho e testes dos produtos digitais

> Do pacote enviado pelo Diogo a 04/10/2026 (`ORIGEM.md`). Os nomes são
> **propostas**: adaptam-se ao desenho de cada domínio (o Catálogo em
> `docs/14-dominio-catalogo.md`) e às ferramentas do ADR-0025.

## Dados propostos

| Registo | O que guarda | Domínio provável |
|---|---|---|
| tipo do artigo | físico, serviço humano, conteúdo digital, serviço digital, cartão-oferta | Catálogo (P3 do `docs/14`) |
| perfil digital | subtipo, modo de fornecimento, periodicidade, formato, compatibilidade, interoperabilidade, requisitos, licença, política de actualizações | Catálogo |
| perfil fiscal | quem vende e fatura, classificação fiscal, territórios, versão da regra e vigência — **nunca uma taxa única «digital»** | Motor de IVA |
| fotografia do contrato | preço, moeda, IVA, direitos informados, textos com versão e língua, cópia duradoura | Checkout |
| pedido de início antecipado e reconhecimento da perda | acção afirmativa, momento, contrato e linhas; à parte dos cookies e do marketing | Checkout |
| entrega | autorização, disponibilização, início efectivo observado, versão do ficheiro, estado, erro. E-mail enviado ≠ descarga iniciada | Encomendas / Envios |
| direito de acesso | titular, vendedor, ficheiro ou licença, activo ou revogado, datas, encomenda de origem | novo — fronteira por decidir |
| caso de livre resolução | fundamento, prazo e regra aplicada, recepção, comprovativo, decisão e reembolso | Devoluções |

## Fluxos

1. Validar o artigo e o território; confirmar o fornecedor perante o IVA e o
   preço **antes** do compromisso de pagar.
2. Pedir o consentimento quando for preciso. Sem pedido válido, a entrega fica
   para depois do prazo ou de novo pedido; **nunca obrigar a renunciar para
   comprar**.
3. Confirmar o pagamento no servidor, por aviso verificado, idempotente e
   conciliado. Pagar com cartão-oferta não dispensa o consentimento nem o
   IVA.
4. Gerar a confirmação imutável em suporte duradouro antes de dar a perda do
   direito como certa.
5. Entregar por armazenamento privado na UE e endereço assinado curto;
   registar os eventos sem tokens nem ficheiros pessoais nos registos.
6. Tratar livre resolução e desconformidade à parte; revogar acessos quando
   couber, sem apagar o que a lei obriga a guardar.
7. Subscrições: mostrar renovação, período, preço e cancelamento; separar não
   renovação, livre resolução e resolução por incumprimento.

## Só na UE

Lista proposta: AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT,
LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE, com os territórios especiais
em configuração com versão. Pedir prova da região do alojamento, réplicas,
registos, e-mail, descargas, análises, suporte, prestador de pagamento e
subcontratantes. Até lá: «só UE — por confirmar», nunca «100 % soberano».

## Testes que impedem o lançamento

| Caso | Resultado exigido |
|---|---|
| Ebook, pedido de início válido e confirmação | Disponibilização controlada; perda do direito só com todas as condições e a execução iniciada |
| Ebook, caixa vazia | Compra possível com entrega adiada; nenhuma renúncia registada |
| Caixa pré-seleccionada ou só aceitação dos termos | Não conta como consentimento expresso |
| A confirmação falhou | O direito não se dá como perdido; nova tentativa idempotente |
| Subscrição digital começou | Não se marca execução integral nem direito perdido |
| Conteúdo com defeito depois de renúncia válida | Abre reclamação de desconformidade; nunca «sem devoluções» |
| Físico + ebook no carrinho | O consentimento do ebook não toca na livre resolução do físico |
| Ebook pago com cartão-oferta | Regras digitais e resgate do vale aplicados à parte |
| País fiscal e provas contraditórias | Decisão fiscal bloqueada ou enviada para validação; nunca uma taxa de recurso |
| Vendedor com várias lojas | Limiares somados por sujeito passivo |
| Cliente B2B sem validação suficiente | Sem autoliquidação automática |
| Território fiscal não suportado | Mensagem própria; não se finge que deixou de ser UE |
| Aviso de pagamento repetido | Uma entrega, um acesso, um documento fiscal |
| Endereço de outra conta ou de outro comerciante | Acesso negado; tokens fora dos registos |
| Livre resolução online | Função acessível, confirmação e comprovativo em suporte duradouro |
| Rede de entrega, cópias ou suporte fora da UE sem aprovação | A porta «só UE» não passa |

Testes unitários, de integração e de ponta a ponta com as ferramentas reais
(Vitest com base real, ADR-0025). Diz-se o que correu; uma lista escrita não é
execução.
