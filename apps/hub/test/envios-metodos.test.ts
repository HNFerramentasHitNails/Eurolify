import { describe, expect, it } from "vitest";
import { ErroHub, type MetodoEntrega, type ServicoConta } from "../src/api";
import {
  camposMudados,
  conferirMetodo,
  erroDaEmbalagem,
  erroDoMetodo,
  metodosAMostrar,
  nomeNaLingua,
  prefixosDoTexto,
  servicosParaOMercado,
  textoDosPrefixos,
  type FormularioMetodo,
} from "../src/envios-metodos";
import { ErroDoEcra } from "../src/erros";

// O apoio dos ecrãs dos métodos de entrega (docs/22 §31): o que o ecrã
// confere antes de enviar; a API confere o resto.

const metodo = (m: Partial<MetodoEntrega> = {}): MetodoEntrega => ({
  id: "shm_0199a1c0-0000-7000-8000-000000000001",
  mercado: "mkt_0199a1c0-0000-7000-8000-000000000002",
  nome: { pt: "Correio" },
  prazo: {},
  tarifa: 499,
  gratis_a_partir_de: null,
  pede_telefone: false,
  conta: null,
  servico: null,
  prazo_max_dias: 30,
  codigos_postais: [],
  aceita_onu: [],
  peso_max_g: null,
  entrega: "morada",
  estado: "activo",
  versao: 1,
  ...m,
});

const formulario = (f: Partial<FormularioMetodo> = {}): FormularioMetodo => ({
  nome: { pt: "Correio registado" },
  prazo: {},
  tarifa: "4,99",
  gratis: "",
  pedeTelefone: false,
  conta: "",
  servico: "",
  prazoMaxDias: "5",
  prefixos: "",
  pesoMaxG: "",
  entrega: "morada",
  ...f,
});

describe("métodos de entrega no Hub", () => {
  it("os prefixos: vírgulas, linhas, repetidos fora; um inválido recusa tudo", () => {
    expect(prefixosDoTexto("1, 2,3\n4; 4")).toEqual(["1", "2", "3", "4"]);
    expect(prefixosDoTexto("  ")).toEqual([]);
    expect(prefixosDoTexto("1, -2")).toBeNull();
    expect(prefixosDoTexto("1234567890123")).toBeNull();
    expect(
      prefixosDoTexto(
        Array.from({ length: 201 }, (_, i) => String(i)).join(","),
      ),
    ).toBeNull();
    expect(textoDosPrefixos(["1", "2"])).toBe("1, 2");
  });

  it("o formulário passa a cêntimos e diz o primeiro campo errado", () => {
    const ok = conferirMetodo(
      formulario({
        nome: { pt: " Correio ", en: "" },
        gratis: "50",
        prefixos: "1, 2",
        pesoMaxG: "2000",
        conta: "cac_x",
        servico: "sendcloud:letter",
      }),
      "pt",
      2,
    );
    expect(ok).toEqual({
      campos: {
        nome: { pt: "Correio" },
        prazo: {},
        tarifa: 499,
        gratis_a_partir_de: 5000,
        pede_telefone: false,
        conta: "cac_x",
        servico: "sendcloud:letter",
        prazo_max_dias: 5,
        codigos_postais: ["1", "2"],
        peso_max_g: 2000,
        entrega: "morada",
      },
      falta: null,
    });
    const falta = (f: Partial<FormularioMetodo>) =>
      conferirMetodo(formulario(f), "pt", 2).falta?.campo;
    expect(falta({ nome: { en: "Mail" } })).toBe("nome");
    expect(falta({ tarifa: "4,999" })).toBe("tarifa");
    expect(falta({ tarifa: "-1" })).toBe("tarifa");
    expect(falta({ tarifa: "1000001" })).toBe("tarifa");
    expect(falta({ gratis: "0" })).toBe("gratis");
    expect(falta({ conta: "cac_x" })).toBe("servico");
    expect(falta({ prazoMaxDias: "31" })).toBe("prazoMaxDias");
    expect(falta({ prazoMaxDias: "0" })).toBe("prazoMaxDias");
    expect(falta({ prefixos: "1, !" })).toBe("prefixos");
    expect(falta({ pesoMaxG: "0" })).toBe("pesoMaxG");
    // «Manual» não leva serviço, mesmo que um tenha ficado escrito.
    expect(
      conferirMetodo(formulario({ servico: "x" }), "pt", 2).campos?.servico,
    ).toBeNull();
  });

  it("onde entrega: um método manual é sempre na morada; num ponto, vai no PATCH (docs/36 §21)", () => {
    expect(
      conferirMetodo(formulario({ entrega: "ponto" }), "pt", 2).campos?.entrega,
    ).toBe("morada");
    const ponto = conferirMetodo(
      formulario({ entrega: "ponto", conta: "cac_a", servico: "p1" }),
      "pt",
      2,
    ).campos;
    expect(ponto?.entrega).toBe("ponto");
    expect(
      ponto === null
        ? null
        : camposMudados(metodo({ conta: "cac_a", servico: "p1" }), ponto),
    ).toMatchObject({ entrega: "ponto" });
    // De morada para ponto com outro serviço: a conta, o serviço e onde
    // entrega vão juntos (revisão do #443).
    const paraPonto = conferirMetodo(
      formulario({ entrega: "ponto", conta: "cac_a", servico: "p1" }),
      "pt",
      2,
    ).campos;
    expect(
      paraPonto === null
        ? null
        : camposMudados(metodo({ conta: "cac_a", servico: "s1" }), paraPonto),
    ).toMatchObject({ conta: "cac_a", servico: "p1", entrega: "ponto" });
    // De ponto para manual: sem conta nem serviço, e na morada.
    const manual = conferirMetodo(
      formulario({ entrega: "ponto" }),
      "pt",
      2,
    ).campos;
    expect(
      manual === null
        ? null
        : camposMudados(
            metodo({ conta: "cac_a", servico: "p1", entrega: "ponto" }),
            manual,
          ),
    ).toMatchObject({ conta: null, servico: null, entrega: "morada" });
  });

  it("no PATCH só vai o que mudou; a conta e o serviço vão juntos", () => {
    const antes = metodo({ conta: "cac_a", servico: "s1" });
    const igual = conferirMetodo(
      formulario({
        nome: { pt: "Correio" },
        prazoMaxDias: "30",
        conta: "cac_a",
        servico: "s1",
      }),
      "pt",
      2,
    ).campos;
    expect(igual === null ? null : camposMudados(antes, igual)).toEqual({});
    const tarifa = conferirMetodo(
      formulario({
        nome: { pt: "Correio" },
        tarifa: "5,99",
        prazoMaxDias: "30",
        conta: "cac_a",
        servico: "s1",
      }),
      "pt",
      2,
    ).campos;
    expect(tarifa === null ? null : camposMudados(antes, tarifa)).toEqual({
      tarifa: 599,
    });
    const servico = conferirMetodo(
      formulario({
        nome: { pt: "Correio" },
        prazoMaxDias: "30",
        conta: "cac_a",
        servico: "s2",
      }),
      "pt",
      2,
    ).campos;
    expect(servico === null ? null : camposMudados(antes, servico)).toEqual({
      conta: "cac_a",
      servico: "s2",
    });
  });

  it("os métodos por mostrar, o nome na língua e os serviços do mercado", () => {
    const lista = [
      metodo(),
      metodo({ id: "shm_b", estado: "arquivado" }),
      metodo({ id: "shm_c", mercado: "mkt_outro" }),
    ];
    expect(metodosAMostrar(lista, null, false).map((m) => m.id)).toEqual([
      lista[0]?.id,
      "shm_c",
    ]);
    expect(metodosAMostrar(lista, "mkt_outro", true).map((m) => m.id)).toEqual([
      "shm_c",
    ]);
    expect(nomeNaLingua({ pt: "Correio", en: "Mail" }, "en")).toBe("Mail");
    expect(nomeNaLingua({ pt: "Correio" }, "es", "pt")).toBe("Correio");
    expect(nomeNaLingua({}, "es")).toBe("");
    const servico = (
      codigo: string,
      paises: string[],
      ponto = false,
    ): ServicoConta => ({
      codigo,
      nome: { en: codigo },
      paises,
      peso_max_g: null,
      pede_telefone: false,
      pede_email: false,
      ponto,
    });
    const todos = [
      servico("so-pt", ["PT"]),
      servico("pt-es", ["PT", "ES"]),
      servico("ponto-pt-es", ["PT", "ES"], true),
    ];
    expect(
      servicosParaOMercado(todos, ["PT", "ES"]).map((s) => s.codigo),
    ).toEqual(["pt-es"]);
    // Um método num ponto só mostra os serviços de ponto (docs/36 §21).
    expect(
      servicosParaOMercado(todos, ["PT", "ES"], "ponto").map((s) => s.codigo),
    ).toEqual(["ponto-pt-es"]);
    // Uma API sem `ponto` no serviço: conta como de morada (revisão do #443).
    const semPonto = {
      ...servico("antigo", ["PT", "ES"]),
    } as Partial<ServicoConta>;
    delete semPonto.ponto;
    expect(
      servicosParaOMercado([semPonto as ServicoConta], ["PT", "ES"]).map(
        (s) => s.codigo,
      ),
    ).toEqual(["antigo"]);
  });

  it("os erros do servidor dizem-se com o texto deste ecrã", () => {
    const erro = (codigo: string) =>
      erroDoMetodo(new ErroHub(422, codigo, {}, undefined, undefined));
    expect(erro("shipping.account_not_ready")).toEqual(
      new ErroDoEcra("metodosContaNaoPronta"),
    );
    expect((erro("shipping.invalid_field") as ErroDoEcra).chave).toBe(
      "metodosServicoNaoServe",
    );
    expect((erro("checkout.version_conflict") as ErroDoEcra).chave).toBe(
      "metodosConflito",
    );
    expect(erro("outro.codigo")).toBeInstanceOf(ErroHub);
    // O que não se encontra depende do ecrã (revisão do #413, P2-4).
    const naoEncontrado = (codigo: string) =>
      new ErroHub(404, codigo, {}, undefined, undefined);
    expect(
      (erroDoMetodo(naoEncontrado("checkout.not_found"), true) as ErroDoEcra)
        .chave,
    ).toBe("metodosMercadoNaoExiste");
    expect(
      (erroDoMetodo(naoEncontrado("checkout.not_found")) as ErroDoEcra).chave,
    ).toBe("metodosNaoExiste");
    expect(
      (erroDaEmbalagem(naoEncontrado("shipping.not_found")) as ErroDoEcra)
        .chave,
    ).toBe("embalagemNaoExiste");
  });
});
