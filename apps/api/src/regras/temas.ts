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

/** Os domínios do motor em que uma regra de cada secção do docs/03 pode viver. */
export const DOMINIOS_DA_SECCAO: Readonly<
  Record<1 | 2 | 3 | 4 | 5, readonly Dominio[]>
> = Object.freeze({
  1: Object.freeze(["iva", "faturacao"] as const),
  2: Object.freeze(["consumidor"] as const),
  3: Object.freeze(["produto_ambiente", "acessibilidade_plataforma"] as const),
  4: Object.freeze([
    "privacidade_marketing",
    "acessibilidade_plataforma",
  ] as const),
  5: Object.freeze(["pagamentos"] as const),
});

export interface TemaDocs03 {
  /** Identificador estável, usado no campo `tema` da regra. */
  id: string;
  /** A secção do docs/03 (1 a 5). */
  seccao: 1 | 2 | 3 | 4 | 5;
  /** O texto da coluna «Tema», sem a formatação. */
  titulo: string;
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
    titulo: "IVA nas vendas à distância na UE (OSS)",
    papeis: C,
  },
  {
    id: "ioss",
    seccao: 1,
    titulo: "Importações de baixo valor (IOSS)",
    papeis: C,
  },
  {
    id: "isencao-aduaneira-150",
    seccao: 1,
    titulo: "Fim da isenção aduaneira <150 €",
    papeis: ["despachante"],
  },
  { id: "vida", seccao: 1, titulo: "IVA na era digital (ViDA)", papeis: C },
  {
    id: "fornecedor-presumido",
    seccao: 1,
    titulo: "Fornecedor presumido em bens (marketplaces)",
    papeis: C,
  },
  {
    id: "software-certificado-at",
    seccao: 1,
    titulo: "Software de faturação certificado pela AT",
    papeis: C,
  },
  { id: "atcud-qr", seccao: 1, titulo: "ATCUD e código QR", papeis: C },
  {
    id: "pdf-fatura-pt",
    seccao: 1,
    titulo: "PDF como fatura electrónica (PT)",
    papeis: C,
  },
  {
    id: "conservacao-pt",
    seccao: 1,
    titulo: "Conservação de documentos (PT)",
    papeis: C,
  },
  { id: "verifactu-es", seccao: 1, titulo: "Espanha — Verifactu", papeis: C },
  {
    id: "fatura-electronica-fr",
    seccao: 1,
    titulo: "França — fatura electrónica",
    papeis: C,
  },
  {
    id: "b2b-electronico-be",
    seccao: 1,
    titulo: "Bélgica — B2B electrónico",
    papeis: C,
  },
  {
    id: "b2b-electronico-de",
    seccao: 1,
    titulo: "Alemanha — B2B electrónico",
    papeis: C,
  },
  { id: "ksef-pl", seccao: 1, titulo: "Polónia — KSeF", papeis: C },
  { id: "sdi-it", seccao: 1, titulo: "Itália — SDI", papeis: C },
  {
    id: "canarias-ceuta-melilla",
    seccao: 1,
    titulo: "Canárias, Ceuta e Melilla",
    papeis: C,
  },
  { id: "acores-madeira", seccao: 1, titulo: "Açores e Madeira", papeis: C },
  {
    id: "lugar-prestacao-eventos",
    seccao: 1,
    titulo: "Lugar da prestação — acesso a eventos e ensino",
    papeis: C,
  },
  {
    id: "ensino-ao-vivo",
    seccao: 1,
    titulo: "Ensino ao vivo por vídeo não é «serviço electrónico»",
    papeis: C,
  },
  {
    id: "bilhete-documento-pt",
    seccao: 1,
    titulo: "Bilhete como documento em vez de fatura (PT)",
    papeis: C,
  },
  // 2. Consumidor
  {
    id: "pre-contratual-livre-resolucao",
    seccao: 2,
    titulo: "Informação pré-contratual e livre resolução de 14 dias",
    papeis: J,
  },
  {
    id: "livre-resolucao-lazer",
    seccao: 2,
    titulo: "Livre resolução — actividades de lazer com data",
    papeis: J,
  },
  {
    id: "servico-comecado-no-prazo",
    seccao: 2,
    titulo: "Serviço começado dentro do prazo de livre resolução",
    papeis: J,
  },
  {
    id: "botao-livre-resolucao",
    seccao: 2,
    titulo: "Botão de livre resolução",
    papeis: J,
  },
  {
    id: "reducoes-30-dias",
    seccao: 2,
    titulo: "Reduções de preço — preço mais baixo dos 30 dias",
    papeis: J,
  },
  {
    id: "preco-por-unidade",
    seccao: 2,
    titulo: "Preço por unidade",
    papeis: J,
  },
  {
    id: "preco-personalizado",
    seccao: 2,
    titulo: "Preço personalizado",
    papeis: J,
  },
  {
    id: "avaliacoes-pesquisa-paga",
    seccao: 2,
    titulo: "Avaliações e resultados de pesquisa pagos",
    papeis: J,
  },
  {
    id: "conteudos-digitais-livre-resolucao",
    seccao: 2,
    titulo: "Conteúdos digitais — livre resolução",
    papeis: J,
  },
  {
    id: "alegacoes-ambientais-garantia",
    seccao: 2,
    titulo: "Alegações ambientais e garantia legal",
    papeis: J,
  },
  {
    id: "direito-reparacao",
    seccao: 2,
    titulo: "Direito à reparação",
    papeis: J,
  },
  {
    id: "odr",
    seccao: 2,
    titulo: "Plataforma europeia de litígios (ODR)",
    papeis: J,
  },
  {
    id: "ral-livro-reclamacoes-pt",
    seccao: 2,
    titulo: "RAL e Livro de Reclamações electrónico (PT)",
    papeis: J,
  },
  { id: "geobloqueio", seccao: 2, titulo: "Geobloqueio", papeis: J },
  {
    id: "digital-fairness-act",
    seccao: 2,
    titulo: "Digital Fairness Act (equidade digital)",
    papeis: [],
  },
  // 3. Produto
  { id: "gpsr", seccao: 3, titulo: "Segurança geral dos produtos", papeis: J },
  { id: "cosmeticos", seccao: 3, titulo: "Cosméticos", papeis: T },
  { id: "tpo", seccao: 3, titulo: "Substâncias proibidas — TPO", papeis: T },
  {
    id: "quimicos-rotulo",
    seccao: 3,
    titulo: "Químicos — rótulo na venda online",
    papeis: T,
  },
  {
    id: "ppwr",
    seccao: 3,
    titulo: "Embalagens (PPWR)",
    papeis: ["jurista", "entidade_gestora"],
  },
  {
    id: "mercadorias-perigosas",
    seccao: 3,
    titulo: "Mercadorias perigosas no transporte",
    papeis: ["transportadora"],
  },
  {
    id: "informacao-entrega",
    seccao: 3,
    titulo: "Informação de entrega antes da compra",
    papeis: J,
  },
  {
    id: "cra",
    seccao: 3,
    titulo: "Ciber-resiliência dos produtos com elementos digitais (CRA)",
    papeis: J,
  },
  {
    id: "eudr",
    seccao: 3,
    titulo: "Produtos sem desflorestação (EUDR)",
    papeis: J,
  },
  {
    id: "brinquedos",
    seccao: 3,
    titulo: "Segurança dos brinquedos",
    papeis: T,
  },
  { id: "acessibilidade", seccao: 3, titulo: "Acessibilidade", papeis: J },
  {
    id: "produtos-defeituosos",
    seccao: 3,
    titulo: "Responsabilidade por produtos defeituosos",
    papeis: J,
  },
  {
    id: "baterias",
    seccao: 3,
    titulo: "Baterias — código QR, passaporte e registo de produtor",
    papeis: T,
  },
  {
    id: "reee",
    seccao: 3,
    titulo: "Equipamentos eléctricos e electrónicos (REEE)",
    papeis: ["jurista", "entidade_gestora"],
  },
  // 4. Dados, plataformas e IA
  {
    id: "protecao-dados",
    seccao: 4,
    titulo: "Protecção de dados",
    papeis: ["encarregado_de_dados", "jurista"],
  },
  {
    id: "violacao-dados",
    seccao: 4,
    titulo: "Violação de dados pessoais",
    papeis: ["encarregado_de_dados", "jurista"],
  },
  { id: "cookies", seccao: 4, titulo: "Cookies", papeis: J },
  {
    id: "mudanca-nuvem",
    seccao: 4,
    titulo: "Mudança de fornecedor de nuvem/SaaS",
    papeis: J,
  },
  { id: "dsa", seccao: 4, titulo: "Serviços digitais (DSA)", papeis: J },
  {
    id: "dac7",
    seccao: 4,
    titulo: "Comunicação de vendedores por plataformas",
    papeis: C,
  },
  { id: "ia", seccao: 4, titulo: "Inteligência artificial", papeis: J },
  { id: "ciberseguranca", seccao: 4, titulo: "Cibersegurança", papeis: J },
  // 5. Pagamentos
  {
    id: "psd2-sca",
    seccao: 5,
    titulo: "Serviços de pagamento e autenticação forte",
    papeis: J,
  },
  { id: "psd3-psr", seccao: 5, titulo: "PSD3 / PSR", papeis: J },
  { id: "pci-dss", seccao: 5, titulo: "PCI DSS", papeis: [] },
];

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
  if (linha === undefined) return false;
  return (DOMINIOS_DA_SECCAO[linha.seccao] as readonly unknown[]).includes(
    dominio,
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
