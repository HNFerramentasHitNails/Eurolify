import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMAS_DOCS03 } from "../src/regras/temas.js";

// A tabela de temas.ts tem de dizer o mesmo que o docs/03 (decisão BR,
// #128): mudar uma linha do documento sem mudar o código, ou o contrário,
// faz falhar este teste.

const DOCS03 = new URL("../../../docs/03-regulamentar-ue.md", import.meta.url);

/** A coluna «Quem valida», como o docs/03 a escreve, nos papéis do motor. */
const PAPEIS_DO_TEXTO: Record<string, readonly string[]> = {
  contabilista: ["contabilista"],
  // O profissional fiscal de cada país regista-se como contabilista
  // (convenção escrita no docs/03, decisão BD).
  "asesor fiscal ES": ["contabilista"],
  "expert-comptable FR": ["contabilista"],
  "contabilista BE": ["contabilista"],
  Steuerberater: ["contabilista"],
  "contabilista PL": ["contabilista"],
  "commercialista IT": ["contabilista"],
  despachante: ["despachante"],
  jurista: ["jurista"],
  "técnico regulamentar": ["tecnico_regulamentar"],
  transportadora: ["transportadora"],
  "jurista / entidade gestora": ["jurista", "entidade_gestora"],
  "encarregado de dados / jurista": ["encarregado_de_dados", "jurista"],
  "—": [],
};

const semFormatacao = (texto: string) =>
  texto.replace(/\*\*/g, "").replace(/\*/g, "").trim();

/** As linhas do docs/03 com «Quem valida» (secções 1 a 5 e 7). */
function linhasDoDocs03() {
  const linhas: { seccao: number; titulo: string; quem: string }[] = [];
  let seccao = 0;
  let coluna = -1;
  for (const linha of readFileSync(DOCS03, "utf8").split("\n")) {
    const titulo = /^## (\d)\. /.exec(linha);
    if (titulo !== null) {
      seccao = Number(titulo[1]);
      coluna = -1;
      continue;
    }
    if (linha.startsWith("## ")) seccao = 0;
    // Todas as secções numeradas; a 6 (protocolos) não tem a coluna «Quem
    // valida» e fica de fora pelo cabeçalho.
    if (seccao < 1 || !linha.startsWith("|")) continue;
    const celulas = linha
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (celulas[0] === "Tema") {
      coluna = celulas.indexOf("Quem valida");
      continue;
    }
    if (/^-+$/.test(celulas[0] ?? "") || coluna < 0) continue;
    linhas.push({
      seccao,
      titulo: semFormatacao(celulas[0] ?? ""),
      quem: celulas[coluna] ?? "",
    });
  }
  return linhas;
}

describe("os temas do motor são as linhas do docs/03 (#128)", () => {
  it("lê as 64 linhas das secções 1 a 5 e 7", () => {
    expect(linhasDoDocs03()).toHaveLength(64);
  });

  it("cada linha do docs/03 tem o tema, pela mesma ordem, com os mesmos papéis", () => {
    const doDocumento = linhasDoDocs03().map(({ seccao, titulo, quem }) => {
      const papeis = PAPEIS_DO_TEXTO[quem];
      if (papeis === undefined) {
        throw new Error(
          `«Quem valida» desconhecido no docs/03: «${quem}» (${titulo}); acrescentar a PAPEIS_DO_TEXTO`,
        );
      }
      return { seccao, titulo, quemValida: quem, papeis: [...papeis].sort() };
    });
    const doCodigo = Object.values(TEMAS_DOCS03).map(
      ({ seccao, titulo, quemValida, papeis }) => ({
        seccao,
        titulo,
        // O texto da coluna também: trocar o profissional de um país no
        // docs/03 faz falhar (revisão do #133, P3-1).
        quemValida,
        papeis: [...papeis].sort(),
      }),
    );
    expect(doCodigo).toEqual(doDocumento);
  });

  it("as linhas sem domínio no motor são estas cinco, e mais nenhuma (decisões BY e BZ; mudar é de propósito)", () => {
    const semDominio = Object.values(TEMAS_DOCS03)
      .filter((linha) => linha.dominio === null)
      .map((linha) => linha.id);
    expect(semDominio).toEqual([
      "isencao-aduaneira-150",
      "mudanca-nuvem",
      "dac7",
      "ia",
      "ciberseguranca",
    ]);
  });

  it("o domínio de cada linha é o da tabela escrita à mão (decisão BY; revisão do #133, 2.ª, P2)", () => {
    const POR_DOMINIO: Record<string, readonly string[]> = {
      iva: [
        "oss",
        "ioss",
        "vida",
        "fornecedor-presumido",
        "canarias-ceuta-melilla",
        "acores-madeira",
        "lugar-prestacao-eventos",
        "ensino-ao-vivo",
      ],
      faturacao: [
        "software-certificado-at",
        "atcud-qr",
        "pdf-fatura-pt",
        "conservacao-pt",
        "verifactu-es",
        "fatura-electronica-fr",
        "b2b-electronico-be",
        "b2b-electronico-de",
        "ksef-pl",
        "sdi-it",
        "bilhete-documento-pt",
      ],
      consumidor: [
        "pre-contratual-livre-resolucao",
        "livre-resolucao-lazer",
        "servico-comecado-no-prazo",
        "botao-livre-resolucao",
        "reducoes-30-dias",
        "preco-por-unidade",
        "preco-personalizado",
        "avaliacoes-pesquisa-paga",
        "conteudos-digitais-livre-resolucao",
        "alegacoes-ambientais-garantia",
        "direito-reparacao",
        "odr",
        "ral-livro-reclamacoes-pt",
        "geobloqueio",
        "digital-fairness-act",
        "informacao-entrega",
      ],
      produto_ambiente: [
        "gpsr",
        "cosmeticos",
        "tpo",
        "quimicos-rotulo",
        "ppwr",
        "mercadorias-perigosas",
        "cra",
        "eudr",
        "brinquedos",
        "produtos-defeituosos",
        "baterias",
        "reee",
      ],
      acessibilidade_plataforma: ["acessibilidade", "dsa"],
      privacidade_marketing: ["protecao-dados", "violacao-dados", "cookies"],
      pagamentos: ["psd2-sca", "psd3-psr", "pci-dss"],
      distribuicao_concorrencia: ["acordos-verticais"],
      contratos_franchising: ["franchising"],
      agencia_comercial: ["agentes-comerciais"],
      termos_plataforma_empresas: ["p2b"],
      sem_dominio: [
        "isencao-aduaneira-150",
        "mudanca-nuvem",
        "dac7",
        "ia",
        "ciberseguranca",
      ],
    };
    const doCodigo: Record<string, string[]> = {};
    for (const linha of Object.values(TEMAS_DOCS03)) {
      const chave = linha.dominio ?? "sem_dominio";
      (doCodigo[chave] ??= []).push(linha.id);
    }
    for (const lista of Object.values(doCodigo)) lista.sort();
    const esperado = Object.fromEntries(
      Object.entries(POR_DOMINIO).map(([d, ids]) => [d, [...ids].sort()]),
    );
    expect(doCodigo).toEqual(esperado);
  });

  it("os identificadores são só minúsculas, algarismos e hífenes (os repetidos falham ao carregar temas.ts)", () => {
    const ids = Object.keys(TEMAS_DOCS03);
    expect(ids).toHaveLength(64);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
