import { describe, expect, it } from "vitest";
import { urlSemSegredos } from "../src/base/registo.js";
import {
  ErroDeRede,
  ErroDoEmissor,
  type PedidoRascunho,
} from "../src/faturacao/adaptador.js";
import {
  AdaptadorMoloni,
  paraFormulario,
  taparSegredos,
} from "../src/faturacao/moloni.js";
import { lerFormulario, moloniFalso } from "./moloni-falso.js";

// O adaptador Moloni contra um Moloni simulado (docs/29 §13; DZ). O contrato
// é o da §7.4; cada teste diz a linha da §13 que prova. A prova real é a
// conta trial (§13.7), com as credenciais no ambiente.

const CONFIG = {
  lingua: "1",
  vencimento: "5",
  artigo_portes: "",
  categoria: "77",
  unidade: "3",
  cliente_consumidor_final: "",
  metodos_pagamento: { multibanco: "9" },
};

function montar(porMinuto = 1000) {
  const m = moloniFalso();
  const a = new AdaptadorMoloni({
    clientId: "dev-eurolify",
    clientSecret: "segredo-do-developer",
    empresasPermitidas: m.empresas,
    fetch: m.fetch,
    porMinuto,
  });
  const portes = m.artigo("PORTES", "Portes");
  const cf = m.cliente("999999990", "Consumidor final");
  const config = {
    ...CONFIG,
    artigo_portes: String(portes.product_id),
    cliente_consumidor_final: String(cf.customer_id),
  };
  return { m, a, cred: m.credenciais(), config, portes, cf };
}

const pedido = (
  config: PedidoRascunho["config"],
  mudar: Partial<PedidoRascunho> = {},
): PedidoRascunho => ({
  tipo: "fatura",
  original: null,
  referencia: "inv_0192aaaa-0000-7000-8000-000000000001",
  serie: "500",
  config,
  entidade_id: null,
  cliente: {
    nome: "Rui Lda",
    nif: "509999990",
    pais: "PT",
    morada: {
      linha1: "Rua 2",
      linha2: null,
      codigo_postal: "1000-001",
      localidade: "Lisboa",
      pais: "PT",
    },
  },
  moeda: "EUR",
  linhas: [
    {
      sku: "VER-001",
      descricao: "Verniz vermelho",
      quantidade: 1,
      base: 1000,
      iva: 230,
      total: 1230,
      taxa_emissor: "11",
      taxa: 2300,
      isencao_emissor: null,
      codigo_motivo: null,
    },
    {
      sku: null,
      descricao: "Portes — CTT",
      quantidade: 1,
      base: 406,
      iva: 93,
      total: 499,
      taxa_emissor: "11",
      taxa: 2300,
      isencao_emissor: null,
      codigo_motivo: null,
    },
  ],
  totais: { base: 1406, iva: 323, total: 1729 },
  observacoes: "destino PT · IVA 23 %",
  meio_pagamento: "multibanco",
  ...mudar,
});

describe("o formulário do Moloni", () => {
  it("listas e objectos como products[0][taxes][0][tax_id], ida e volta", () => {
    const dados = {
      company_id: "1",
      products: [{ product_id: 5, taxes: [{ tax_id: "11" }], name: "Á & b" }],
    };
    const texto = paraFormulario(dados);
    expect(texto).toContain("products%5B0%5D%5Btaxes%5D%5B0%5D%5Btax_id%5D=11");
    expect(lerFormulario(texto)).toEqual({
      company_id: "1",
      products: [{ product_id: "5", taxes: [{ tax_id: "11" }], name: "Á & b" }],
    });
  });

  it("os segredos nunca ficam num texto (§13.4)", () => {
    expect(
      taparSegredos(
        "https://api.moloni.pt/v1/grant/?client_secret=abc&refresh_token=xyz&access_token=t1",
      ),
    ).toBe(
      "https://api.moloni.pt/v1/grant/?client_secret=***&refresh_token=***&access_token=***",
    );
  });

  it("o código e o valor da autorização não ficam no registo da API (revisão do #407, P1-1)", () => {
    expect(
      urlSemSegredos(
        "/invoicing-connections/moloni/callback?code=abc.123&state=XyZ_-9&outro=1",
      ),
    ).toBe(
      "/invoicing-connections/moloni/callback?code=[tapado]&state=[tapado]&outro=1",
    );
    expect(urlSemSegredos("/x?STATE=a")).toBe("/x?STATE=[tapado]");
    // O código postal da procura de pontos (docs/36 §21.5; #439, P2-2).
    expect(
      urlSemSegredos(
        "/checkout/t/pickup-points?metodo=shm_1&pais=PT&codigo_postal=4700-000",
      ),
    ).toBe(
      "/checkout/t/pickup-points?metodo=shm_1&pais=PT&codigo_postal=[tapado]",
    );
  });
});

describe("o adaptador Moloni", () => {
  it("a autorização (docs/29 §17): sem endereço de resposta não se pede; o código troca-se uma vez pelos tokens da empresa de teste", async () => {
    const { m, a } = montar();
    expect(a.urlAutorizacao("abc")).toBeNull();
    await expect(
      a.trocarCodigo(m.codigoAutorizacao(), String(m.empresa)),
    ).rejects.toBeInstanceOf(ErroDoEmissor);
    const b = new AdaptadorMoloni({
      clientId: "dev-eurolify",
      clientSecret: "segredo-do-developer",
      empresasPermitidas: m.empresas,
      redirectUri: "https://api.exemplo.test/cb",
      fetch: m.fetch,
    });
    const cod = m.codigoAutorizacao();
    const cred = await b.trocarCodigo(cod, String(m.empresa));
    expect(cred).toMatchObject({
      company_id: String(m.empresa),
      access_token: expect.any(String) as unknown,
      refresh_token: expect.any(String) as unknown,
    });
    await expect(b.testar(cred)).resolves.toBeUndefined();
    // O mesmo código outra vez: o Moloni recusa (um uso).
    await expect(b.trocarCodigo(cod, String(m.empresa))).rejects.toBeInstanceOf(
      ErroDoEmissor,
    );
    // Uma empresa fora da lista de teste (M8): nem se chama o Moloni.
    const antes = m.estado.codigos.size;
    await expect(b.trocarCodigo(m.codigoAutorizacao(), "999")).rejects.toThrow(
      /M8/,
    );
    expect(m.estado.codigos.size).toBe(antes + 1);
  });

  it("testar: a autorização tem de abrir a empresa da ligação", async () => {
    const { a, cred } = montar();
    await expect(a.testar(cred)).resolves.toBeUndefined();
    await expect(a.testar({ ...cred, company_id: "5" })).rejects.toBeInstanceOf(
      ErroDoEmissor,
    );
  });

  it("emite em dois passos: rascunho com a nossa referência, fechar, ler de volta e o PDF (§13.3)", async () => {
    const { m, a, cred, config } = montar();
    const p = pedido(config);
    const { id } = await a.criarRascunho(cred, p);
    const rascunho = await a.lerDocumento(cred, id);
    expect(rascunho).toMatchObject({
      tipo: "fatura",
      estado: "rascunho",
      referencia: p.referencia,
      numero: null,
      serie: "500",
      nif: "509999990",
      nome: "Rui Lda",
      pais: "PT",
      totais: { base: 1406, iva: 323, total: 1729 },
    });
    expect(rascunho.linhas).toEqual([
      {
        descricao: "Verniz vermelho",
        quantidade: 1,
        base: 1000,
        taxa: 2300,
        codigo_motivo: null,
        iva: 230,
      },
      {
        descricao: "Portes — CTT",
        quantidade: 1,
        base: 406,
        taxa: 2300,
        codigo_motivo: null,
        iva: 93,
      },
    ]);
    const fechado = await a.fechar(cred, id);
    expect(fechado).toMatchObject({
      estado: "fechado",
      numero: "FT LOJA/1",
      serie: "500",
      referencia: p.referencia,
    });
    // O fecho foi um update com o documento inteiro e status 1 (A3).
    const update = m.estado.pedidos.find((x) => x.metodo === "invoices/update");
    expect(update?.corpo).toMatchObject({
      document_id: id,
      status: "1",
      our_reference: p.referencia,
    });
    const pdf = await a.pdf(cred, id);
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(
      m.estado.pedidos.find((x) => x.metodo === "documents/getPDFLink")?.corpo,
    ).toMatchObject({ signed: "1" });
  });

  it("o token vai no endereço e nunca entra num erro; o corpo é formulário (A4, §13.4)", async () => {
    const { m, a, cred, config } = montar();
    await a.criarRascunho(cred, pedido(config));
    for (const x of m.estado.pedidos) {
      expect(new URL(x.url).searchParams.get("access_token")).toBe(
        cred.access_token,
      );
      expect(JSON.stringify(x.corpo)).not.toContain(cred.access_token);
    }
    await expect(a.lerDocumento(cred, "1")).rejects.toThrow(/não existe/);
    m.estado.falhas.recusar = new Set(["documents/getOne"]);
    const erro = await a.lerDocumento(cred, "1").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeRede);
    expect((erro as Error).message).not.toContain(cred.access_token);
    expect((erro as Error).cause).toBeUndefined();
  });

  describe("o artigo de cada linha (M2)", () => {
    it("usa o artigo com a referência exacta = SKU; os portes no artigo da ligação", async () => {
      const { m, a, cred, config, portes } = montar();
      const existente = m.artigo("VER-001", "Outro nome qualquer");
      m.artigo("VER-0011", "Verniz vermelho");
      const { id } = await a.criarRascunho(cred, pedido(config));
      const doc = m.estado.documentos.find((d) => String(d.document_id) === id);
      expect(doc?.products.map((p) => Number(p["product_id"]))).toEqual([
        existente.product_id,
        portes.product_id,
      ]);
      expect(m.estado.pedidos.some((x) => x.metodo === "products/insert")).toBe(
        false,
      );
    });

    it("cria-o sem gestão de stock quando não existe, nunca pelo nome", async () => {
      const { m, a, cred, config } = montar();
      m.artigo("OUTRA-REF", "Verniz vermelho");
      await a.criarRascunho(cred, pedido(config));
      const criado = m.estado.artigos.find((x) => x.reference === "VER-001");
      expect(criado?.dados).toMatchObject({
        reference: "VER-001",
        has_stock: "0",
        category_id: "77",
        unit_id: "3",
        type: "1",
        taxes: [{ tax_id: "11" }],
      });
    });

    it("mais de um artigo com a mesma referência: não escolhe", async () => {
      const { m, a, cred, config } = montar();
      m.artigo("VER-001");
      m.artigo("VER-001");
      await expect(a.criarRascunho(cred, pedido(config))).rejects.toThrow(
        /mais de um artigo/,
      );
      expect(m.estado.documentos.length).toBe(0);
    });
  });

  describe("o cliente (M3)", () => {
    it("procura pelo NIF, também com o prefixo do país; mais de um → sem NIF (não escolhe)", async () => {
      const { m, a, cred } = montar();
      m.cliente("ESB12345678", "Empresa SL", 70);
      m.cliente("B123456789", "Parecida");
      expect(await a.procurarEntidade(cred, "B12345678")).toMatchObject({
        nif: "ESB12345678",
        nome: "Empresa SL",
      });
      m.cliente("B12345678", "Outra com o mesmo número");
      expect(await a.procurarEntidade(cred, "B12345678")).toEqual({
        id: "",
        nif: null,
        nome: null,
      });
      expect(await a.procurarEntidade(cred, "123")).toBeNull();
    });

    it("cria-o com os valores da ligação quando não existe", async () => {
      const { m, a, cred, config } = montar();
      await a.criarRascunho(cred, pedido(config));
      const novo = m.estado.clientes.find((x) => x.vat === "509999990");
      expect(novo?.dados).toMatchObject({
        name: "Rui Lda",
        number: "509999990",
        language_id: "1",
        maturity_date_id: "5",
        payment_method_id: "9",
        country_id: "1",
        address: "Rua 2",
        city: "Lisboa",
        zip_code: "1000-001",
      });
    });

    it("sem morada fiscal completa não cria nada (nada se inventa)", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      await expect(
        a.criarRascunho(cred, {
          ...p,
          cliente: {
            ...p.cliente,
            morada: { ...p.cliente.morada, localidade: null },
          },
        }),
      ).rejects.toBeInstanceOf(ErroDoEmissor);
      expect(m.estado.clientes.length).toBe(1);
      expect(m.estado.documentos.length).toBe(0);
    });

    it("sem NIF sai no cliente «Consumidor final» da ligação, e lê-se sem NIF nem país", async () => {
      const { m, a, cred, config, cf } = montar();
      const p = pedido(config);
      const { id } = await a.criarRascunho(cred, {
        ...p,
        cliente: { ...p.cliente, nif: null, pais: null },
      });
      expect(
        m.estado.documentos.find((d) => String(d.document_id) === id)
          ?.customer_id,
      ).toBe(cf.customer_id);
      expect(await a.lerDocumento(cred, id)).toMatchObject({
        nif: null,
        pais: null,
      });
    });
  });

  describe("tokens (§13.4)", () => {
    it("não renova enquanto servem; renova perto do fim, com um par novo", async () => {
      const { m, a, cred } = montar();
      expect(await a.renovar(cred, "usar")).toBeNull();
      const perto = {
        ...cred,
        access_expira: new Date(Date.now() + 60_000).toISOString(),
      };
      const novas = await a.renovar(perto, "usar");
      expect(novas?.access_token).not.toBe(cred.access_token);
      expect(novas?.refresh_token).not.toBe(cred.refresh_token);
      expect(novas?.company_id).toBe(cred.company_id);
      // O par antigo deixou de servir (é o que o Moloni faz).
      await expect(a.renovar(perto, "usar")).rejects.toBeInstanceOf(
        ErroDoEmissor,
      );
      // O pedido de renovação levou o segredo e nenhum erro o mostra.
      const grant = m.estado.pedidos.filter((x) => x.metodo === "grant");
      expect(grant.length).toBe(2);
    });

    it("renova ao fim de 7 dias mesmo com o token de acesso válido", async () => {
      const { a, cred } = montar();
      const velho = {
        ...cred,
        refresh_em: new Date(Date.now() - 8 * 24 * 3_600_000).toISOString(),
      };
      expect(await a.renovar(velho, "manter")).not.toBeNull();
    });

    it("a autorização morta é um erro do emissor, sem segredos na mensagem", async () => {
      const { m, a, cred } = montar();
      m.estado.falhas.renovacaoMorta = true;
      const e = await a
        .renovar({ ...cred, refresh_em: "" }, "manter")
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroDoEmissor);
      expect((e as Error).message).toMatch(/invalid_grant/);
      expect((e as Error).message).not.toContain(cred.refresh_token);
      expect((e as Error).message).not.toContain("segredo-do-developer");
    });

    it("as outras operações nunca renovam: um token expirado é um erro", async () => {
      const { m, a, cred } = montar();
      const expirado = {
        ...cred,
        access_expira: new Date(Date.now() - 1000).toISOString(),
      };
      await expect(a.testar(expirado)).rejects.toThrow(/expirou/);
      expect(m.estado.pedidos.some((x) => x.metodo === "grant")).toBe(false);
    });
  });

  describe("procurar pela referência (§4.2, A9)", () => {
    it("encontra o rascunho, diz «não existe» e, com dois, «não sei»", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      expect(await a.procurarPorReferencia(cred, p.referencia)).toEqual({
        estado: "nao_existe",
      });
      const { id } = await a.criarRascunho(cred, p);
      const r = await a.procurarPorReferencia(cred, p.referencia);
      expect(r.estado).toBe("encontrado");
      expect(r.estado === "encontrado" && r.documento.id).toBe(id);
      // Uma referência que contém a nossa não é a nossa — e, como a lista não
      // veio vazia, não se sabe (nunca «não existe»; revisão do #384, P1-1).
      expect(
        (await a.procurarPorReferencia(cred, p.referencia.slice(0, -1))).estado,
      ).toBe("nao_sei");
      m.estado.documentos.push({
        ...(m.estado.documentos[0] as (typeof m.estado.documentos)[number]),
        document_id: 1,
      });
      expect((await a.procurarPorReferencia(cred, p.referencia)).estado).toBe(
        "nao_sei",
      );
    });
  });

  describe("falhas", () => {
    it("o rascunho criado sem resposta é ErroDeRede (reconcilia-se, nunca se repete)", async () => {
      const { m, a, cred, config } = montar();
      m.estado.falhas.rede = new Set(["invoices/insert"]);
      await expect(
        a.criarRascunho(cred, pedido(config)),
      ).rejects.toBeInstanceOf(ErroDeRede);
      expect(m.estado.documentos.length).toBe(1);
    });

    it("um erro de dados do Moloni é ErroDoEmissor com os códigos", async () => {
      const { a, cred, config } = montar();
      const p = pedido(config);
      await expect(
        a.criarRascunho(cred, { ...p, entidade_id: "424242" }),
      ).rejects.toThrow(/invoices\/insert: 2 customer_id/);
    });

    it("o estado 2 do Moloni nunca se lê como fechado; outro tipo de documento também não", async () => {
      const { m, a, cred, config } = montar();
      const { id } = await a.criarRascunho(cred, pedido(config));
      m.estado.falhas.statusForcado = 2;
      await expect(a.fechar(cred, id)).rejects.toThrow(/não se conhece \(2\)/);
      const d = m.estado.documentos[0];
      if (d !== undefined) {
        d.status = 1;
        d.saft = "GT";
      }
      await expect(a.lerDocumento(cred, id)).rejects.toThrow(/outro tipo/);
    });

    it("um fechado não se apaga; o rascunho sim", async () => {
      const { m, a, cred, config } = montar();
      const { id } = await a.criarRascunho(cred, pedido(config));
      await a.apagarRascunho(cred, id);
      expect(m.estado.documentos.length).toBe(0);
      const outro = await a.criarRascunho(cred, pedido(config));
      await a.fechar(cred, outro.id);
      await expect(a.apagarRascunho(cred, outro.id)).rejects.toBeInstanceOf(
        ErroDoEmissor,
      );
    });

    it("nota de crédito (M7), outra moeda (M6) e série em falta não chegam ao Moloni", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      await expect(
        a.criarRascunho(cred, { ...p, tipo: "nota_credito" }),
      ).rejects.toThrow(/M7/);
      await expect(
        a.criarRascunho(cred, { ...p, moeda: "USD" }),
      ).rejects.toThrow(/M6/);
      await expect(
        a.criarRascunho(cred, { ...p, serie: null }),
      ).rejects.toThrow(/série/);
      expect(m.estado.pedidos.length).toBe(0);
    });

    it("limita-se a si próprio por empresa (§13.5)", async () => {
      const { m, a, cred } = montar(2);
      await a.testar(cred);
      await a.testar(cred);
      const terceiro = a.testar(cred);
      let acabou = false;
      void terceiro.then(() => {
        acabou = true;
      });
      await new Promise((ok) => setTimeout(ok, 50));
      expect(acabou).toBe(false);
      expect(m.estado.pedidos.length).toBe(2);
    });
  });
  describe("as correcções da revisão do #384", () => {
    it("P1-1: sem a referência nas linhas do getAll, o documento confirma-se no getOne", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      const { id } = await a.criarRascunho(cred, p);
      m.estado.falhas.getAllSemReferencia = true;
      const r = await a.procurarPorReferencia(cred, p.referencia);
      expect(r.estado === "encontrado" && r.documento.id).toBe(id);
    });

    it("P1-1: o filtro ignorado com um documento alheio dá «não sei»; com o nosso, encontra-o", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      await a.criarRascunho(cred, { ...p, referencia: "inv_outro" });
      m.estado.falhas.getAllIgnoraFiltro = true;
      m.estado.falhas.getAllSemReferencia = true;
      expect((await a.procurarPorReferencia(cred, p.referencia)).estado).toBe(
        "nao_sei",
      );
      const { id } = await a.criarRascunho(cred, p);
      const r = await a.procurarPorReferencia(cred, p.referencia);
      expect(r.estado === "encontrado" && r.documento.id).toBe(id);
    });

    it("P1-2: uma empresa fora da lista das contas de teste é recusada sem nenhum pedido", async () => {
      const m = moloniFalso();
      const a = new AdaptadorMoloni({
        clientId: "dev-eurolify",
        clientSecret: "segredo-do-developer",
        empresasPermitidas: ["5"],
        fetch: m.fetch,
      });
      const cred = m.credenciais();
      await expect(a.testar(cred)).rejects.toThrow(/M8/);
      await expect(
        a.criarRascunho(cred, pedido({ ...CONFIG })),
      ).rejects.toThrow(/M8/);
      expect(m.estado.pedidos).toEqual([]);
    });

    it("P2-2: um segredo do servidor errado não mata a ligação (ErroDeRede); só o invalid_grant", async () => {
      const { m, a, cred } = montar();
      m.estado.falhas.segredoErrado = true;
      await expect(
        a.renovar({ ...cred, refresh_em: "" }, "manter"),
      ).rejects.toBeInstanceOf(ErroDeRede);
    });

    it("P2-1: a tarefa (manter) não renova um par novo, mesmo com o acesso expirado", async () => {
      const { m, a, cred } = montar();
      const expirado = {
        ...cred,
        access_expira: new Date(Date.now() - 1000).toISOString(),
      };
      expect(await a.renovar(expirado, "manter")).toBeNull();
      expect(await a.renovar(expirado, "usar")).not.toBeNull();
      expect(m.estado.pedidos.filter((x) => x.metodo === "grant").length).toBe(
        1,
      );
    });

    it("P2-4: o «Consumidor final» da ligação tem de ter o NIF de consumidor final", async () => {
      const { m, a, cred, config } = montar();
      const outro = m.cliente("", "João Silva");
      const p = pedido({
        ...config,
        cliente_consumidor_final: String(outro.customer_id),
      });
      await expect(
        a.criarRascunho(cred, {
          ...p,
          cliente: { ...p.cliente, nif: null, pais: null },
        }),
      ).rejects.toThrow(/consumidor final/);
      expect(m.estado.documentos.length).toBe(0);
    });

    it("P2-4: um documento sem NIF no Moloni não se lê como consumidor final", async () => {
      const { m, a, cred, config } = montar();
      const outro = m.cliente("", "João Silva");
      const { id } = await a.criarRascunho(cred, {
        ...pedido(config),
        entidade_id: String(outro.customer_id),
      });
      const d = await a.lerDocumento(cred, id);
      expect(d.nif).not.toBeNull();
      expect(d.nif).not.toBe("");
    });

    it("P2-5: o cliente cria-se no país da morada; o país do contribuinte lê-se do NIF", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      const { id } = await a.criarRascunho(cred, {
        ...p,
        cliente: {
          ...p.cliente,
          morada: { ...p.cliente.morada, pais: "ES", codigo_postal: "28001" },
        },
      });
      expect(
        m.estado.clientes.find((x) => x.vat === "509999990")?.dados,
      ).toMatchObject({ country_id: "70" });
      expect((await a.lerDocumento(cred, id)).pais).toBe("PT");
      const es = m.cliente("ESB12345678", "Empresa SL", 70);
      const outro = await a.criarRascunho(cred, {
        ...p,
        referencia: "inv_es",
        entidade_id: String(es.customer_id),
      });
      expect((await a.lerDocumento(cred, outro.id)).pais).toBe("ES");
    });

    it("P2-6: o fecho leva a data de hoje, não a do rascunho", async () => {
      const { m, a, cred, config } = montar();
      const { id } = await a.criarRascunho(cred, pedido(config));
      const d = m.estado.documentos[0];
      if (d !== undefined) d.date = "2026-01-02";
      const fechado = await a.fechar(cred, id);
      const hoje = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Lisbon",
      }).format(new Date());
      expect(fechado.data).toBe(hoje);
    });

    it("P2-7: o preço unitário vai com 6 casas, sem a dízima do JavaScript", async () => {
      const { m, a, cred, config } = montar();
      const p = pedido(config);
      const [l] = p.linhas;
      if (l === undefined) throw new Error("sem linha");
      await a.criarRascunho(cred, {
        ...p,
        linhas: [{ ...l, quantidade: 3 }],
      });
      const insert = m.estado.pedidos.find(
        (x) => x.metodo === "invoices/insert",
      );
      expect(
        ((insert?.corpo["products"] as Record<string, unknown>[])[0] ?? {})[
          "price"
        ],
      ).toBe("3.333333");
    });

    it("P3: o PDF só se descarrega do Moloni e tem de ser PDF", async () => {
      const { m, a, cred, config } = montar();
      const { id } = await a.criarRascunho(cred, pedido(config));
      await a.fechar(cred, id);
      m.estado.falhas.pdf = "outro_anfitriao";
      await expect(a.pdf(cred, id)).rejects.toThrow(/ligação do PDF/);
      m.estado.falhas.pdf = "html";
      await expect(a.pdf(cred, id)).rejects.toThrow(/não é PDF/);
    });

    it("P3: os segredos em JSON também se tapam", () => {
      expect(
        taparSegredos('{"access_token":"t1","refresh_token":"r1","x":"y"}'),
      ).toBe('{"access_token":"***","refresh_token":"***","x":"y"}');
    });
  });
});
