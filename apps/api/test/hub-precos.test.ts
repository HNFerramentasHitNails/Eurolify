import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// Os preços do artigo (docs/22 §17; issue #249): GET /products/{id}/prices
// pela chave e GET /hub/products/{id}/prices pela sessão, com a mesma
// função: as listas activas, o mercado e os preços das variantes do artigo,
// com a redução em vigor e o preço por unidade. Contra o PostgreSQL 18.

const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

interface Preco {
  variante: string;
  montante: number;
  gratuito: boolean;
  reducao: { montante: number; preco_referencia: number } | null;
  preco_por_unidade: {
    valor: string;
    unidade: string;
    inclui_iva: boolean;
  } | null;
}
interface ListaComPrecos {
  lista: { id: string; nome: string; tipo: string; estado: string };
  mercado: {
    id: string;
    nome: string;
    estado: string;
    moeda: string;
    preco_inclui_iva: boolean;
  };
  precos: Preco[];
}
interface Pagina {
  dados: ListaComPrecos[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

describe.skipIf(URL_BASE === undefined)(
  "os preços do artigo no Hub (#249)",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
      h = hubDeTeste(base);
    });

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const comChave = (
      segredo: string,
      metodo: "GET" | "POST" | "PUT",
      url: string,
      corpo?: object,
    ) =>
      h.app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo !== "GET"
            ? {
                "idempotency-key": randomUUID(),
                "content-type": "application/json",
              }
            : {}),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });
    const ok = async (
      r: ReturnType<typeof comChave>,
      estado = 200,
    ): Promise<Record<string, unknown>> => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      return x.json();
    };

    /**
     * Um comerciante com: um mercado activo (a lista «Base PT», com IVA), um
     * mercado em rascunho com a lista dele, uma lista arquivada, um artigo
     * de duas variantes de 15 ml (uma com preço e redução, outra sem preço
     * na lista base) e outro artigo com preço na mesma lista.
     */
    async function comerciante(nome: string) {
      const c = await registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const entidade = await criarEntidadeLegal(base.api, c, ENTIDADE);
      const loja = `sto_${await criarLoja(base.api, c, { entidade_legal_id: entidade, nome: "Loja online" })}`;
      const chave = await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Tudo",
        ambitos: [
          "catalog:read",
          "catalog:write",
          "prices:read",
          "prices:write",
        ],
      });
      const s = chave.segredo;
      const mercado = await ok(
        comChave(s, "POST", "/markets", {
          loja,
          nome: "Portugal",
          paises: ["PT"],
          moeda: "EUR",
          linguas: ["pt"],
          lingua_principal: "pt",
        }),
        201,
      );
      const base1 = await ok(
        comChave(s, "POST", "/price-lists", {
          mercado: mercado["id"],
          nome: "Base PT",
          tipo: "base",
        }),
        201,
      );
      await ok(
        comChave(s, "POST", `/markets/${String(mercado["id"])}/activate`, {
          versao: mercado["versao"],
        }),
      );
      const rascunho = await ok(
        comChave(s, "POST", "/markets", {
          loja,
          nome: "Espanha",
          paises: ["ES"],
          moeda: "EUR",
          linguas: ["es"],
          lingua_principal: "es",
          preco_inclui_iva: false,
        }),
        201,
      );
      // A lista antiga é a base que existia antes; arquivada, dá lugar à
      // nova (uma base activa por mercado).
      const arquivada = await ok(
        comChave(s, "POST", "/price-lists", {
          mercado: rascunho["id"],
          nome: "Antiga ES",
          tipo: "base",
        }),
        201,
      );
      await ok(
        comChave(s, "POST", `/price-lists/${String(arquivada["id"])}/archive`, {
          versao: arquivada["versao"],
        }),
      );
      const base2 = await ok(
        comChave(s, "POST", "/price-lists", {
          mercado: rascunho["id"],
          nome: "Base ES",
          tipo: "base",
        }),
        201,
      );
      const sku1 = `P-${randomUUID()}`;
      const sku2 = `P-${randomUUID()}`;
      const artigo = await ok(
        comChave(s, "POST", "/products", {
          tipo: "fisico",
          nome: "Gel UV 15 ml",
          variantes: [
            {
              sku: sku1,
              unidade_de_venda: "unidade",
              conteudo_quantidade: 15,
              conteudo_unidade: "ml",
            },
            { sku: sku2, unidade_de_venda: "caixa" },
          ],
        }),
        201,
      );
      const variantes = artigo["variantes"] as { id: string; sku: string }[];
      const v1 = variantes.find((v) => v.sku === sku1)?.id ?? "";
      const v2 = variantes.find((v) => v.sku === sku2)?.id ?? "";
      const outro = await ok(
        comChave(s, "POST", "/products", {
          tipo: "fisico",
          nome: "Outro artigo",
          variantes: [
            { sku: `P-${randomUUID()}`, unidade_de_venda: "unidade" },
          ],
        }),
        201,
      );
      const vOutro = (outro["variantes"] as { id: string }[])[0]?.id ?? "";
      const l1 = String(base1["id"]);
      const l2 = String(base2["id"]);
      const la = String(arquivada["id"]);
      // A v1 a 9,90 € com 40 dias de história, depois reduzida para 7,90 €.
      await ok(
        comChave(s, "PUT", `/price-lists/${l1}/prices/${v1}`, {
          montante: 990,
        }),
      );
      await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
          trx,
        );
        await sql`insert into historico_preco (comerciante_id, lista_id, variante_id, montante,
                  gratuito, saiu, moeda, preco_inclui_iva, em_vigor_desde, definido_por)
                values (${c}, ${l1.slice(4)}, ${v1.slice(4)}, 990, false, false,
                  'EUR', true, now() - make_interval(hours => 960), 'teste:antes')`.execute(
          trx,
        );
      });
      await ok(
        comChave(s, "PUT", `/price-lists/${l1}/prices/${v1}/reduction`, {
          montante: 790,
        }),
      );
      // A v2 gratuita só na lista de Espanha; o outro artigo na Base PT.
      await ok(
        comChave(s, "PUT", `/price-lists/${l2}/prices/${v2}`, {
          montante: 0,
          gratuito: true,
        }),
      );
      await ok(
        comChave(s, "PUT", `/price-lists/${l1}/prices/${vOutro}`, {
          montante: 500,
        }),
      );
      return {
        id: c,
        segredo: s,
        artigo: String(artigo["id"]),
        v1: v1,
        v2: v2,
        l1,
        l2,
        la,
      };
    }

    it("dá as listas activas com o mercado e só os preços do artigo, iguais aos da lista; o Hub dá o mesmo", async () => {
      const c = await comerciante("Loja Preços");
      const pelaChave = await comChave(
        c.segredo,
        "GET",
        `/products/${c.artigo}/prices`,
      );
      expect(pelaChave.statusCode, pelaChave.body).toBe(200);
      const p = pelaChave.json<Pagina>();
      // Só as duas activas; a arquivada fica de fora.
      expect(p.total).toBe(2);
      expect(p.dados.map((l) => l.lista.id)).toEqual([c.l1, c.l2]);
      const [pt, es] = p.dados;
      expect(pt?.mercado).toMatchObject({
        nome: "Portugal",
        estado: "activo",
        moeda: "EUR",
        preco_inclui_iva: true,
      });
      expect(es?.mercado).toMatchObject({
        nome: "Espanha",
        estado: "rascunho",
        preco_inclui_iva: false,
      });
      // Só a v1 na Base PT (o outro artigo não aparece; a v2 não tem preço).
      expect(pt?.precos.map((x) => x.variante)).toEqual([c.v1]);
      expect(pt?.precos[0]).toMatchObject({
        montante: 990,
        reducao: { montante: 790, preco_referencia: 990 },
        preco_por_unidade: {
          valor: "526.6667",
          unidade: "l",
          inclui_iva: true,
        },
      });
      expect(es?.precos).toEqual([
        expect.objectContaining({
          variante: c.v2,
          montante: 0,
          gratuito: true,
          preco_por_unidade: null,
        }),
      ]);
      // O mesmo preço que a leitura da lista dá para a mesma variante.
      const daLista = await comChave(
        c.segredo,
        "GET",
        `/price-lists/${c.l1}/prices`,
      );
      const naLista = daLista
        .json<{ dados: Preco[] }>()
        .dados.find((x) => x.variante === c.v1);
      expect(pt?.precos[0]).toEqual(naLista);

      // O Hub dá o mesmo, a todos os papéis (prices:read), com no-store.
      for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
        const pessoa = await h.pessoaCom(c.id, papel);
        const r = await h.pedir("GET", `/hub/products/${c.artigo}/prices`, {
          sessao: pessoa.sessao,
          comerciante: c.id,
        });
        expect(r.statusCode, `${papel}: ${r.body}`).toBe(200);
        expect(r.headers["cache-control"]).toBe("private, no-store");
        expect(r.json()).toEqual(p);
      }
    });

    it("pagina as listas pelo cursor", async () => {
      const c = await comerciante("Loja Páginas");
      const primeira = await comChave(
        c.segredo,
        "GET",
        `/products/${c.artigo}/prices?limite=1`,
      );
      const um = primeira.json<Pagina>();
      expect(um.dados.map((l) => l.lista.id)).toEqual([c.l1]);
      expect(um.ha_mais).toBe(true);
      const segunda = await comChave(
        c.segredo,
        "GET",
        `/products/${c.artigo}/prices?limite=1&cursor=${um.cursor_seguinte ?? ""}`,
      );
      const dois = segunda.json<Pagina>();
      expect(dois.dados.map((l) => l.lista.id)).toEqual([c.l2]);
      expect(dois.ha_mais).toBe(false);
    });

    it("recusa o artigo de outro comerciante, a chave sem prices:read, o cabeçalho de outro comerciante, quem saiu e a sessão terminada", async () => {
      const c = await comerciante("Loja Recusas");
      const outro = await comerciante("Loja Alheia");
      const alheio = await comChave(
        c.segredo,
        "GET",
        `/products/${outro.artigo}/prices`,
      );
      expect(alheio.statusCode, alheio.body).toBe(404);
      const inexistente = await comChave(
        c.segredo,
        "GET",
        "/products/prd_00000000-0000-7000-8000-000000000000/prices",
      );
      expect(inexistente.statusCode).toBe(404);
      const soCatalogo = await criarChave(base.dono, c.id, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Só catálogo",
        ambitos: ["catalog:read"],
      });
      const semAmbito = await comChave(
        soCatalogo.segredo,
        "GET",
        `/products/${c.artigo}/prices`,
      );
      expect(semAmbito.statusCode).toBe(403);

      const dono = await h.pessoaCom(c.id, "dono");
      const noHub = await h.pedir(
        "GET",
        `/hub/products/${outro.artigo}/prices`,
        { sessao: dono.sessao, comerciante: c.id },
      );
      expect(noHub.statusCode, noHub.body).toBe(404);
      const cabecalho = await h.pedir(
        "GET",
        `/hub/products/${outro.artigo}/prices`,
        { sessao: dono.sessao, comerciante: outro.id },
      );
      expect(cabecalho.statusCode, cabecalho.body).toBe(403);
      const semSessao = await h.pedir(
        "GET",
        `/hub/products/${c.artigo}/prices`,
        { comerciante: c.id },
      );
      expect(semSessao.statusCode).toBe(401);
      const saiu = await h.pessoaCom(c.id, "gestor");
      await sql`update membro set ate = now(), terminado_por = 'operador:teste'
        where pessoa_id = ${saiu.pessoa}::uuid
          and comerciante_id = ${c.id}::uuid`.execute(base.dono);
      const depois = await h.pedir("GET", `/hub/products/${c.artigo}/prices`, {
        sessao: saiu.sessao,
        comerciante: c.id,
      });
      expect(depois.statusCode, depois.body).toBe(403);
      const fim = await h.pedir("POST", "/hub/session/end", {
        sessao: dono.sessao,
      });
      expect(fim.statusCode).toBe(200);
      const terminada = await h.pedir(
        "GET",
        `/hub/products/${c.artigo}/prices`,
        { sessao: dono.sessao, comerciante: c.id },
      );
      expect(terminada.statusCode).toBe(401);
    });

    it("o contrato tem os dois caminhos com a sua segurança e a mesma resposta", async () => {
      const r = await h.app.inject({ method: "GET", url: "/openapi.json" });
      const contrato = r.json<{
        paths: Record<
          string,
          Record<string, { security?: unknown; responses?: unknown }>
        >;
      }>();
      const doHub = contrato.paths["/hub/products/{id}/prices"]?.["get"];
      const daApi = contrato.paths["/products/{id}/prices"]?.["get"];
      expect(doHub?.security).toEqual([{ sessao: [] }]);
      expect(daApi?.security).toEqual([{ chave: [] }]);
      expect(JSON.stringify(doHub?.responses)).toBe(
        JSON.stringify(daApi?.responses),
      );
    });
  },
);
