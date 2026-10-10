import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { gerarChave } from "../src/identidade/chaves.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// O rasto de auditoria comum, passo 4, parte 1 (docs/28 §3.3 e §4; migração
// 0057; #322): a marca «chave de um agente de IA». O que essa chave faz fica
// com a IA «declarado», mesmo sem o cabeçalho Eurolify-IA.

const NOVO = { nome: "Loja Agente", lingua: "pt", fuso: "Europe/Lisbon" };

interface ChaveCriada {
  id: string;
  segredo: string;
  agente_ia: boolean;
}

describe.skipIf(URL_BASE === undefined)(
  "rasto: a chave de um agente de IA (0057)",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let a: string;
    let gestora: string;
    let loja: string;

    const pedir = (
      metodo: "GET" | "POST",
      url: string,
      segredo: string,
      corpo?: unknown,
      extra: Record<string, string> = {},
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(corpo === undefined
            ? {}
            : {
                "content-type": "application/json",
                "idempotency-key": randomUUID(),
              }),
          ...extra,
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });

    const criarPelaApi = async (segredo: string, corpo: unknown) => {
      const r = await pedir("POST", "/keys", segredo, corpo);
      expect(r.statusCode, r.body).toBe(201);
      return r.json<ChaveCriada>();
    };

    /** Cria um artigo com a chave e devolve a IA das linhas do rasto. */
    async function iaDeUmArtigo(
      segredo: string,
      extra: Record<string, string> = {},
    ): Promise<unknown[]> {
      const sku = `AG-${randomUUID().slice(0, 8)}`;
      const r = await pedir(
        "POST",
        "/products",
        segredo,
        {
          tipo: "fisico",
          nome: "Verniz",
          categoria_fiscal: "normal",
          variantes: [{ sku, unidade_de_venda: "unidade", peso_g: 15 }],
        },
        extra,
      );
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json<{ id: string }>().id.replace(/^prd_/, "");
      const { rows } = await sql<{ ia: unknown; autorizado_por: unknown }>`
        select ia, autorizado_por from alteracao_catalogo
        where artigo_id = ${id}::uuid`.execute(base.dono);
      expect(rows.length).toBeGreaterThan(0);
      // §3.2: uma chave nunca autoriza, seja ou não de um agente.
      for (const l of rows) expect(l.autorizado_por).toBeNull();
      return rows.map((l) => l.ia);
    }

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      app = criarApp({ logger: false }, undefined, base.api);
      await app.ready();
      a = await registarComerciante(base.api, NOVO);
      gestora = (
        await criarChave(base.dono, a, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Gestora",
          ambitos: ["catalog:read", "catalog:write", "keys:write"],
        })
      ).segredo;
      const entidade = await criarEntidadeLegal(base.api, a, {
        denominacao: "Exemplo, Lda.",
        forma_juridica: "sociedade por quotas",
        pais: "PT",
        numero_fiscal: "123456789",
        morada_linha: "Rua de Teste, 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });
      loja = await criarLoja(base.api, a, {
        entidade_legal_id: entidade,
        nome: "Portugal",
      });
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("cria-se pela API marcada; a lista e o /me dizem-no; por omissão, não é", async () => {
      const agente = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Agente dos preços",
        ambitos: ["catalog:read", "catalog:write"],
        agente_ia: true,
      });
      expect(agente.agente_ia).toBe(true);
      const normal = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Software de gestão",
        ambitos: ["catalog:read"],
      });
      expect(normal.agente_ia).toBe(false);
      const lista = await pedir("GET", "/keys", gestora);
      const dados = lista.json<{ dados: ChaveCriada[] }>().dados;
      expect(dados.find((k) => k.id === agente.id)?.agente_ia).toBe(true);
      expect(dados.find((k) => k.id === normal.id)?.agente_ia).toBe(false);
      const eu = await pedir("GET", "/me", agente.segredo);
      expect(eu.json<{ chave: { agente_ia: boolean } }>().chave.agente_ia).toBe(
        true,
      );
    });

    it("o que a chave de um agente faz fica com a IA declarado, mesmo sem cabeçalho", async () => {
      const agente = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Agente sem cabeçalho",
        ambitos: ["catalog:read", "catalog:write"],
        agente_ia: true,
      });
      for (const ia of await iaDeUmArtigo(agente.segredo)) {
        expect(ia).toEqual({ prova: "declarado" });
      }
    });

    it("com o cabeçalho, fica o que ele declara", async () => {
      const agente = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Agente com cabeçalho",
        ambitos: ["catalog:read", "catalog:write"],
        agente_ia: true,
      });
      const ias = await iaDeUmArtigo(agente.segredo, {
        "eurolify-ia": "fornecedor=mistral; modelo=m-1",
      });
      for (const ia of ias) {
        expect(ia).toEqual({
          fornecedor: "mistral",
          modelo: "m-1",
          prova: "declarado",
        });
      }
    });

    it("uma chave sem marca e sem cabeçalho deixa a IA vazia (desconhecido)", async () => {
      for (const ia of await iaDeUmArtigo(gestora)) expect(ia).toBeNull();
    });

    it("uma chave de um agente só cria chaves de um agente, mesmo pedindo falso", async () => {
      const agente = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Agente que cria chaves",
        ambitos: ["catalog:read", "keys:write"],
        agente_ia: true,
      });
      const semPedir = await criarPelaApi(agente.segredo, {
        tipo: "servidor",
        nome: "Filha",
        ambitos: ["catalog:read"],
      });
      expect(semPedir.agente_ia).toBe(true);
      const pedindoFalso = await criarPelaApi(agente.segredo, {
        tipo: "servidor",
        nome: "Filha 2",
        ambitos: ["catalog:read"],
        agente_ia: false,
      });
      expect(pedindoFalso.agente_ia).toBe(true);
    });

    it("só a chave de servidor: a pública com a marca é recusada, na rota e na base", async () => {
      const r = await pedir("POST", "/keys", gestora, {
        tipo: "publica",
        nome: "Montra",
        loja: `sto_${loja}`,
        agente_ia: true,
      });
      expect(r.statusCode, r.body).toBe(400);
      // Uma chave de um agente que pede uma pública, sem pedir a marca: a
      // marca passaria; a rota recusa e diz porquê (revisão, P3-3).
      const agente = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Agente da montra",
        ambitos: ["keys:write"],
        agente_ia: true,
      });
      const p = await pedir("POST", "/keys", agente.segredo, {
        tipo: "publica",
        nome: "Montra do agente",
        loja: `sto_${loja}`,
      });
      expect(p.statusCode, p.body).toBe(422);
      const erro = p.json<{ codigo: string; detail: string }>();
      expect(erro.codigo).toBe("key.agent_not_server");
      expect(p.body).toContain("não cria chaves públicas");
      // E a base recusa na mesma, chamada directamente (P3-4).
      const nova = gerarChave("publica");
      await expect(
        comComerciante(base.api, a, (trx) =>
          sql`select chave_criar_pela_api(${agente.segredo}, 'publica',
                ${loja}::uuid, 'Directa', null::text[], ${nova.prefixo},
                ${nova.resumo}, null::timestamptz)`.execute(trx),
        ),
      ).rejects.toThrow(/key\.agent_not_server/);
    });

    it("a marca não muda depois de criada, nem pelo dono da base; a tabela recusa uma pública marcada", async () => {
      const agente = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Agente fixo",
        ambitos: ["catalog:read"],
        agente_ia: true,
      });
      const id = agente.id.replace(/^key_/, "");
      await expect(
        sql`update chave_api set agente_ia = false where id = ${id}::uuid`.execute(
          base.dono,
        ),
      ).rejects.toThrow(/key\.immutable/);
      // Uma pública válida em tudo menos na marca: só a regra da 0057 a
      // recusa (revisão, P2-1).
      const nova = gerarChave("publica");
      await expect(
        sql`insert into chave_api (comerciante_id, tipo, loja_id, nome, ambitos,
              prefixo, resumo, criada_por, agente_ia)
            values (${a}::uuid, 'publica', ${loja}::uuid, 'x', array['storefront'],
              ${nova.prefixo}, ${nova.resumo}, 'teste', true)`.execute(
          base.dono,
        ),
      ).rejects.toThrow(/chave_api_agente_so_no_servidor/);
    });

    it("repetir uma revogação guardada antes da 0057 (sem a marca) devolve a marca a falso", async () => {
      const k = await criarPelaApi(gestora, {
        tipo: "servidor",
        nome: "Para revogar",
        ambitos: ["catalog:read"],
      });
      const idem = randomUUID();
      const url = `/keys/${k.id}/revoke`;
      const primeira = await pedir("POST", url, gestora, undefined, {
        "idempotency-key": idem,
      });
      expect(primeira.statusCode, primeira.body).toBe(200);
      // Como a API anterior a guardava: sem o campo.
      await sql`update idempotencia set resposta_corpo = resposta_corpo - 'agente_ia'
        where comerciante_id = ${a}::uuid and chave = ${idem}`.execute(
        base.dono,
      );
      const repetida = await pedir("POST", url, gestora, undefined, {
        "idempotency-key": idem,
      });
      expect(repetida.statusCode, repetida.body).toBe(200);
      expect(repetida.json<ChaveCriada>().agente_ia).toBe(false);
    });

    it("pelo Hub, o dono escolhe a marca; a lista diz-a; a pública marcada é recusada", async () => {
      const h = hubDeTeste(base);
      try {
        const d = await h.pessoaCom(a, "dono");
        const r = await h.pedir("POST", "/hub/keys", {
          sessao: d.sessao,
          comerciante: a,
          corpo: {
            tipo: "servidor",
            nome: "Agente do Hub",
            ambitos: ["catalog:read"],
            agente_ia: true,
          },
        });
        expect(r.statusCode, r.body).toBe(201);
        const marcada = r.json<ChaveCriada>();
        expect(marcada.agente_ia).toBe(true);
        const sem = await h.pedir("POST", "/hub/keys", {
          sessao: d.sessao,
          comerciante: a,
          corpo: {
            tipo: "servidor",
            nome: "Integração do Hub",
            ambitos: ["catalog:read"],
          },
        });
        expect(sem.json<ChaveCriada>().agente_ia).toBe(false);
        const lista = await h.pedir("GET", "/hub/keys", {
          sessao: d.sessao,
          comerciante: a,
        });
        const dados = lista.json<{ dados: ChaveCriada[] }>().dados;
        expect(dados.find((k) => k.id === marcada.id)?.agente_ia).toBe(true);
        const publica = await h.pedir("POST", "/hub/keys", {
          sessao: d.sessao,
          comerciante: a,
          corpo: {
            tipo: "publica",
            nome: "Montra do Hub",
            loja: `sto_${loja}`,
            agente_ia: true,
          },
        });
        expect(publica.statusCode, publica.body).toBe(400);
        // A base recusa na mesma, chamada directamente (P3-4).
        const nova = gerarChave("publica");
        await expect(
          comComerciante(base.api, a, (trx) =>
            sql`select chave_criar_pela_sessao(${d.sessao}, 'publica',
                  ${loja}::uuid, 'Directa', null::text[], ${nova.prefixo},
                  ${nova.resumo}, null::timestamptz, true)`.execute(trx),
          ),
        ).rejects.toThrow(/key\.agent_not_server/);
      } finally {
        await h.app.close();
      }
    });
  },
);
