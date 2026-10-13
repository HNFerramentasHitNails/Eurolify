import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarMercado } from "../src/precos/repositorio.js";
import { AdaptadorMoloni } from "../src/faturacao/moloni.js";
import {
  faltaNaLigacao,
  motivosDoConteudo,
  type Conteudo,
  type LinhaDoConteudo,
} from "../src/faturacao/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { moloniFalso } from "./moloni-falso.js";

// Criar a ligação ao Moloni e configurá-la pelo Hub (docs/22 §31; docs/06,
// EH): só o dono; as listas lidas do Moloni (simulado) com o que o Eurolify
// precisa de mapear; a pesquisa de clientes sem contribuinte nem morada; ao
// gravar, o servidor relê as listas e recusa um id que lá não exista.

type Json = Record<string, unknown>;
type Resposta = { statusCode: number; body: string };

describe.skipIf(URL_BASE === undefined)(
  "Hub: configurar a ligação ao Moloni",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a = "";
    let b = "";
    let entidade = "";
    let ligacao = "";
    const p: Record<string, { pessoa: string; sessao: string }> = {};
    const moloni = moloniFalso();
    const faturacao = {
      chave: chavePagamentos(randomBytes(32).toString("base64")),
      adaptadores: {
        moloni: new AdaptadorMoloni({
          clientId: "dev-eurolify",
          clientSecret: "segredo-do-developer",
          empresasPermitidas: [String(moloni.empresa)],
          redirectUri:
            "https://api.exemplo.test/invoicing-connections/moloni/callback",
          fetch: moloni.fetch,
          // Cada abertura são 8 leituras: o limite real (60) faria esperar.
          porMinuto: 10_000,
        }),
      },
    };

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base, { faturacao });
      a = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      b = await registarComerciante(base.api, {
        nome: "Loja B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      entidade = await criarEntidadeLegal(base.api, a, {
        denominacao: "Loja Exemplo, Lda",
        forma_juridica: "sociedade_por_quotas",
        pais: "PT",
        numero_fiscal: "501964843",
        morada_linha: "Rua de Teste, 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });
      for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
        const x = await h.pessoaCom(a, papel);
        p[papel] = { pessoa: x.pessoa, sessao: x.sessao };
      }
      const x = await h.pessoaCom(b, "dono");
      p["donoB"] = { pessoa: x.pessoa, sessao: x.sessao };
    }, 120_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const como = (
      papel: string,
      metodo: "GET" | "POST" | "PATCH",
      url: string,
      corpo?: unknown,
    ) =>
      h.pedir(metodo, url, {
        sessao: p[papel]?.sessao ?? "",
        comerciante: papel === "donoB" ? b : a,
        ...(corpo === undefined ? {} : { corpo }),
      });
    const ok = async (r: Promise<Resposta>, estado = 200) => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      return JSON.parse(x.body) as Json;
    };
    const codigo = async (r: Promise<Resposta>): Promise<[number, unknown]> => {
      const x = await r;
      return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
    };
    const proibido = [403, "member.role_escalation"];
    const naoExiste = [404, "invoices.not_found"];
    const url = (resto = "") =>
      `/hub/invoicing-connections/isx_${ligacao}${resto}`;

    it("criar a ligação: só o dono, sem série nem mapas, por testar; uma activa por entidade", async () => {
      const corpo = { entidade_legal: `lgl_${entidade}` };
      for (const papel of ["gestor", "apoio", "armazem"]) {
        expect(
          await codigo(
            como(papel, "POST", "/hub/invoicing-connections", corpo),
          ),
        ).toEqual(proibido);
      }
      // A entidade de outro comerciante não existe para este.
      expect(
        await codigo(
          como("donoB", "POST", "/hub/invoicing-connections", corpo),
        ),
      ).toEqual(naoExiste);
      const r = await ok(
        como("dono", "POST", "/hub/invoicing-connections", corpo),
        201,
      );
      ligacao = String(r["id"]).slice(4);
      const l = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      )[0];
      expect(l).toMatchObject({
        adaptador: "moloni",
        estado: "por_testar",
        serie: null,
        taxas: [],
        isencoes: [],
      });
      // O que falta, sem ler o Moloni: pelo menos a taxa normal de Portugal.
      expect((l?.["faltam"] as Json)["taxas"]).toContainEqual({
        pais: "PT",
        taxa: 2300,
      });
      expect(
        await codigo(como("dono", "POST", "/hub/invoicing-connections", corpo)),
      ).toEqual([400, "invoices.invalid_field"]);
    });

    it("as listas e a pesquisa: antes de ligar a conta, por ligar; só o dono; outro comerciante não chega", async () => {
      expect(await codigo(como("dono", "GET", url("/issuer-options")))).toEqual(
        [422, "invoices.issuer_not_ready"],
      );
      // Liga a conta (§30) para as leituras seguintes.
      const pedido = await ok(
        como("dono", "POST", url("/authorize"), {
          empresa: String(moloni.empresa),
        }),
      );
      const concluir = await como("dono", "POST", url("/authorize/complete"), {
        codigo: moloni.codigoAutorizacao(),
        estado: pedido["estado"],
      });
      expect(concluir.statusCode, concluir.body).toBe(204);
      const pesquisa = url("/issuer-search?tipo=cliente&q=Consumidor");
      for (const papel of ["gestor", "apoio", "armazem"]) {
        expect(
          await codigo(como(papel, "GET", url("/issuer-options"))),
        ).toEqual(proibido);
        expect(await codigo(como(papel, "GET", pesquisa))).toEqual(proibido);
        expect(
          await codigo(como(papel, "PATCH", url(), { versao: 1, serie: "77" })),
        ).toEqual(proibido);
      }
      expect(
        await codigo(como("donoB", "GET", url("/issuer-options"))),
      ).toEqual(naoExiste);
      expect(await codigo(como("donoB", "GET", pesquisa))).toEqual(naoExiste);
      expect(
        await codigo(como("donoB", "PATCH", url(), { versao: 1, serie: "77" })),
      ).toEqual(naoExiste);
    });

    it("as listas lidas do Moloni, com o valor e a zona de cada taxa, e o que o Eurolify precisa de mapear", async () => {
      const r = await ok(como("dono", "GET", url("/issuer-options")));
      const listas = r["listas"] as Json;
      expect(listas["series"]).toEqual([
        { id: "77", nome: "Loja online 2026" },
      ]);
      expect(listas["taxas"]).toContainEqual({
        id: "11",
        nome: "Taxa Normal",
        valor: 2300,
        zona: "PT",
      });
      // Só as de IVA: o imposto de selo de 23 % (saft_type 2) não aparece.
      expect((listas["taxas"] as Json[]).map((x) => x["id"])).not.toContain(
        "16",
      );
      expect(listas["isencoes"]).toEqual([
        { id: "M16", nome: "Artigo 14.º do RITI" },
      ]);
      expect(listas["vencimentos"]).toEqual([
        { id: "41", nome: "Pronto pagamento", dias: 0 },
      ]);
      expect(listas["unidades"]).toEqual([
        { id: "51", nome: "Unidade", abreviatura: "Un." },
      ]);
      expect(listas["categorias"]).toEqual([{ id: "61", nome: "Loja online" }]);
      const necessario = r["necessario"] as Json;
      // Só os países da entidade e dos mercados activos (aqui, só PT).
      const taxas = necessario["taxas"] as Json[];
      expect(taxas).toContainEqual({ pais: "PT", taxa: 2300 });
      expect(taxas.every((t) => t["pais"] === "PT")).toBe(true);
      expect(
        (necessario["isencoes"] as Json[]).every((i) => i["pais"] === "PT"),
      ).toBe(true);
      expect(r["ligacao"]).toMatchObject({ serie: null, taxas: [] });
    });

    it("a pesquisa de clientes devolve só o id, o número e o nome — nunca o contribuinte nem a morada", async () => {
      const c = moloni.cliente("999999990", "Consumidor final");
      moloni.artigo("PORTES", "Portes de envio");
      const r = await ok(
        como("dono", "GET", url("/issuer-search?tipo=cliente&q=Consumidor")),
      );
      expect(r["dados"]).toEqual([
        {
          tipo: "cliente",
          id: String(c.customer_id),
          nome: "Consumidor final",
          numero: "999999990",
        },
      ]);
      expect(JSON.stringify(r)).not.toContain("Rua de Teste");
      expect(JSON.stringify(r)).not.toMatch(/"vat"|"address"/);
      // O que se pesquisou não vai para o registo (P1-1 do #412).
      const registo = h.registo.join("");
      expect(registo).toContain("issuer-search?tipo=cliente&q=[tapado]");
      expect(registo).not.toContain("q=Consumidor");
      const artigos = await ok(
        como("dono", "GET", url("/issuer-search?tipo=artigo&q=Portes")),
      );
      expect(artigos["dados"]).toEqual([
        expect.objectContaining({
          tipo: "artigo",
          nome: "Portes de envio",
          referencia: "PORTES",
          preco: 350,
        }),
      ]);
    });

    it("gravar: um id que não existe no Moloni, ou uma taxa de outro valor, é recusado; com a versão errada, 409", async () => {
      const versao = Number(
        (
          (await ok(como("dono", "GET", url("/issuer-options"))))[
            "ligacao"
          ] as Json
        )["versao"],
      );
      const recusado = [400, "invoices.invalid_field"];
      const casos: Json[] = [
        { serie: "999" },
        { taxas: [{ pais: "PT", taxa: 2300, emissor: "999" }] },
        // A taxa 12 do Moloni é de 6 %: não mapeia o par de 23 %.
        { taxas: [{ pais: "PT", taxa: 2300, emissor: "12" }] },
        { isencoes: [{ codigo: "M16", emissor: "M99" }] },
        { config: { lingua: "999" } },
        { config: { metodos_pagamento: { mb_way: "999" } } },
        { config: { artigo_portes: "999" } },
        { config: { cliente_consumidor_final: "999" } },
        // Outro imposto com o mesmo valor (saft_type 2): não é IVA.
        { taxas: [{ pais: "PT", taxa: 2300, emissor: "16" }] },
        // Um cliente que existe, mas sem o NIF de consumidor final (P3-6).
        {
          config: {
            cliente_consumidor_final: String(
              moloni.cliente("501964843", "Rui Exemplo").customer_id,
            ),
          },
        },
      ];
      for (const caso of casos) {
        expect(
          await codigo(como("dono", "PATCH", url(), { versao, ...caso })),
          JSON.stringify(caso),
        ).toEqual(recusado);
      }
      expect(
        await codigo(
          como("dono", "PATCH", url(), { versao: versao + 5, serie: "77" }),
        ),
      ).toEqual([409, "invoices.version_conflict"]);
    });

    it("gravar tudo de uma vez: fica por testar, com a pessoa; testa e fica pronta", async () => {
      const opcoes = await ok(como("dono", "GET", url("/issuer-options")));
      const versao = Number((opcoes["ligacao"] as Json)["versao"]);
      const cliente = (
        (
          await ok(
            como(
              "dono",
              "GET",
              url("/issuer-search?tipo=cliente&q=Consumidor"),
            ),
          )
        )["dados"] as Json[]
      )[0];
      const portes = (
        (
          await ok(
            como("dono", "GET", url("/issuer-search?tipo=artigo&q=Portes")),
          )
        )["dados"] as Json[]
      )[0];
      const r = await ok(
        como("dono", "PATCH", url(), {
          versao,
          serie: "77",
          taxas: [{ pais: "PT", taxa: 2300, emissor: "11" }],
          isencoes: [{ codigo: "M16", emissor: "M16" }],
          config: {
            lingua: "1",
            vencimento: "41",
            unidade: "51",
            categoria: "61",
            metodos_pagamento: { mb_way: "31" },
            artigo_portes: String(portes?.["id"]),
            cliente_consumidor_final: String(cliente?.["id"]),
          },
        }),
      );
      expect(r).toEqual({ versao: versao + 1, estado: "por_testar" });
      const l = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      )[0];
      expect(l).toMatchObject({ serie: "77", estado: "por_testar" });
      // O 23 % de Portugal já não falta.
      expect((l?.["faltam"] as Json)["taxas"]).not.toContainEqual({
        pais: "PT",
        taxa: 2300,
      });
      expect(await ok(como("dono", "POST", url("/test")))).toEqual({
        estado: "pronta",
        erro: null,
      });
    });

    it("confere-se só o que muda: uma escolha antiga que o Moloni já não tem não impede de gravar o resto (P2-1)", async () => {
      const series = moloni.estado.listas.series;
      moloni.estado.listas.series = [];
      try {
        const versao = Number(
          (
            (await ok(como("dono", "GET", url("/issuer-options"))))[
              "ligacao"
            ] as Json
          )["versao"],
        );
        // A série «77» fica igual; só as isenções mudam. A ligação estava
        // pronta: passa a por testar.
        expect(
          await ok(
            como("dono", "PATCH", url(), { versao, serie: "77", isencoes: [] }),
          ),
        ).toEqual({ versao: versao + 1, estado: "por_testar" });
        // Escolher outra vez uma que não existe continua recusado.
        expect(
          await codigo(
            como("dono", "PATCH", url(), { versao: versao + 1, serie: "78" }),
          ),
        ).toEqual([400, "invoices.invalid_field"]);
      } finally {
        moloni.estado.listas.series = series;
      }
    });

    it("credenciais recusadas pelo Moloni (401): issuer_error, e ler as listas nunca põe a ligação com erro", async () => {
      const antes = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      )[0];
      const tokens = new Map(moloni.estado.tokens);
      moloni.estado.tokens.clear();
      try {
        expect(
          await codigo(como("dono", "GET", url("/issuer-options"))),
        ).toEqual([502, "invoices.issuer_error"]);
        expect(
          await codigo(
            como("dono", "GET", url("/issuer-search?tipo=artigo&q=Portes")),
          ),
        ).toEqual([502, "invoices.issuer_error"]);
      } finally {
        for (const [k, v] of tokens) moloni.estado.tokens.set(k, v);
      }
      const depois = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      )[0];
      expect(depois).toMatchObject({
        estado: antes?.["estado"],
        versao: antes?.["versao"],
        erro: antes?.["erro"],
      });
    });

    it("o que falta: só os países e os meios dos mercados activos desta entidade, e as taxas vigentes hoje (P2-5)", async () => {
      // Taxas de Espanha só nesta base de teste: uma antiga, a vigente e uma
      // futura (a tabela só se acrescenta).
      await sql`insert into taxa_iva (pais, regiao, categoria, tipo, percentagem, inicio, fonte) values
        ('ES', null, 'normal', 'taxa', 1800, '2000-01-01', 'teste'),
        ('ES', null, 'normal', 'taxa', 2100, '2020-01-01', 'teste'),
        ('ES', null, 'normal', 'taxa', 2200, '2099-01-01', 'teste'),
        ('FR', null, 'normal', 'taxa', 2000, '2020-01-01', 'teste')`.execute(
        base.dono,
      );
      const loja = await criarLoja(base.api, a, {
        entidade_legal_id: entidade,
        nome: "Loja online",
      });
      const mercado = async (
        e: string,
        nomeLoja: string,
        paises: string[],
        activo: boolean,
      ) => {
        const l =
          e === entidade
            ? loja
            : await criarLoja(base.api, a, {
                entidade_legal_id: e,
                nome: nomeLoja,
              });
        const m = await criarMercado(base.api, a, {
          loja_id: l,
          nome: `Mercado ${paises.join(" ")}`,
          paises,
          moeda: "EUR",
          linguas: ["pt"],
          lingua_principal: "pt",
        });
        if (activo) {
          // Sem lista de preços: activa-se à mão, só neste teste.
          await base.dono.transaction().execute(async (trx) => {
            await sql`alter table mercado disable trigger all`.execute(trx);
            await sql`update mercado set estado = 'activo' where id = ${m}::uuid`.execute(
              trx,
            );
            await sql`alter table mercado enable trigger all`.execute(trx);
          });
        }
        return m;
      };
      const es = await mercado(entidade, "", ["ES"], true);
      await mercado(entidade, "", ["IT"], false);
      // Outra entidade do mesmo comerciante, com um mercado em França.
      const outra = await criarEntidadeLegal(base.api, a, {
        denominacao: "Outra Loja, Lda",
        forma_juridica: "sociedade_por_quotas",
        pais: "PT",
        numero_fiscal: "503504564",
        morada_linha: "Rua de Teste, 2",
        morada_codigo_postal: "1000-002",
        morada_localidade: "Lisboa",
      });
      await mercado(outra, "Loja da outra", ["FR"], true);
      // Um método de pagamento activo no mercado de Espanha (posto à mão,
      // sem conta de pagamentos: só a ligação ao mercado conta aqui).
      await base.dono.transaction().execute(async (trx) => {
        await sql`alter table metodo_pagamento disable trigger all`.execute(
          trx,
        );
        await sql`insert into metodo_pagamento
          (comerciante_id, loja_id, mercado_id, metodo, conta_id, prazo_minutos)
          values (${a}::uuid, ${loja}::uuid, ${es}::uuid, 'multibanco',
            ${randomUUID()}::uuid, 60)`.execute(trx);
        await sql`alter table metodo_pagamento enable trigger all`.execute(trx);
      });
      const r = await ok(como("dono", "GET", url("/issuer-options")));
      const n = r["necessario"] as {
        taxas: { pais: string; taxa: number }[];
        meios: string[];
      };
      expect(n.taxas.filter((t) => t.pais === "ES")).toEqual([
        { pais: "ES", taxa: 2100 },
      ]);
      expect(n.taxas.some((t) => t.pais === "FR" || t.pais === "IT")).toBe(
        false,
      );
      // As regiões de Portugal (Açores, Madeira) também são pares.
      expect(n.taxas.filter((t) => t.pais === "PT")).toEqual([
        { pais: "PT", taxa: 2300 },
        { pais: "PT", taxa: 2200 },
        { pais: "PT", taxa: 1600 },
      ]);
      expect(n.meios).toEqual(["multibanco"]);
      // E o ecrã Faturação diz o mesmo, sem ler o Moloni.
      const l = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      ).find((x) => x["id"] === `isx_${ligacao}`);
      expect((l?.["faltam"] as Json)["meios"]).toEqual(["multibanco"]);
      expect((l?.["faltam"] as Json)["taxas"]).toContainEqual({
        pais: "ES",
        taxa: 2100,
      });
    });

    it("uma entidade que emite pelo sistema próprio não ganha uma ligação ao Moloni (P3-12)", async () => {
      const propria = await criarEntidadeLegal(base.api, a, {
        denominacao: "Sistema Próprio, Lda",
        forma_juridica: "sociedade_por_quotas",
        pais: "PT",
        numero_fiscal: "505959255",
        morada_linha: "Rua de Teste, 3",
        morada_codigo_postal: "1000-003",
        morada_localidade: "Lisboa",
      });
      await sql`update entidade_legal set emissor_fiscal = 'sistema_proprio'
        where id = ${propria}::uuid`.execute(base.dono);
      expect(
        await codigo(
          como("dono", "POST", "/hub/invoicing-connections", {
            entidade_legal: `lgl_${propria}`,
          }),
        ),
      ).toEqual([409, "invoices.other_issuer"]);
    });

    it("o Moloni recusa ou não responde: issuer_error, e a ligação não muda", async () => {
      const antes = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      )[0];
      moloni.estado.falhas.recusar = new Set(["taxes/getAll"]);
      try {
        expect(
          await codigo(como("dono", "GET", url("/issuer-options"))),
        ).toEqual([502, "invoices.issuer_error"]);
        expect(
          await codigo(
            como("dono", "PATCH", url(), {
              versao: Number(antes?.["versao"]),
              serie: "77",
            }),
          ),
        ).toEqual([502, "invoices.issuer_error"]);
      } finally {
        moloni.estado.falhas.recusar = new Set();
      }
      const depois = (
        (await ok(como("dono", "GET", "/hub/invoicing")))["ligacoes"] as Json[]
      )[0];
      expect(depois).toMatchObject({
        estado: antes?.["estado"],
        versao: antes?.["versao"],
      });
    });

    it("com documentos a meio no emissor, gravar é recusado (R15)", async () => {
      const versao = Number(
        (
          (await ok(como("dono", "GET", url("/issuer-options"))))[
            "ligacao"
          ] as Json
        )["versao"],
      );
      // Um documento em rascunho nesta ligação, posto à mão (sem encomenda:
      // os gatilhos e as chaves estrangeiras desligados só dentro desta
      // transacção do teste, e ligados outra vez antes de ela acabar).
      const doc = randomUUID();
      const semGatilhos = (q: ReturnType<typeof sql>) =>
        base.dono.transaction().execute(async (trx) => {
          await sql`alter table documento_fiscal disable trigger all`.execute(
            trx,
          );
          await q.execute(trx);
          await sql`alter table documento_fiscal enable trigger all`.execute(
            trx,
          );
        });
      await semGatilhos(sql`insert into documento_fiscal
        (id, comerciante_id, encomenda_id, entidade_legal_id, modo, estado, ligacao_id)
        values (${doc}::uuid, ${a}::uuid, ${randomUUID()}::uuid, ${entidade}::uuid,
          'teste', 'rascunho', ${ligacao}::uuid)`);
      try {
        expect(
          // Uma mudança a sério: pôr outra vez o mapa da isenção M16.
          await codigo(
            como("dono", "PATCH", url(), {
              versao,
              isencoes: [{ codigo: "M16", emissor: "M16" }],
            }),
          ),
        ).toEqual([409, "invoices.issuer_busy"]);
      } finally {
        await semGatilhos(
          sql`delete from documento_fiscal where id = ${doc}::uuid`,
        );
      }
    });
  },
);

// «O que falta» e a retenção usam a mesma chave (§31.7): um par que falta
// retém a fatura (`taxa_sem_mapa`); um par mapeado não.
describe("o que falta bate com a retenção", () => {
  const linha = (o: Partial<LinhaDoConteudo>): LinhaDoConteudo => ({
    posicao: 1,
    sku: "GEL-001",
    descricao: "Gel UV",
    quantidade: 1,
    base: 1000,
    iva: 230,
    total: 1230,
    resultado: "tributada",
    pais_imposto: "PT",
    taxa: 2300,
    codigo_motivo: null,
    regra: "nacional",
    verificado: true,
    vies_prova: null,
    isencao: null,
    ...o,
  });
  const conteudo = (l: LinhaDoConteudo): Conteudo => ({
    formato: 1,
    encomenda: "ord_x",
    entidade_legal: { id: "lgl_x", pais: "PT" },
    cliente: {
      tipo: "particular",
      nome: "Rui",
      nif: null,
      nif_numero: null,
      nif_escrito: null,
      pais_contribuinte: null,
      morada: {},
    },
    moeda: "EUR",
    preco_inclui_iva: true,
    linhas: [l],
    totais: { base: l.base, iva: l.iva, total: l.total },
    meio_pagamento: "mb_way",
    destino: "PT",
    carimbo: "destino PT",
  });

  it("cada par ou código em falta retém; cada um mapeado não", () => {
    const necessario = {
      taxas: [
        { pais: "PT", taxa: 2300 },
        { pais: "PT", taxa: 600 },
      ],
      isencoes: [{ pais: "PT", codigo: "M16" }],
      meios: ["mb_way"],
    };
    const ligacao = {
      taxas: [{ pais: "PT", taxa: 2300, emissor: "11" }],
      isencoes: [],
      config: {},
    };
    const falta = faltaNaLigacao(necessario, ligacao);
    expect(falta).toEqual({
      taxas: [{ pais: "PT", taxa: 600 }],
      isencoes: [{ pais: "PT", codigo: "M16" }],
      meios: ["mb_way"],
    });
    for (const t of necessario.taxas) {
      const motivos = motivosDoConteudo(
        conteudo(linha({ taxa: t.taxa, iva: 0, total: 1000 })),
        ligacao,
        "teste",
      );
      expect(motivos.includes("taxa_sem_mapa")).toBe(
        falta.taxas.some((f) => f.taxa === t.taxa),
      );
    }
    const isenta = motivosDoConteudo(
      conteudo(
        linha({
          resultado: "isenta",
          taxa: 0,
          iva: 0,
          total: 1000,
          codigo_motivo: "M16",
          regra: "isencao_manual",
          isencao: "x",
        }),
      ),
      ligacao,
      "teste",
    );
    expect(isenta).toContain("isencao_sem_mapa");
  });
});

// As leituras do Hub nunca gastam o limite das emissões (revisão do #412,
// P2-4): com 12 por minuto, as listas (8 pedidos) passam uma vez; a segunda
// recusa logo, sem esperar, e uma chamada da emissão ainda passa.
describe("o limite de pedidos ao Moloni", () => {
  it("as leituras do Hub param a dois terços e não esperam; o resto fica para as emissões", async () => {
    const m = moloniFalso();
    const a = new AdaptadorMoloni({
      clientId: "dev-eurolify",
      clientSecret: "segredo-do-developer",
      empresasPermitidas: [String(m.empresa)],
      fetch: m.fetch,
      porMinuto: 12,
    });
    const cred = m.credenciais();
    await a.listas(cred);
    const antes = Date.now();
    await expect(a.listas(cred)).rejects.toThrow(/limite de pedidos/);
    expect(Date.now() - antes).toBeLessThan(1000);
    await expect(a.testar(cred)).resolves.toBeUndefined();
  });
});
