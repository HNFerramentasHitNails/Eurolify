// Os motivos de retenção de um documento (docs/29 §5, R3) e os que uma pessoa
// pode libertar (R9), num módulo só com constantes: a API usa-os e o Hub mostra
// um texto para cada um, sem carregar o código de execução da faturação
// (revisão do #399, P2-3).

/** Os motivos de retenção (docs/29 §5, R3): lista fechada. */
export const MOTIVOS_RETENCAO = [
  "emissor_por_configurar",
  "ligacao_sem_teste",
  "nif_recusado",
  // Um NIF de consumidor final dado como NIF, ou uma empresa sem NIF: sairia
  // como consumidor final, por isso nunca se liberta, corrige-se (R4, Q4;
  // revisão do #312, P2-3).
  "nif_consumidor_final",
  "perfil_de_outra_ficha",
  "isencao_sem_prova",
  "taxa_sem_mapa",
  "isencao_sem_mapa",
  "taxa_por_verificar",
  "territorio_por_decidir",
  "moeda_nao_suportada",
  "totais_nao_batem",
  "entidade_do_emissor_diferente",
  // A pós-venda (docs/30): a NC espera pela fatura e não passa o saldo dela;
  // uma fatura de uma encomenda já reembolsada por inteiro espera pelo
  // contabilista (C2).
  "original_por_emitir",
  "credito_acima_do_saldo",
  "encomenda_reembolsada",
  // A NC só sai depois de o dinheiro sair (o reembolso executado); um
  // reembolso anulado deixa a NC retida para sempre (revisão do #329, P1-4;
  // a ordem final é a pergunta C1 do contabilista).
  "reembolso_por_executar",
  "reembolso_cancelado",
  // O Moloni pede, na NC, o id de cada linha da fatura (`related_id`), que a
  // documentação não diz onde se lê: até se medir, a NC de uma fatura do
  // Moloni fica retida e trata-se no Moloni (docs/29 §13.6, M7; DZ).
  "nota_credito_sem_adaptador",
] as const;
export type MotivoRetencao = (typeof MOTIVOS_RETENCAO)[number];

/**
 * Os motivos que uma pessoa pode libertar (R9): o que ela sabe e o sistema
 * não (o número está certo, a prova existe). Os outros resolvem-se na
 * configuração ou corrigindo, e depois verifica-se outra vez.
 */
export const LIBERTAVEIS: readonly MotivoRetencao[] = [
  "nif_recusado",
  "isencao_sem_prova",
  "perfil_de_outra_ficha",
  "encomenda_reembolsada",
];
