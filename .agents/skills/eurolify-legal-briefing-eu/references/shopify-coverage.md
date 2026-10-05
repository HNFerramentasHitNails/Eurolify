# Cobertura funcional, não certificação por comparação

Usa Shopify apenas como referência de amplitudes e percursos. As permissões/settings, lançamento Plus, inventário e configuração de checkout estão documentados separadamente; não existe um número fixo de páginas que demonstre completude de uma implementação ([permissões](https://help.shopify.com/en/manual/your-account/users/roles/permissions/settings-permissions), [lançamento](https://help.shopify.com/en/manual/intro-to-shopify/plus-launch-checklist), [inventário](https://help.shopify.com/en/manual/products/inventory), [checkout](https://help.shopify.com/en/manual/checkout-settings)).

## Inventário de percursos a desenhar

| Área | Percurso e controlo a especificar |
|---|---|
| Organização e lojas | Entidades, estabelecimentos, membros, funções, separação entre comerciantes |
| Catálogo | Artigo/variante, opções, ficheiros, traduções, preços, classificação setorial, dados de segurança e identificadores |
| Inventário e compras | Localizações, fornecedores, pedidos de compra, receção, reserva, transferências, lotes e contagem |
| Venda online | Pesquisa, produto, carrinho, informação pré-contratual, checkout, conta e confirmação |
| Venda física | Dispositivo, caixa, sessões, operador, recibos/faturas, pagamento, devolução e operação offline apenas quando permitida |
| Canais comerciais | Distribuidor, revendedor, franchisado e consumidor; contratos, listas de preços, limites e identidade do vendedor |
| Encomenda | Estados aprovados, versões, pagamentos, expedição parcial, cancelamento, devolução e correção fiscal |
| Logística | Rotas, embalagem, transportador, tarifa, prazos, etiquetas, ocorrências e retorno |
| Finanças | Valores segregados, documentos, reembolsos, reconciliação, disputa e exportação ao contabilista |
| Países/mercados | Idioma, moeda aprovada, entidade, fiscalidade, restrições, dados obrigatórios e prontidão |
| Conteúdo e marca | Páginas, tema, domínios, menus, pesquisa, metadados, acessibilidade e tradução |
| Comunicação | Notificações transacionais, consentimentos distintos, preferências e prova de entrega |
| Marketing | Descontos, campanhas, alegações, avaliações, fidelização e cartões-oferta só quando habilitados |
| Dados e integrações | API, webhooks, apps, permissões, versionamento, exportação e auditoria |
| Operação e segurança | Alertas, incidentes, evidência, privacidade, retenção, recuperação e suporte |
| Administração da plataforma | Comerciante, permissões próprias, planos, faturação SaaS, operação e auditoria sem acesso indevido a dados |

Campos e percursos são agenda de desenho, não funcionalidades já entregues. Consulta os estados/decisões reais do repositório antes de propor alterações; não pressupõe que mockups sejam código funcional.

## Pequeno e grande comerciante

Expõe configuração progressiva: início guiado e poucos campos relevantes para uma pequena loja; funções, múltiplas localizações, aprovações, integrações e processamento em volume para operações complexas. Os controlos obrigatórios não desaparecem por simplificação visual.

Para cada percurso, regista ator, entrada, saída, permissões, dados sensíveis, fonte/regra aplicável, integração, estados de erro e teste. Demonstra o percurso completo e casos adversos em vez de medir sucesso pelo número de ecrãs.

Uma comparação funcional não demonstra o que Shopify cumpre em cada país/setor. Não copiar avisos fiscais, configurações ou termos de outro comerciante como base legal.
