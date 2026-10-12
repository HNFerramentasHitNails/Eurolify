import { describe, expect, it } from "vitest";
import type { ContaTransportadora } from "../src/api";
import {
  caminhoDosAvisos,
  conferirRemetente,
  contasAMostrar,
  rotuloDoCampo,
  rotuloDoEstado,
} from "../src/envios";
import { TEXTOS } from "../src/textos";

// O apoio dos ecrãs dos envios (docs/22 §29): o que o ecrã mostra e confere
// antes de enviar; a API decide o resto.

const conta = (
  estado: ContaTransportadora["estado"],
  id = "cac_0199a1c0-0000-7000-8000-000000000001",
): ContaTransportadora => ({
  id,
  transportadora: "sendcloud",
  nome: "Sendcloud",
  modo: "teste",
  remetente: {
    nome: "Armazém",
    linha1: "Rua 1",
    codigo_postal: "1000-001",
    localidade: "Lisboa",
    pais: "PT",
  },
  estado,
  credenciais_em: null,
  credenciais_por: null,
  testada_em: null,
  servicos_em: null,
  campos_credenciais: [],
  criado_em: "2026-10-12T10:00:00Z",
  versao: 1,
});

describe("envios no Hub", () => {
  const t = TEXTOS.pt;

  it("o estado em palavras: pronta, por testar e arquivada", () => {
    expect(rotuloDoEstado(t, "pronta")).toBe("Pronta");
    expect(rotuloDoEstado(t, "rascunho")).toBe("Por testar");
    expect(rotuloDoEstado(t, "arquivada")).toBe("Arquivada");
  });

  it("os campos das credenciais conhecidos têm nome; os outros saem técnicos", () => {
    expect(rotuloDoCampo(t, "chave_secreta")).toBe("Chave secreta");
    expect(rotuloDoCampo(TEXTOS.en, "chave_publica")).toBe("Public key");
    expect(rotuloDoCampo(t, "token_novo")).toBe("token_novo");
  });

  it("o remetente: espaços fora, o país em maiúsculas, o primeiro campo em falta", () => {
    expect(
      conferirRemetente({
        nome: "  Armazém ",
        linha1: "Rua 1",
        linha2: "  ",
        codigo_postal: "1000-001",
        localidade: "Lisboa",
        pais: "pt",
      }),
    ).toEqual({
      remetente: {
        nome: "Armazém",
        linha1: "Rua 1",
        codigo_postal: "1000-001",
        localidade: "Lisboa",
        pais: "PT",
      },
      falta: null,
    });
    expect(
      conferirRemetente({
        nome: "A",
        linha1: " ",
        codigo_postal: "",
        localidade: "L",
        pais: "PT",
      }).falta,
    ).toBe("linha1");
    expect(
      conferirRemetente({
        nome: "A",
        linha1: "R",
        codigo_postal: "1",
        localidade: "L",
        pais: "Portugal",
      }).falta,
    ).toBe("pais");
  });

  it("o caminho dos avisos é o da conta; as arquivadas só quando se pedem", () => {
    expect(caminhoDosAvisos(conta("pronta"))).toBe(
      "/webhooks/carriers/sendcloud/cac_0199a1c0-0000-7000-8000-000000000001",
    );
    const contas = [conta("pronta"), conta("arquivada", "cac_x")];
    expect(contasAMostrar(contas, false).map((c) => c.estado)).toEqual([
      "pronta",
    ]);
    expect(contasAMostrar(contas, true)).toHaveLength(2);
  });
});
