import { describe, expect, it } from "vitest";
import { ErroDeRede } from "../src/envios/adaptador.js";
import {
  adaptadorSendcloud,
  eventosDe,
  normalizar,
  SERVICO_DE_TESTE,
} from "../src/envios/sendcloud.js";
import { opcao, PUBLICA, SECRETA, sendcloudFalsa } from "./sendcloud-falsa.js";

// O adaptador da Sendcloud (docs/36 §16), contra uma Sendcloud de ensaio
// que responde como a documentação da API v3: sem base de dados.

const CRED = { chave_publica: PUBLICA, chave_secreta: SECRETA };
const pedido = (referencia: string) => ({
  referencia,
  chaveIdempotencia: referencia,
  servico: SERVICO_DE_TESTE,
  remetente: {
    nome: "Armazém",
    linha1: "Rua 1",
    codigo_postal: "1000-001",
    localidade: "Lisboa",
    pais: "PT",
  },
  destinatario: {
    nome: "Rui",
    linha1: "Rua 2",
    codigo_postal: "4000-001",
    localidade: "Porto",
    pais: "PT",
  },
  pesoG: 210,
});

describe("adaptador da Sendcloud (docs/36 §16)", () => {
  it("a chamada de teste: credenciais aceites, recusadas, em falta, e sem resposta", async () => {
    const f = sendcloudFalsa();
    const a = adaptadorSendcloud(f.buscar);
    await expect(a.testar(CRED)).resolves.toBeUndefined();
    const recusada = a.testar({ chave_publica: "x", chave_secreta: "y" });
    await expect(recusada).rejects.toThrow(/recusou/);
    await expect(recusada).rejects.not.toBeInstanceOf(ErroDeRede);
    await expect(
      a.testar({ chave_publica: PUBLICA }),
    ).rejects.not.toBeInstanceOf(ErroDeRede);
    const semRede = adaptadorSendcloud(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    await expect(semRede.testar(CRED)).rejects.toBeInstanceOf(ErroDeRede);
  });

  it("os serviços da conta: só o de teste (D2), por país, sem os que pedem ponto de recolha, medidas ou alfândega (D3)", async () => {
    const f = sendcloudFalsa();
    f.estado.servicos.set("PT", [
      opcao(SERVICO_DE_TESTE, { fields: ["to_telephone"], maxKg: "2.000" }),
      opcao("ctt:expresso"),
    ]);
    f.estado.servicos.set("ES", [
      opcao(SERVICO_DE_TESTE, { fields: ["to_email"], maxKg: "1.500" }),
    ]);
    f.estado.servicos.set("FR", [
      opcao(SERVICO_DE_TESTE, { servicePoint: true }),
    ]);
    f.estado.servicos.set("DE", [
      opcao(SERVICO_DE_TESTE, { fields: ["length", "width", "height"] }),
    ]);
    f.estado.servicos.set("CH", [
      opcao(SERVICO_DE_TESTE, { exportDocs: true }),
    ]);
    const a = adaptadorSendcloud(f.buscar);
    const s = await a.servicosDaConta?.(CRED, {
      origem: "PT",
      destinos: ["PT", "ES", "FR", "DE", "CH"],
      modo: "teste",
    });
    expect(s).toEqual([
      {
        codigo: SERVICO_DE_TESTE,
        nome: { pt: `Serviço ${SERVICO_DE_TESTE}` },
        paises: ["PT", "ES"],
        pesoMaxG: 1500,
        pedeTelefone: true,
        pedeEmail: true,
        aceitaOnu: [],
      },
    ]);
    // O pedido não leva preços (sem cotação).
    expect(f.estado.pedidos.at(-1)?.corpo).toEqual({
      from_country_code: "PT",
      to_country_code: "CH",
      calculate_quotes: false,
    });
  });

  it("a etiqueta: só o que a entrega precisa, a referência como chave única, e o mesmo pedido outra vez devolve a mesma etiqueta (R2)", async () => {
    const f = sendcloudFalsa();
    const a = adaptadorSendcloud(f.buscar);
    const r = await a.pedirEtiqueta(CRED, pedido("exp-1"));
    expect(r).toMatchObject({
      estado: "emitida",
      seguimento: "SC00000001",
      urlSeguimento: "https://tracking.exemplo/SC00000001",
      ficheiro: { formato: "pdf" },
    });
    if (r.estado !== "emitida") throw new Error("devia estar emitida");
    expect(r.ficheiro.conteudo.toString()).toBe("%PDF-sendcloud exp-1");
    const corpo = f.estado.envios[0]?.corpo;
    expect(corpo).toEqual({
      label_details: { mime_type: "application/pdf", dpi: 72 },
      external_reference_id: "exp-1",
      reference: "exp-1",
      ship_with: {
        type: "shipping_option_code",
        properties: { shipping_option_code: SERVICO_DE_TESTE },
      },
      from_address: {
        name: "Armazém",
        address_line_1: "Rua 1",
        postal_code: "1000-001",
        city: "Lisboa",
        country_code: "PT",
      },
      to_address: {
        name: "Rui",
        address_line_1: "Rua 2",
        postal_code: "4000-001",
        city: "Porto",
        country_code: "PT",
      },
      parcels: [{ weight: { value: "0.210", unit: "kg" } }],
    });
    // Outra vez (a resposta perdeu-se): 409 com o envio que já existia, e o
    // ficheiro vem pelo documento do volume. Não há segundo envio.
    const de_novo = await a.pedirEtiqueta(CRED, pedido("exp-1"));
    expect(de_novo).toMatchObject({
      estado: "emitida",
      seguimento: "SC00000001",
    });
    expect(f.estado.envios).toHaveLength(1);
  });

  it("a etiqueta recusada (com o motivo), a falha no anúncio e a Sendcloud em baixo (D8)", async () => {
    const f = sendcloudFalsa();
    const a = adaptadorSendcloud(f.buscar);
    f.estado.anunciar = "recusar";
    expect(await a.pedirEtiqueta(CRED, pedido("exp-2"))).toEqual({
      estado: "recusada",
      motivo: "/to_address/postal_code: Postal code is invalid.",
    });
    f.estado.anunciar = "falha_no_volume";
    expect(await a.pedirEtiqueta(CRED, pedido("exp-3"))).toEqual({
      estado: "recusada",
      motivo: "carrier down",
    });
    f.estado.anunciar = "erro_500";
    await expect(a.pedirEtiqueta(CRED, pedido("exp-4"))).rejects.toBeInstanceOf(
      ErroDeRede,
    );
  });

  it("consultar pela referência, anular e seguir", async () => {
    const f = sendcloudFalsa();
    const a = adaptadorSendcloud(f.buscar);
    expect(await a.consultarEtiqueta(CRED, "nao-existe")).toBeNull();
    await a.pedirEtiqueta(CRED, pedido("exp-5"));
    expect(await a.consultarEtiqueta(CRED, "exp-5")).toMatchObject({
      seguimento: "SC00000001",
    });
    // Anular: em fila (202) conta como anulada (D7); recusada, não.
    f.estado.anular = 409;
    expect(await a.anularEtiqueta(CRED, "SC00000001")).toBe("nao_permitido");
    // Em fila (202) não é anulada: a etiqueta continua viva (P2-4).
    f.estado.anular = 202;
    expect(await a.anularEtiqueta(CRED, "SC00000001")).toBe("nao_permitido");
    f.estado.anular = 200;
    expect(await a.anularEtiqueta(CRED, "SC00000001")).toBe("anulada");
    // Anulada, a consulta pela referência já não a dá como viva.
    expect(await a.consultarEtiqueta(CRED, "exp-5")).toBeNull();
    expect(await a.anularEtiqueta(CRED, "OUTRO")).toBe("nao_permitido");
    // O seguimento.
    f.estado.eventos.set("SC00000001", [
      {
        event_at: "2026-10-13T15:00:00Z",
        phase: "delivered",
        exception: "none",
        sub_status: "none",
      },
      {
        event_at: "2026-10-12T10:00:00Z",
        phase: "accepted",
        exception: "none",
        sub_status: "none",
      },
    ]);
    const ev = await a.consultarSeguimento(CRED, "SC00000001");
    expect(ev.map((e) => e.estadoNormalizado)).toEqual([
      "entregue",
      "recolhida",
    ]);
    // O identificador composto é estável (D5): a mesma consulta, os mesmos.
    const outra = await a.consultarSeguimento(CRED, "SC00000001");
    expect(outra.map((e) => e.idExterno)).toEqual(ev.map((e) => e.idExterno));
    expect(await a.consultarSeguimento(CRED, "NAO-EXISTE")).toEqual([]);
  });

  it("o mapa dos estados (D6): forçado e em falta ficam só no histórico", () => {
    expect(normalizar("in_transit", "none")).toBe("em_transito");
    expect(normalizar("attempted", "none")).toBe("tentativa_falhada");
    expect(normalizar("pup", "none")).toBe("disponivel_para_levantar");
    // «Vai ser devolvida» ainda não foi (P2-5); entregue ao vizinho ou na
    // caixa do correio não é a entrega que conta (P2-6).
    expect(normalizar("none", "returned_sender")).toBe("outro");
    expect(normalizar("delivered", "none", "none")).toBe("entregue");
    expect(normalizar("delivered", "none", "neighbour")).toBe("outro");
    expect(normalizar("delivery_forced", "none")).toBe("outro");
    expect(normalizar("none", "missing")).toBe("outro");
    expect(normalizar(null, null)).toBe("outro");
    // Um evento sem data não entra.
    expect(eventosDe({ events: [{ phase: "delivered" }] })).toEqual([]);
  });

  it("o aviso: a assinatura do exemplo da documentação, e só o número de seguimento (D4)", () => {
    const a = adaptadorSendcloud(sendcloudFalsa().buscar);
    // O exemplo da página dos avisos: {"key": "value"} com «secretkey».
    expect(
      a.lerAviso(
        {
          "sendcloud-signature":
            "1eed4b3d41f4653ac64fd56f1bf1cbfd349e4482cbc11dff7134bd93e5da4b0a",
        },
        '{"key": "value"}',
        "secretkey",
      ),
    ).toEqual({
      valido: true,
      referencia: null,
      seguimento: null,
      eventos: [],
    });
    expect(
      a.lerAviso(
        { "sendcloud-signature": "00" },
        '{"key": "value"}',
        "secretkey",
      ),
    ).toEqual({ valido: false });
    expect(a.lerAviso({}, "{}", "secretkey")).toEqual({ valido: false });
  });
  it("um envio que existe mas ainda está a ser anunciado nunca é «recusado» nem «não existe»: fica incerto (P1-1)", async () => {
    const f = sendcloudFalsa();
    const a = adaptadorSendcloud(f.buscar);
    f.estado.anunciar = "anunciando";
    await expect(a.pedirEtiqueta(CRED, pedido("exp-a"))).rejects.toBeInstanceOf(
      ErroDeRede,
    );
    await expect(a.consultarEtiqueta(CRED, "exp-a")).rejects.toBeInstanceOf(
      ErroDeRede,
    );
    // O mesmo pedido outra vez (409) também não.
    await expect(a.pedirEtiqueta(CRED, pedido("exp-a"))).rejects.toBeInstanceOf(
      ErroDeRede,
    );
    expect(f.estado.envios).toHaveLength(1);
  });

  it("os casos de dúvida (P3): 408, um ficheiro que não é PDF, serviços sem unidade conhecida ou com códigos que a base não aceita, e só o serviço de teste", async () => {
    const r408 = adaptadorSendcloud(() =>
      Promise.resolve(new Response("", { status: 408 })),
    );
    await expect(
      r408.pedirEtiqueta(CRED, pedido("exp-b")),
    ).rejects.toBeInstanceOf(ErroDeRede);
    const lixo = adaptadorSendcloud(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              parcels: [
                {
                  id: 1,
                  status: { code: "READY_TO_SEND" },
                  tracking_number: "X1",
                  label_file:
                    Buffer.from("isto não é um pdf").toString("base64"),
                },
              ],
            },
          }),
          { status: 201 },
        ),
      ),
    );
    await expect(
      lixo.pedirEtiqueta(CRED, pedido("exp-c")),
    ).rejects.toBeInstanceOf(ErroDeRede);
    const f = sendcloudFalsa();
    f.estado.servicos.set("PT", [
      {
        ...opcao(SERVICO_DE_TESTE),
        weight: { max: { value: "4", unit: "lbs" } },
      },
      { ...opcao(SERVICO_DE_TESTE), requirements: undefined },
      opcao("postnl:standard/insured=3000"),
    ]);
    const a = adaptadorSendcloud(f.buscar);
    expect(
      await a.servicosDaConta?.(CRED, {
        origem: "PT",
        destinos: ["PT"],
        modo: "teste",
      }),
    ).toEqual([]);
    expect(
      await a.pedirEtiqueta(CRED, {
        ...pedido("exp-d"),
        servico: "ctt:expresso",
      }),
    ).toEqual({
      estado: "recusada",
      motivo: `em modo teste só se pede o serviço ${SERVICO_DE_TESTE}`,
    });
    expect(f.estado.envios).toHaveLength(0);
    // Um cabeçalho com caracteres de vários bytes não rebenta a comparação.
    expect(
      a.lerAviso({ "sendcloud-signature": "é".repeat(64) }, "{}", "segredo"),
    ).toEqual({ valido: false });
  });
});
