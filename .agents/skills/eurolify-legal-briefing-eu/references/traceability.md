# SKU, identificadores e rastreabilidade

Usa antes de definir modelo, scanner ou impressão. As normas técnicas não são leis universais; usa a regra do setor e o contrato aplicáveis.

## Não confundir os objetos

| Objeto | Uso no desenho |
|---|---|
| SKU | Referência comercial interna da variante, segundo regras atuais do Catálogo |
| GTIN | Identificador de item comercial no sistema GS1; não é um SKU convertido |
| Lote | Grupo identificado segundo o processo de produção/fornecimento |
| Série | Identifica uma unidade individual no seu âmbito |
| SSCC/GLN | Unidades logísticas/locais no esquema GS1, se usado |
| Data Matrix | Simbologia de código 2D; o conteúdo depende do esquema |
| GS1 DataMatrix | Implementação GS1 com regras de sintaxe e Application Identifiers |
| QR/Digital Link | Portador/ligação a informação; não é por si só um passaporte conforme |
| UDI | Identificação setorial de dispositivos médicos, não uma licença de venda |
| DPP/passaporte | Registo de informação e acessos no regime do produto |

A separação de identificadores e portadores é técnica; o guia GS1 trata explicitamente GS1 DataMatrix e a sintaxe de Application Identifiers ([guia GS1](https://www.gs1.org/docs/barcodes/GS1_DataMatrix_Guideline.pdf)). Confirma a versão pertinente antes de implementar uma biblioteca.

## Regras setoriais verificadas

- **Medicamentos abrangidos:** o art. 5 do Reg. Delegado 2016/161 determina Data Matrix para o identificador único; não exige especificamente GS1 como único esquema e tem âmbito/exceções próprios ([arts. 2 e 5](https://eur-lex.europa.eu/eli/reg_del/2016/161/oj/eng)).
- **Dispositivos médicos:** há várias entidades emissoras UDI designadas, incluindo GS1, HIBCC, ICCBBA e IFA; não considera GS1 DataMatrix a única opção universal ([entidades UDI](https://webgate.ec.europa.eu/udi-helpdesk/en/udi-assignment/issuing-entities.html)).
- **Baterias:** os arts. 77 e 13(6) distinguem passaporte para baterias LMT, industriais acima de 2 kWh e de veículos elétricos, acessível por QR, desde 18/02/2027 ([texto legal](https://eur-lex.europa.eu/eli/reg/2023/1542/oj/eng)).
- **Passaporte geral:** o DPP é introduzido por grupos de produto e atos pertinentes; não é exigência universal de DataMatrix para todo o catálogo ([Comissão, DPP](https://single-market-economy.ec.europa.eu/single-market/digital-product-passport_en)).
- **Alimentos:** o art. 18 exige sistemas para identificar fornecedores e empresas destinatárias, e disponibilizar informação às autoridades; não determina um portador universal de código ([Reg. 178/2002](https://eur-lex.europa.eu/eli/reg/2002/178/oj/eng)).
- **Retalho 2D:** “Ambition 2027” é uma meta técnica industrial de capacidade de leitura POS, não uma obrigação geral da UE para todos os comerciantes ([playbook GS1](https://ref.gs1.org/sme-guidance/2d-playbook/1.0.0/)).

## Sintaxe GS1, se o esquema for escolhido

O guia identifica AI `01` para GTIN, `10` para lote, `17` para validade e `21` para série, com campos de comprimento fixo/variável e separadores apropriados ([guia GS1](https://www.gs1.org/docs/barcodes/GS1_DataMatrix_Guideline.pdf)). O FNC1 inicial e separadores de elementos variáveis fazem parte da estrutura; o scanner pode transmitir o separador como ASCII 29 ([guia GS1](https://www.gs1.org/docs/barcodes/GS1_DataMatrix_Guideline.pdf)).

Guarda identificadores como texto e preserva zeros; valida comprimento, caracteres, dígito de controlo e emissor conforme o esquema. Não presume que parênteses de apresentação são os bytes codificados. Usa dados fictícios de teste que não sejam apresentados como identificadores atribuídos a produtos reais.

## Modelo operacional proposto

Mantém relações explícitas entre variante, identificação externa, embalagem, lote, série, origem e movimentos. Captura dados originais do scan, interpretação validada, operador e contexto, sem expor dados pessoais publicamente.

Estados propostos: disponível, reservado, em quarentena, expedido, devolvido, recolhido, destruído; os estados efetivos precisam do desenho de Stock/Encomendas e não são impostos por esta tabela.

Não sobrescreve GTIN/lote/série para corrigir uma venda passada. Regista correção e ligação à prova original. Divisão, agregação e transformação preservam genealogia quando o setor/processo o exigir.

Testa código desconhecido, truncado, duplicado, multiportador, grupo variável, qualidade de impressão, offline, embalagem superior, validade e bloqueio de lote recolhido. Decodificar o símbolo e conferir a legalidade do produto são verificações distintas.
