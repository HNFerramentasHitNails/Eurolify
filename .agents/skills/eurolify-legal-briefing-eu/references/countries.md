# Matriz dos 27 Estados-membros

Usa antes de ativar país, território, canal ou setor. Consulta só a entrada necessária em `countries.json`; não carrega os 27 registos por rotina.

O ponto de partida é o [diretório oficial de administrações fiscais da Comissão Europeia](https://taxation-customs.ec.europa.eu/national-tax-websites_en), consultado a 05/10/2026. Os contactos nele listados não são prova de um regime fiscal aprovado nem uma lista de todos os reguladores.

## Estado inicial do conjunto

- Os 27 Estados-membros têm uma entrada.
- Contactos são os referenciados pelo diretório; o acesso individual e a atualidade de cada contacto não foram auditados.
- Legislação nacional, caixa fiscal, IVA aplicável à operação, emissão, consumidores, licenças, produto e transportes permanecem por verificar.
- Nenhum registo significa autorização para operar nesse país. Não altera prontidão existente no repositório; são fichas de investigação deste pacote, não configuração executável.

## Dossier por país e operação

1. Confirma país/território e estabelecimentos; guarda origem/destino fiscal separadamente.
2. Localiza diário oficial/legislação consolidada e autoridades: fiscal, consumidor/RAL, proteção de dados, produto/setor, pagamentos, resíduos e transporte, conforme o caso.
3. Confirma idioma e requisitos locais: preços/unidades, garantia, reclamações, retenção, documentos, recibos/POS e licenças.
4. Para diretiva UE, lê a transposição local atual. Para regulamento, verifica também medidas nacionais de execução quando pertinentes.
5. Regista responsável profissional, fonte, artigo, versão, vigência, exceções e testes.
6. Conclui por **país + território + setor + papel + canal**, não por uma bandeira verde genérica.

## Saída da pesquisa

`confirmado`, `não aplicável com fundamento`, `pendente`, `bloqueado` e `revogado/substituído` precisam de evidência. Se não houver fonte suficiente, escreve “não verificado”, sem inventar taxa ou prazo.

As condições nacionais podem diferir: a Comissão atribui aos Estados-membros responsabilidade por transpor/aplicar o IVA e informar a sua interpretação ([informação de IVA por país](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates/country-specific-information-vat_en)). A lista de países não substitui essa pesquisa.
