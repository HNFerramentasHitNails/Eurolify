import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { verificarAssinatura } from "../src/webhooks/assinatura.js";
import type { Emissor, PedidoDeEnvio } from "../src/webhooks/emissor.js";
import {
  correrWebhooks,
  ESPERAS_MINUTOS,
} from "../src/webhooks/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os webhooks de saída pela API (docs/38; migrações 0107 e 0108): as
// subscrições, a distribuição dos eventos da outbox, a assinatura, o recuo,
// a desistência, o reenvio e o isolamento entre comerciantes. A rede é
// trocada por um emissor falso; o resto é verdadeiro.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("webhooks de saída", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  const chave = chavePagamentos(randomBytes(32).toString("base64"), "1");
  // O emissor falso: guarda o que recebeu e responde pelo guião.
  const enviados: PedidoDeEnvio[] = [];
  let guiao: ({ estado: number } | { erro: string } | "lanca")[] = [];
  const emissor: Emissor = (p) => {
    enviados.push(p);
    const r = guiao.shift() ?? { estado: 200 };
    if (r === "lanca") return Promise.reject(new Error("rebentou"));
    return Promise.resolve(r);
  };
  const cfg = { chave, emissor };
  // A base é partilhada pelos testes: cada um só corre os seus comerciantes.
  let ativos: string[] = [];
  beforeEach(() => {
    ativos = [];
  });
  const voltaDoPublicador = (extra: { agora?: () => Date } = {}) =>
    correrWebhooks(base.api, cfg, { comerciantes: ativos, ...extra });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      undefined,
      undefined,
      undefined,
      cfg,
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  const pedir = (
    segredo: string,
    metodo: "POST" | "GET" | "PATCH",
    url: string,
    corpo?: unknown,
    chaveIdem: string = randomUUID(),
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": chaveIdem }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  type Resposta = Awaited<ReturnType<typeof pedir>>;
  const ok = (r: Resposta, estado = 200): Json => {
    expect(r.statusCode, r.body).toBe(estado);
    return r.json<Json>();
  };
  const codigo = (r: Resposta) => [
    r.statusCode,
    r.json<Json>()["codigo"] as string,
  ];

  /** Um comerciante com uma chave do dono e uma só de leitura. */
  async function comerciante() {
    const c = await registarComerciante(base.api, {
      nome: "Loja",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    ativos.push(c);
    const nova = async (ambitos: ("keys:write" | "merchant:read")[]) =>
      (
        await criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Teste",
          ambitos,
        })
      ).segredo;
    return {
      c,
      dono: await nova(["keys:write", "merchant:read"]),
      leitura: await nova(["merchant:read"]),
    };
  }

  /** Escreve um evento na outbox como os gatilhos (0021): o dono da base. */
  async function evento(
    c: string,
    tipo: string,
    dados: Json,
    agregado = randomUUID(),
  ) {
    const { rows } = await sql<{ id: string }>`
      insert into evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id, dados)
      values (${c}, ${tipo}, 'artigo', ${agregado}, ${JSON.stringify(dados)}::jsonb)
      returning id`.execute(base.dono);
    return rows[0]?.id ?? "";
  }
  const publicado = (id: string, dados: Json = {}) => ({
    artigo_id: randomUUID(),
    publicacao_id: randomUUID(),
    canal_id: randomUUID(),
    mercado_id: randomUUID(),
    quem: "pessoa:ana@example.com",
    em: "2026-10-16T12:00:00.000000Z",
    ...(id === "" ? {} : {}),
    ...dados,
  });

  const subscrever = async (
    k: string,
    eventos = ["product.published"],
    url = "https://alfa.example/hooks",
  ) => {
    const r = ok(
      await pedir(k, "POST", "/webhook-subscriptions", { url, eventos }),
      201,
    );
    return { id: r["id"] as string, segredo: r["segredo"] as string };
  };
  const entregas = async (k: string, extra = "") =>
    ok(await pedir(k, "GET", `/webhook-deliveries${extra}`))["dados"] as Json[];

  it("cria a subscrição: o segredo aparece uma vez e nunca fica em claro na base", async () => {
    const a = await comerciante();
    const idem = randomUUID();
    const r = await pedir(
      a.dono,
      "POST",
      "/webhook-subscriptions",
      {
        url: "https://alfa.example/hooks",
        eventos: ["product.published", "price.changed"],
      },
      idem,
    );
    const corpo = ok(r, 201);
    expect(corpo["segredo"]).toMatch(/^whsec_/);
    expect(corpo["id"]).toMatch(/^whk_/);
    expect(corpo["estado"]).toBe("activa");
    // Repetir o pedido não mostra o segredo outra vez.
    const repetido = await pedir(
      a.dono,
      "POST",
      "/webhook-subscriptions",
      {
        url: "https://alfa.example/hooks",
        eventos: ["product.published", "price.changed"],
      },
      idem,
    );
    expect(codigo(repetido)).toEqual([409, "idempotency.secret_not_repeated"]);
    expect(repetido.body).not.toContain(corpo["segredo"] as string);
    // A lista e a leitura não o trazem.
    const lista = await pedir(a.leitura, "GET", "/webhook-subscriptions");
    expect(lista.body).not.toContain(corpo["segredo"] as string);
    expect(ok(lista)["dados"]).toHaveLength(1);
    // Na base, só a cifra (nem o segredo, nem o que a respostas guardadas têm).
    const { rows } = await sql<{ t: string }>`
      select (s::text) as t from webhook_subscricao s where s.comerciante_id = ${a.c}`.execute(
      base.dono,
    );
    const { rows: guardadas } = await sql<{ t: string }>`
      select (i::text) as t from idempotencia i`.execute(base.dono);
    const segredoEmHex = Buffer.from(corpo["segredo"] as string).toString(
      "hex",
    );
    for (const { t } of [...rows, ...guardadas]) {
      expect(t).not.toContain(corpo["segredo"] as string);
      expect(t).not.toContain(segredoEmHex);
    }
  });

  it("recusa endereços que levariam o Eurolify à rede interna, e tipos desconhecidos", async () => {
    const a = await comerciante();
    for (const url of [
      "http://alfa.example/h",
      "https://localhost/h",
      "https://169.254.169.254/latest",
      "https://10.0.0.5/h",
      "https://alfa.example:8443/h",
    ]) {
      const r = await pedir(a.dono, "POST", "/webhook-subscriptions", {
        url,
        eventos: ["product.published"],
      });
      expect(codigo(r), url).toEqual([422, "webhooks.url_invalid"]);
    }
    const tipo = await pedir(a.dono, "POST", "/webhook-subscriptions", {
      url: "https://alfa.example/h",
      eventos: ["customer.created"],
    });
    expect(tipo.statusCode).toBe(400);
    const lista = await pedir(a.dono, "GET", "/webhook-subscriptions");
    expect(ok(lista)["dados"]).toHaveLength(0);
  });

  it("só quem tem keys:write cria, muda ou reenvia", async () => {
    const a = await comerciante();
    const corpo = {
      url: "https://alfa.example/h",
      eventos: ["product.published"],
    };
    expect(
      (await pedir(a.leitura, "POST", "/webhook-subscriptions", corpo))
        .statusCode,
    ).toBe(403);
    const s = await subscrever(a.dono);
    const alvo = `/webhook-subscriptions/${s.id}`;
    expect(
      (await pedir(a.leitura, "PATCH", alvo, { versao: 1, estado: "pausada" }))
        .statusCode,
    ).toBe(403);
    expect((await pedir(a.leitura, "GET", alvo)).statusCode).toBe(200);
  });

  it("isolamento: outro comerciante não vê, não muda, não reenvia nem recebe", async () => {
    const a = await comerciante();
    const b = await comerciante();
    const sa = await subscrever(a.dono);
    // O B subscreve o mesmo tipo noutro endereço: os eventos do A não lhe chegam.
    await subscrever(
      b.dono,
      ["product.published"],
      "https://beta.example/hooks",
    );
    const ev = await evento(a.c, "product.published", publicado(""));
    guiao = [];
    enviados.length = 0;
    await voltaDoPublicador();
    expect(enviados.map((e) => e.url)).toEqual(["https://alfa.example/hooks"]);
    expect(await entregas(b.dono)).toEqual([]);
    const deA = await entregas(a.dono);
    expect(deA).toHaveLength(1);
    const entrega = deA[0]?.["id"] as string;
    // Pelo API do B, o que é do A não existe.
    expect(
      (await pedir(b.dono, "GET", `/webhook-subscriptions/${sa.id}`))
        .statusCode,
    ).toBe(404);
    expect(
      codigo(
        await pedir(b.dono, "PATCH", `/webhook-subscriptions/${sa.id}`, {
          versao: 1,
          estado: "pausada",
        }),
      ),
    ).toEqual([404, "webhooks.not_found"]);
    expect(
      codigo(
        await pedir(b.dono, "POST", `/webhook-deliveries/${entrega}/resend`),
      ),
    ).toEqual([404, "webhooks.not_found"]);
    expect(await entregas(b.dono, `?subscricao=${sa.id}`)).toEqual([]);
    // Na base, com a ligação do B: nem as linhas, nem o evento, nem as funções.
    await comComerciante(base.api, b.c, async (trx) => {
      const s = await trx
        .selectFrom("webhook_subscricao")
        .select("id")
        .execute();
      expect(s.map((x) => x.id)).not.toContain(sa.id.slice(4));
      expect(
        await trx
          .selectFrom("webhook_entrega")
          .select("id")
          .where("subscricao_id", "=", sa.id.slice(4))
          .execute(),
      ).toEqual([]);
      const { rows } =
        await sql`select * from webhook_evento_da_entrega(${entrega.slice(4)}::uuid)`.execute(
          trx,
        );
      expect(rows).toEqual([]);
    });
    // O evento do A distribui-se só com o A; com o contexto do B não se toca.
    const { rows } = await sql<{ publicado_em: Date | null }>`
      select publicado_em from evento_saida where id = ${ev}`.execute(
      base.dono,
    );
    expect(rows[0]?.publicado_em).not.toBeNull();
  });

  it("entrega assinada: o corpo só leva o permitido e a assinatura confere com o segredo", async () => {
    const a = await comerciante();
    const s = await subscrever(a.dono, ["product.published"]);
    await evento(a.c, "product.published", publicado(""));
    // Um tipo que a subscrição não pediu não sai.
    await evento(a.c, "product.archived", { artigo_id: randomUUID() });
    guiao = [];
    enviados.length = 0;
    const antes = Date.now();
    const volta = await voltaDoPublicador();
    expect(volta).toMatchObject({ distribuidos: 2, entregues: 1, repetir: 0 });
    expect(enviados).toHaveLength(1);
    const e = enviados[0] as PedidoDeEnvio;
    const corpo = JSON.parse(e.corpo) as {
      id: string;
      tipo: string;
      dados: Json;
    };
    expect(corpo.tipo).toBe("product.published");
    expect(corpo.id).toMatch(/^evt_/);
    expect(e.corpo).not.toContain('"quem"');
    expect(e.corpo).not.toContain("ana@example.com");
    expect(corpo.dados["artigo_id"]).toMatch(/^prd_/);
    expect(e.cabecalhos["Eurolify-Event-Id"]).toBe(corpo.id);
    expect(e.cabecalhos["Eurolify-Delivery-Id"]).toMatch(/^whd_/);
    const cab = e.cabecalhos["Eurolify-Signature"] ?? "";
    expect(verificarAssinatura(s.segredo, e.corpo, cab, new Date())).toEqual({
      ok: true,
    });
    // Outro segredo, ou o corpo mexido, não passam.
    expect(verificarAssinatura("whsec_outro", e.corpo, cab).ok).toBe(false);
    expect(
      verificarAssinatura(s.segredo, e.corpo.replace("prd_", "prx_"), cab).ok,
    ).toBe(false);
    // Passados 10 minutos, o mesmo pedido capturado já não vale (repetição).
    expect(
      verificarAssinatura(
        s.segredo,
        e.corpo,
        cab,
        new Date(antes + 10 * 60_000),
      ),
    ).toEqual({ ok: false, motivo: "carimbo_fora_da_janela" });
    const [d] = await entregas(a.dono);
    expect(d).toMatchObject({
      estado: "entregue",
      tentativas: 1,
      ultimo_estado_http: 200,
      ultimo_erro: null,
    });
    // Uma segunda volta não reenvia o que já foi entregue.
    enviados.length = 0;
    await voltaDoPublicador();
    expect(enviados).toHaveLength(0);
  });

  it("só recebe os eventos escritos depois da subscrição, e não os de enquanto está pausada", async () => {
    const a = await comerciante();
    await evento(a.c, "product.published", publicado(""));
    await new Promise((r) => setTimeout(r, 5));
    const s = await subscrever(a.dono);
    enviados.length = 0;
    await voltaDoPublicador();
    expect(enviados).toHaveLength(0);
    const alvo = `/webhook-subscriptions/${s.id}`;
    ok(await pedir(a.dono, "PATCH", alvo, { versao: 1, estado: "pausada" }));
    await evento(a.c, "product.published", publicado(""));
    await voltaDoPublicador();
    expect(enviados).toHaveLength(0);
    ok(await pedir(a.dono, "PATCH", alvo, { versao: 2, estado: "activa" }));
    // O evento da pausa não volta; um novo chega.
    await evento(a.c, "product.published", publicado(""));
    await voltaDoPublicador();
    expect(enviados).toHaveLength(1);
    // Versão velha: conflito.
    expect(
      codigo(
        await pedir(a.dono, "PATCH", alvo, { versao: 1, estado: "pausada" }),
      ),
    ).toEqual([409, "webhooks.version_conflict"]);
  });

  it("falha, recuo exponencial, desistência no prazo e reenvio", async () => {
    const a = await comerciante();
    await subscrever(a.dono);
    await evento(a.c, "product.published", publicado(""));
    guiao = [];
    for (let i = 0; i < 20; i++) guiao.push({ estado: 500 });
    enviados.length = 0;
    let relogio = Date.now() + 5000;
    const agora = () => new Date(relogio);
    const assinaturas = new Set<string>();
    let desistida = false;
    let tentativas = 0;
    for (let i = 0; i < 30; i++) {
      await voltaDoPublicador({ agora });
      const [d] = await entregas(a.dono);
      if (enviados.length > tentativas) {
        tentativas = enviados.length;
        assinaturas.add(
          enviados[enviados.length - 1]?.cabecalhos["Eurolify-Signature"] ?? "",
        );
      }
      if (d?.["estado"] === "desistida") {
        desistida = true;
        break;
      }
      expect(d).toMatchObject({
        estado: "pendente",
        ultimo_estado_http: 500,
        ultimo_erro: "webhooks.http_status",
      });
      relogio = new Date(d?.["proxima_em"] as string).getTime();
    }
    expect(desistida).toBe(true);
    // Uma tentativa inicial e uma por cada espera do recuo.
    expect(enviados).toHaveLength(ESPERAS_MINUTOS.length + 1);
    // A última tentativa caiu nas 72 h.
    const [d] = await entregas(a.dono);
    expect(d).toMatchObject({
      estado: "desistida",
      tentativas: ESPERAS_MINUTOS.length + 1,
    });
    expect(new Date(d?.["terminada_em"] as string).toISOString()).toBe(
      d?.["prazo_ate"],
    );
    // Cada tentativa assina com o carimbo do momento; o evento é sempre o mesmo.
    expect(assinaturas.size).toBe(enviados.length);
    expect(
      new Set(enviados.map((e) => e.cabecalhos["Eurolify-Event-Id"])).size,
    ).toBe(1);
    // Nada mais sai depois de desistir.
    enviados.length = 0;
    relogio += 10 * 24 * 3_600_000;
    await voltaDoPublicador({ agora });
    expect(enviados).toHaveLength(0);
    // O botão de reenviar: volta a pendente, com o recuo de novo.
    guiao = [{ estado: 204 }];
    const id = d?.["id"] as string;
    const re = ok(
      await pedir(a.dono, "POST", `/webhook-deliveries/${id}/resend`),
    );
    expect(re).toMatchObject({
      estado: "pendente",
      tentativas: 0,
      reenvios: 1,
    });
    // Uma entrega pendente não se reenvia.
    expect(
      codigo(await pedir(a.dono, "POST", `/webhook-deliveries/${id}/resend`)),
    ).toEqual([409, "webhooks.not_resendable"]);
    await voltaDoPublicador();
    expect(enviados).toHaveLength(1);
    expect((await entregas(a.dono))[0]).toMatchObject({
      estado: "entregue",
      reenvios: 1,
    });
  });

  it("um erro de ligação, um tempo esgotado ou um emissor que rebenta contam como falha, sem parar a volta", async () => {
    const a = await comerciante();
    const b = await comerciante();
    await subscrever(a.dono);
    await subscrever(b.dono);
    await evento(a.c, "product.published", publicado(""));
    await evento(b.c, "product.published", publicado(""));
    guiao = ["lanca", { erro: "webhooks.timeout" }];
    enviados.length = 0;
    const v = await voltaDoPublicador();
    expect(enviados).toHaveLength(2);
    expect(v.erros).toEqual([]);
    const erros = [
      ...(await entregas(a.dono)),
      ...(await entregas(b.dono)),
    ].map((d) => d["ultimo_erro"]);
    expect(erros.sort()).toEqual(["webhooks.internal", "webhooks.timeout"]);
  });

  it("desactivar cancela o que está por enviar e é definitivo; a subscrição não se apaga", async () => {
    const a = await comerciante();
    const s = await subscrever(a.dono);
    await evento(a.c, "product.published", publicado(""));
    guiao = [{ estado: 500 }];
    await voltaDoPublicador();
    const alvo = `/webhook-subscriptions/${s.id}`;
    ok(
      await pedir(a.dono, "PATCH", alvo, { versao: 1, estado: "desactivada" }),
    );
    enviados.length = 0;
    const v = await voltaDoPublicador({
      agora: () => new Date(Date.now() + 3_600_000),
    });
    expect(enviados).toHaveLength(0);
    // Desactivar já as cancelou (P3-3): a volta não tem nada a cancelar.
    expect(v.canceladas).toBe(0);
    expect((await entregas(a.dono))[0]).toMatchObject({ estado: "cancelada" });
    expect(
      codigo(
        await pedir(a.dono, "PATCH", alvo, { versao: 2, estado: "activa" }),
      ),
    ).toEqual([409, "webhooks.invalid_transition"]);
    await expect(
      sql`delete from webhook_subscricao where id = ${s.id.slice(4)}`.execute(
        base.dono,
      ),
    ).rejects.toThrow(/webhooks\.immutable/);
    // Reenviar uma entrega de uma subscrição desactivada também não.
    const id = (await entregas(a.dono))[0]?.["id"] as string;
    expect(
      codigo(await pedir(a.dono, "POST", `/webhook-deliveries/${id}/resend`)),
    ).toEqual([409, "webhooks.not_resendable"]);
  });

  it("o endereço muda por PATCH com as mesmas regras", async () => {
    const a = await comerciante();
    const s = await subscrever(a.dono);
    const alvo = `/webhook-subscriptions/${s.id}`;
    expect(
      codigo(
        await pedir(a.dono, "PATCH", alvo, {
          versao: 1,
          url: "https://127.0.0.1/x",
        }),
      ),
    ).toEqual([422, "webhooks.url_invalid"]);
    expect(
      ok(
        await pedir(a.dono, "PATCH", alvo, {
          versao: 1,
          url: "https://gama.example/x",
          eventos: ["price.changed"],
        }),
      ),
    ).toMatchObject({
      url: "https://gama.example/x",
      eventos: ["price.changed"],
      versao: 2,
    });
  });

  it("a API não lê a outbox nem cria entregas à mão", async () => {
    const a = await comerciante();
    await expect(
      comComerciante(base.api, a.c, (trx) =>
        trx
          .selectFrom("webhook_entrega")
          .select("id")
          .execute()
          .then(() => sql`select * from evento_saida`.execute(trx)),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      comComerciante(base.api, a.c, (trx) =>
        sql`insert into webhook_entrega (comerciante_id, subscricao_id, evento_id, proxima_em, prazo_ate)
            values (${a.c}, ${randomUUID()}, ${randomUUID()}, now(), now())`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("o catálogo de eventos diz os campos de cada tipo, sem o `quem`", async () => {
    const a = await comerciante();
    const r = ok(await pedir(a.leitura, "GET", "/webhook-event-types"));
    const tipos = r["dados"] as { tipo: string; campos: string[] }[];
    expect(tipos.map((t) => t.tipo)).toContain("price.changed");
    expect(JSON.stringify(tipos)).not.toContain('"quem"');
  });

  it("revisão do #477, P2-1: um resultado atrasado não escreve por cima de outra volta", async () => {
    const a = await comerciante();
    const s = await subscrever(a.dono);
    await evento(a.c, "product.published", publicado(""));
    // Durante o envio, outra volta entrega a mesma entrega.
    const concorrente: Emissor = async () => {
      await sql`update webhook_entrega set estado = 'entregue', tentativas = 1,
        terminada_em = now() where subscricao_id = ${s.id.slice(4)}`.execute(
        base.dono,
      );
      return { estado: 500 };
    };
    const v = await correrWebhooks(
      base.api,
      { chave, emissor: concorrente },
      { comerciantes: ativos },
    );
    expect(v).toMatchObject({ repetir: 0, desistidas: 0, entregues: 0 });
    expect((await entregas(a.dono))[0]).toMatchObject({
      estado: "entregue",
      tentativas: 1,
      ultimo_erro: null,
      ultimo_estado_http: null,
    });
  });

  it("revisão do #477, P2-1: nem sobre uma tentativa de outra volta que falhou e deixou pendente", async () => {
    const a = await comerciante();
    const s = await subscrever(a.dono);
    await evento(a.c, "product.published", publicado(""));
    const concorrente: Emissor = async () => {
      await sql`update webhook_entrega set tentativas = 1, ultimo_erro = 'webhooks.timeout'
        where subscricao_id = ${s.id.slice(4)}`.execute(base.dono);
      return { estado: 500 };
    };
    const v = await correrWebhooks(
      base.api,
      { chave, emissor: concorrente },
      { comerciantes: ativos },
    );
    expect(v.repetir).toBe(0);
    expect((await entregas(a.dono))[0]).toMatchObject({
      estado: "pendente",
      tentativas: 1,
      ultimo_erro: "webhooks.timeout",
    });
  });

  it("revisão do #477, P2-2: só se distribuem os tipos do catálogo; os outros ficam por publicar", async () => {
    const a = await comerciante();
    await subscrever(a.dono);
    const fora = await evento(a.c, "order.placed", { ordem: 1 });
    const dentro = await evento(a.c, "product.published", publicado(""));
    await voltaDoPublicador();
    const { rows } = await sql<{ id: string; publicado: boolean }>`
      select id, publicado_em is not null as publicado from evento_saida
      where id in (${fora}, ${dentro})`.execute(base.dono);
    expect(rows.find((r) => r.id === fora)?.publicado).toBe(false);
    expect(rows.find((r) => r.id === dentro)?.publicado).toBe(true);
  });

  it("revisão do #477, P2-4: na troca da chave a anterior decifra; sem ela não se gasta tentativa", async () => {
    const a = await comerciante();
    await subscrever(a.dono);
    await evento(a.c, "product.published", publicado(""));
    const nova = chavePagamentos(randomBytes(32).toString("base64"), "2");
    enviados.length = 0;
    guiao = [];
    // Só a chave nova: a subscrição foi cifrada com a «1», não se envia, a
    // entrega espera e fica com 0 tentativas.
    const sem = await correrWebhooks(
      base.api,
      { chave: nova, emissor },
      { comerciantes: ativos },
    );
    expect(sem).toMatchObject({ repetir: 1, desistidas: 0 });
    expect(enviados).toHaveLength(0);
    expect((await entregas(a.dono))[0]).toMatchObject({
      estado: "pendente",
      tentativas: 0,
      ultimo_erro: "webhooks.key_unavailable",
    });
    // Com a anterior para decifrar, na volta seguinte entrega-se.
    const com = await correrWebhooks(
      base.api,
      { chave: nova, chaveAnterior: chave, emissor },
      { comerciantes: ativos, agora: () => new Date(Date.now() + 3_600_000) },
    );
    expect(com).toMatchObject({ entregues: 1 });
    expect(enviados).toHaveLength(1);
    // Uma subscrição nova cifra com a chave actual (a anterior nunca cifra).
    const app2 = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      undefined,
      undefined,
      undefined,
      { chave: nova, chaveAnterior: chave, emissor },
    );
    const r = await app2.inject({
      method: "POST",
      url: "/webhook-subscriptions",
      headers: {
        authorization: `Bearer ${a.dono}`,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        url: "https://alfa.example/h2",
        eventos: ["price.changed"],
      }),
    });
    expect(r.statusCode, r.body).toBe(201);
    await app2.close();
    const { rows } = await sql<{ chave_versao: string }>`
      select chave_versao from webhook_subscricao where comerciante_id = ${a.c}
      order by criada_em`.execute(base.dono);
    expect(rows.map((x) => x.chave_versao)).toEqual(["1", "2"]);
  });

  it("revisão do #477, P3-4: o limite de subscrições aguenta pedidos ao mesmo tempo", async () => {
    const a = await comerciante();
    const respostas = await Promise.all(
      Array.from({ length: 26 }, (_v, i) =>
        pedir(a.dono, "POST", "/webhook-subscriptions", {
          url: `https://alfa.example/h${String(i)}`,
          eventos: ["product.published"],
        }),
      ),
    );
    const estados = respostas.map((r) => r.statusCode).sort();
    expect(estados.filter((e) => e === 201)).toHaveLength(20);
    expect(estados.filter((e) => e === 409)).toHaveLength(6);
    expect(
      ok(await pedir(a.dono, "GET", "/webhook-subscriptions"))["dados"],
    ).toHaveLength(20);
  });

  it("revisão do #477, P3-8: uma entrega sem evento desiste com o código e não repete", async () => {
    const a = await comerciante();
    const s = await subscrever(a.dono);
    await sql`insert into webhook_entrega (comerciante_id, subscricao_id, evento_id, proxima_em, prazo_ate)
      values (${a.c}, ${s.id.slice(4)}, ${randomUUID()}, now() - interval '1 minute',
              now() + interval '72 hours')`.execute(base.dono);
    enviados.length = 0;
    const v = await voltaDoPublicador();
    expect(v).toMatchObject({ desistidas: 1, repetir: 0 });
    expect(v.erros).toEqual([]);
    expect(enviados).toHaveLength(0);
    expect((await entregas(a.dono))[0]).toMatchObject({
      estado: "desistida",
      ultimo_erro: "webhooks.event_missing",
    });
    expect((await voltaDoPublicador()).desistidas).toBe(0);
  });

  it("revisão do #477, P1-1: o tecto de tempo por comerciante deixa o resto para a volta seguinte", async () => {
    const a = await comerciante();
    await subscrever(a.dono);
    for (let i = 0; i < 3; i++) {
      await evento(a.c, "product.published", publicado(""));
    }
    const lento: Emissor = async (p) => {
      await new Promise((r) => setTimeout(r, 80));
      return emissor(p);
    };
    enviados.length = 0;
    guiao = [];
    const v = await correrWebhooks(
      base.api,
      { chave, emissor: lento },
      { comerciantes: ativos, tectoMs: 40 },
    );
    expect(v.entregues).toBeGreaterThanOrEqual(1);
    expect(v.entregues).toBeLessThan(3);
    // O que ficou vence na volta seguinte.
    await voltaDoPublicador();
    expect(enviados).toHaveLength(3);
  });

  it("revisão do #477, P3-1: a função que dá o evento já não traz o `quem`", async () => {
    const a = await comerciante();
    await subscrever(a.dono);
    await evento(a.c, "product.published", publicado(""));
    await voltaDoPublicador();
    const id = ((await entregas(a.dono))[0]?.["id"] as string).slice(4);
    await comComerciante(base.api, a.c, async (trx) => {
      const { rows } = await sql<{ dados: Json }>`
        select dados from webhook_evento_da_entrega(${id}::uuid)`.execute(trx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dados).not.toHaveProperty("quem");
      expect(rows[0]?.dados).toHaveProperty("artigo_id");
    });
  });

  it("sem a chave dos segredos não se cria subscrição (503)", async () => {
    const sem = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
    );
    const a = await comerciante();
    const r = await sem.inject({
      method: "POST",
      url: "/webhook-subscriptions",
      headers: {
        authorization: `Bearer ${a.dono}`,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        url: "https://alfa.example/h",
        eventos: ["product.published"],
      }),
    });
    expect(codigo(r)).toEqual([503, "webhooks.not_configured"]);
    await sem.close();
  });
});
