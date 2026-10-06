// As linhas do docs/03 que dizem quem valida cada tema (decisão BR, Diogo,
// 06/10/2026, revisão do #126: «fica a a)»; issue #128). Cada regra do motor
// diz de que linha vem (`tema`), e só valida um papel indicado nessa linha
// (coluna «Quem valida»). O teste regras-temas.test.ts lê o docs/03 e falha se
// esta tabela deixar de dizer o mesmo que ele.
//
// O profissional fiscal de cada país da coluna (asesor fiscal, Steuerberater…)
// regista-se como `contabilista` (convenção escrita no docs/03). Uma linha com
// «—» não tem papel: nenhum profissional a valida até o docs/03 o dizer.
// A secção 6 do docs/03 (protocolos) não é lei e fica de fora.

import type { Dominio, PapelDeValidacao } from "./tipos.js";

export interface TemaDocs03 {
  /** Identificador estável, usado no campo `tema` da regra. */
  id: string;
  /** A secção do docs/03 (1 a 5). */
  seccao: 1 | 2 | 3 | 4 | 5;
  /**
   * O domínio do motor em que vive uma regra desta linha (decisão do Diogo,
   * 06/10/2026, revisão do #133, P2-2: «fica a a)»), pelas definições dos
   * domínios em docs/eurolify/compliance-gaps.md §1. null: a linha não cabe
   * em nenhum domínio do motor e nenhuma regra a pode usar até se decidir.
   */
  dominio: Dominio | null;
  /** O texto da coluna «Tema», sem a formatação. */
  titulo: string;
  /** A coluna «Quem valida», tal como o docs/03 a escreve. */
  quemValida: string;
  /** A coluna «Quem valida», nos papéis do motor; vazio = «—». */
  papeis: readonly PapelDeValidacao[];
}

const C = ["contabilista"] as const;
const J = ["jurista"] as const;
const T = ["tecnico_regulamentar"] as const;

const LINHAS: readonly TemaDocs03[] = [
  // 1. Impostos e faturação
  {
    id: "oss",
    seccao: 1,
    dominio: "iva",
    titulo: "IVA nas vendas à distância na UE (OSS)",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "ioss",
    seccao: 1,
    dominio: "iva",
    titulo: "Importações de baixo valor (IOSS)",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "isencao-aduaneira-150",
    seccao: 1,
    dominio: "iva",
    titulo: "Fim da isenção aduaneira <150 €",
    quemValida: "despachante",
    papeis: ["despachante"],
  },
  {
    id: "vida",
    seccao: 1,
    dominio: "iva",
    titulo: "IVA na era digital (ViDA)",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "fornecedor-presumido",
    seccao: 1,
    dominio: "iva",
    titulo: "Fornecedor presumido em bens (marketplaces)",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "software-certificado-at",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Software de faturação certificado pela AT",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "atcud-qr",
    seccao: 1,
    dominio: "faturacao",
    titulo: "ATCUD e código QR",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "pdf-fatura-pt",
    seccao: 1,
    dominio: "faturacao",
    titulo: "PDF como fatura electrónica (PT)",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "conservacao-pt",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Conservação de documentos (PT)",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "verifactu-es",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Espanha — Verifactu",
    quemValida: "asesor fiscal ES",
    papeis: C,
  },
  {
    id: "fatura-electronica-fr",
    seccao: 1,
    dominio: "faturacao",
    titulo: "França — fatura electrónica",
    quemValida: "expert-comptable FR",
    papeis: C,
  },
  {
    id: "b2b-electronico-be",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Bélgica — B2B electrónico",
    quemValida: "contabilista BE",
    papeis: C,
  },
  {
    id: "b2b-electronico-de",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Alemanha — B2B electrónico",
    quemValida: "Steuerberater",
    papeis: C,
  },
  {
    id: "ksef-pl",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Polónia — KSeF",
    quemValida: "contabilista PL",
    papeis: C,
  },
  {
    id: "sdi-it",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Itália — SDI",
    quemValida: "commercialista IT",
    papeis: C,
  },
  {
    id: "canarias-ceuta-melilla",
    seccao: 1,
    dominio: "iva",
    titulo: "Canárias, Ceuta e Melilla",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "acores-madeira",
    seccao: 1,
    dominio: "iva",
    titulo: "Açores e Madeira",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "lugar-prestacao-eventos",
    seccao: 1,
    dominio: "iva",
    titulo: "Lugar da prestação — acesso a eventos e ensino",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "ensino-ao-vivo",
    seccao: 1,
    dominio: "iva",
    titulo: "Ensino ao vivo por vídeo não é «serviço electrónico»",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "bilhete-documento-pt",
    seccao: 1,
    dominio: "faturacao",
    titulo: "Bilhete como documento em vez de fatura (PT)",
    quemValida: "contabilista",
    papeis: C,
  },
  // 2. Consumidor
  {
    id: "pre-contratual-livre-resolucao",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Informação pré-contratual e livre resolução de 14 dias",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "livre-resolucao-lazer",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Livre resolução — actividades de lazer com data",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "servico-comecado-no-prazo",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Serviço começado dentro do prazo de livre resolução",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "botao-livre-resolucao",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Botão de livre resolução",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "reducoes-30-dias",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Reduções de preço — preço mais baixo dos 30 dias",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "preco-por-unidade",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Preço por unidade",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "preco-personalizado",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Preço personalizado",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "avaliacoes-pesquisa-paga",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Avaliações e resultados de pesquisa pagos",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "conteudos-digitais-livre-resolucao",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Conteúdos digitais — livre resolução",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "alegacoes-ambientais-garantia",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Alegações ambientais e garantia legal",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "direito-reparacao",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Direito à reparação",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "odr",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Plataforma europeia de litígios (ODR)",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "ral-livro-reclamacoes-pt",
    seccao: 2,
    dominio: "consumidor",
    titulo: "RAL e Livro de Reclamações electrónico (PT)",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "geobloqueio",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Geobloqueio",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "digital-fairness-act",
    seccao: 2,
    dominio: "consumidor",
    titulo: "Digital Fairness Act (equidade digital)",
    quemValida: "—",
    papeis: [],
  },
  // 3. Produto
  {
    id: "gpsr",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Segurança geral dos produtos",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "cosmeticos",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Cosméticos",
    quemValida: "técnico regulamentar",
    papeis: T,
  },
  {
    id: "tpo",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Substâncias proibidas — TPO",
    quemValida: "técnico regulamentar",
    papeis: T,
  },
  {
    id: "quimicos-rotulo",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Químicos — rótulo na venda online",
    quemValida: "técnico regulamentar",
    papeis: T,
  },
  {
    id: "ppwr",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Embalagens (PPWR)",
    quemValida: "jurista / entidade gestora",
    papeis: ["jurista", "entidade_gestora"],
  },
  {
    id: "mercadorias-perigosas",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Mercadorias perigosas no transporte",
    quemValida: "transportadora",
    papeis: ["transportadora"],
  },
  {
    id: "informacao-entrega",
    seccao: 3,
    dominio: "consumidor",
    titulo: "Informação de entrega antes da compra",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "cra",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Ciber-resiliência dos produtos com elementos digitais (CRA)",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "eudr",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Produtos sem desflorestação (EUDR)",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "brinquedos",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Segurança dos brinquedos",
    quemValida: "técnico regulamentar",
    papeis: T,
  },
  {
    id: "acessibilidade",
    seccao: 3,
    dominio: "acessibilidade_plataforma",
    titulo: "Acessibilidade",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "produtos-defeituosos",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Responsabilidade por produtos defeituosos",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "baterias",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Baterias — código QR, passaporte e registo de produtor",
    quemValida: "técnico regulamentar",
    papeis: T,
  },
  {
    id: "reee",
    seccao: 3,
    dominio: "produto_ambiente",
    titulo: "Equipamentos eléctricos e electrónicos (REEE)",
    quemValida: "jurista / entidade gestora",
    papeis: ["jurista", "entidade_gestora"],
  },
  // 4. Dados, plataformas e IA
  {
    id: "protecao-dados",
    seccao: 4,
    dominio: "privacidade_marketing",
    titulo: "Protecção de dados",
    quemValida: "encarregado de dados / jurista",
    papeis: ["encarregado_de_dados", "jurista"],
  },
  {
    id: "violacao-dados",
    seccao: 4,
    dominio: "privacidade_marketing",
    titulo: "Violação de dados pessoais",
    quemValida: "encarregado de dados / jurista",
    papeis: ["encarregado_de_dados", "jurista"],
  },
  {
    id: "cookies",
    seccao: 4,
    dominio: "privacidade_marketing",
    titulo: "Cookies",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "mudanca-nuvem",
    seccao: 4,
    dominio: null,
    titulo: "Mudança de fornecedor de nuvem/SaaS",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "dsa",
    seccao: 4,
    dominio: "acessibilidade_plataforma",
    titulo: "Serviços digitais (DSA)",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "dac7",
    seccao: 4,
    dominio: "faturacao",
    titulo: "Comunicação de vendedores por plataformas",
    quemValida: "contabilista",
    papeis: C,
  },
  {
    id: "ia",
    seccao: 4,
    dominio: null,
    titulo: "Inteligência artificial",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "ciberseguranca",
    seccao: 4,
    dominio: null,
    titulo: "Cibersegurança",
    quemValida: "jurista",
    papeis: J,
  },
  // 5. Pagamentos
  {
    id: "psd2-sca",
    seccao: 5,
    dominio: "pagamentos",
    titulo: "Serviços de pagamento e autenticação forte",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "psd3-psr",
    seccao: 5,
    dominio: "pagamentos",
    titulo: "PSD3 / PSR",
    quemValida: "jurista",
    papeis: J,
  },
  {
    id: "pci-dss",
    seccao: 5,
    dominio: "pagamentos",
    titulo: "PCI DSS",
    quemValida: "—",
    papeis: [],
  },
];

// Um identificador repetido faria a última linha apagar a outra sem aviso
// (revisão do #133, P3-2): falha ao carregar.
const repetidos = LINHAS.map((l) => l.id).filter(
  (id, k, ids) => ids.indexOf(id) !== k,
);
if (repetidos.length > 0) {
  throw new Error(`temas.ts: identificador repetido ${repetidos.join(", ")}`);
}

/** As linhas, congeladas e por identificador (sem protótipo: «toString» não é tema). */
export const TEMAS_DOCS03: Readonly<Record<string, Readonly<TemaDocs03>>> =
  Object.freeze(
    Object.assign(
      Object.create(null) as Record<string, Readonly<TemaDocs03>>,
      Object.fromEntries(
        LINHAS.map((linha) => [
          linha.id,
          Object.freeze({ ...linha, papeis: Object.freeze([...linha.papeis]) }),
        ]),
      ),
    ),
  );

/** O tema existe e pode viver neste domínio? Um valor estranho: não. */
export function temaDoDominio(tema: unknown, dominio: unknown): boolean {
  if (typeof tema !== "string" || !Object.hasOwn(TEMAS_DOCS03, tema))
    return false;
  const linha = TEMAS_DOCS03[tema];
  return (
    linha !== undefined && linha.dominio !== null && linha.dominio === dominio
  );
}

/**
 * O papel valida uma regra deste tema e domínio? Só um papel da linha do
 * docs/03, e só se o tema pode viver no domínio. Um valor estranho: não.
 */
export function papelValidaTema(
  papel: unknown,
  tema: unknown,
  dominio: unknown,
): boolean {
  if (!temaDoDominio(tema, dominio)) return false;
  const linha = TEMAS_DOCS03[tema as string];
  return (
    linha !== undefined && (linha.papeis as readonly unknown[]).includes(papel)
  );
}
