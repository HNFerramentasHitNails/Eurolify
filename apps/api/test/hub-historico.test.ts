import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// O histórico do artigo no Hub (docs/22 §16; issue #239): a mesma função do
// GET /products/{id}/timeline, com o `autor` de cada entrada, decidido pela
// função fechada da base (0038). Só o dono e o gestor (catalog:history). A
// base é criada sem o «quem» por omissão: cada escrita põe o seu. Contra o
// PostgreSQL 18.

interface Autor {
  tipo: "pessoa" | "chave" | "sistema" | "outro";
  nome: string | null;
}
interface Entrada {
  id: string;
  quem: string;
  transacao: string;
  entidade: string;
  operacao: string;
  campos: Record<string, { antes: unknown; depois: unknown }>;
  autor?: Autor;
  autorizado_por?: string | null;
  autor_autorizou?: { nome: string | null } | null;
  autor_do_pedido?: { nome: string | null } | null;
}
interface Pagina {
  dados: Entrada[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

describe.skipIf(URL_BASE === undefined)(
  "o histórico do artigo no Hub (#239)",
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
      metodo: "GET" | "POST" | "PATCH",
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

    /** Um comerciante com uma chave («Escrita») e um artigo criado por ela. */
    async function comerciante(nome: string) {
      const c = await registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const chave = await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Escrita",
        ambitos: ["catalog:read", "catalog:write", "catalog:history"],
      });
      const r = await comChave(chave.segredo, "POST", "/products", {
        tipo: "fisico",
        nome: "Gel UV 15 ml",
        variantes: [{ sku: `H-${randomUUID()}`, unidade_de_venda: "unidade" }],
      });
      expect(r.statusCode, r.body).toBe(201);
      const artigo = r.json<{ id: string; versao: number }>();
      return { id: c, chave, artigo };
    }

    /** Muda o nome do artigo pelo Hub, na versão actual. */
    async function mudarNome(
      c: Awaited<ReturnType<typeof comerciante>>,
      sessao: string,
      nome: string,
    ) {
      const f = await h.pedir("GET", `/hub/products/${c.artigo.id}`, {
        sessao,
        comerciante: c.id,
      });
      expect(f.statusCode, f.body).toBe(200);
      const r = await h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
        sessao,
        comerciante: c.id,
        corpo: { versao: f.json<{ versao: number }>().versao, nome },
      });
      expect(r.statusCode, r.body).toBe(200);
    }

    /** Uma alteração escrita com um «quem» à escolha (como uma tarefa faria). */
    async function escreverComo(artigo: string, quem: string, nome: string) {
      await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(
          trx,
        );
        await sql`update artigo set nome = ${nome}
          where id = ${artigo.slice("prd_".length)}::uuid`.execute(trx);
      });
    }

    const historico = (
      c: { id: string; artigo: { id: string } },
      sessao: string,
      consulta = "",
    ) =>
      h.pedir("GET", `/hub/products/${c.artigo.id}/timeline${consulta}`, {
        sessao,
        comerciante: c.id,
      });

    it("dá as mesmas entradas, ordem e páginas da rota pela chave, com o nome de quem fez", async () => {
      const c = await comerciante("Loja Histórico");
      const dono = await h.pessoaCom(c.id, "dono", "Ana Teste");
      await mudarNome(c, dono.sessao, "Gel UV 15 ml transparente");
      await mudarNome(c, dono.sessao, "Gel UV 15 ml (novo)");

      const pelaChave = await comChave(
        c.chave.segredo,
        "GET",
        `/products/${c.artigo.id}/timeline?limite=2`,
      );
      expect(pelaChave.statusCode, pelaChave.body).toBe(200);
      const r = await historico(c, dono.sessao, "?limite=2");
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      const hub = r.json<Pagina>();
      const chave = pelaChave.json<Pagina>();
      // As mesmas entradas, sem os nomes, e o mesmo cursor.
      const semAutor = hub.dados.map((e) => {
        const resto = { ...e };
        delete resto.autor;
        delete resto.autor_autorizou;
        delete resto.autor_do_pedido;
        return resto;
      });
      expect(semAutor).toEqual(chave.dados);
      expect({ ...hub, dados: [] }).toEqual({ ...chave, dados: [] });
      expect(hub.ha_mais).toBe(true);
      expect(hub.dados[0]?.quem).toBe(`pessoa:per_${dono.pessoa}`);
      expect(hub.dados[0]?.autor).toEqual({
        tipo: "pessoa",
        nome: "Ana Teste",
      });

      // A página seguinte chega à criação, feita pela chave «Escrita».
      const resto = await historico(
        c,
        dono.sessao,
        `?limite=100&cursor=${hub.cursor_seguinte ?? ""}`,
      );
      expect(resto.statusCode, resto.body).toBe(200);
      const criacao = resto
        .json<Pagina>()
        .dados.find((e) => e.entidade === "artigo" && e.operacao === "criado");
      expect(criacao?.quem).toBe(`chave:key_${c.chave.id}`);
      expect(criacao?.autor).toEqual({ tipo: "chave", nome: "Escrita" });
    });

    it("o gestor vê; o armazém e o apoio recebem 403", async () => {
      const c = await comerciante("Loja Papéis");
      const gestor = await h.pessoaCom(c.id, "gestor");
      const r = await historico(c, gestor.sessao);
      expect(r.statusCode, r.body).toBe(200);
      for (const papel of ["armazem", "apoio"]) {
        const p = await h.pessoaCom(c.id, papel);
        const recusa = await historico(c, p.sessao);
        expect(recusa.statusCode, `${papel}: ${recusa.body}`).toBe(403);
        expect(h.codigo(recusa)).toBe("member.role_escalation");
        // A função da base também recusa, mesmo chamada directamente.
        await expect(
          base.api.transaction().execute(async (trx) => {
            await sql`select set_config('eurolify.comerciante', ${c.id}, true)`.execute(
              trx,
            );
            await sql`select * from autores_da_linha_do_tempo(${p.sessao},
              ${[p.pessoa]}::uuid[], '{}'::uuid[])`.execute(trx);
          }),
        ).rejects.toThrow(/member\.role_escalation/);
      }
    });

    it("numa página só com alterações automáticas (sem nomes a procurar), o armazém continua a receber 403", async () => {
      const c = await comerciante("Loja Automática");
      await escreverComo(c.artigo.id, "sistema:teste", "Pela tarefa");
      const dono = await h.pessoaCom(c.id, "dono");
      const ok = await historico(c, dono.sessao, "?limite=1");
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json<Pagina>().dados.map((e) => e.quem)).toEqual([
        "sistema:teste",
      ]);
      const armazem = await h.pessoaCom(c.id, "armazem");
      const r = await historico(c, armazem.sessao, "?limite=1");
      expect(r.statusCode, r.body).toBe(403);
      expect(h.codigo(r)).toBe("member.role_escalation");
      expect(r.headers["cache-control"]).toBe("private, no-store");
    });

    it("o contrato tem o caminho do Hub com a segurança da sessão e o autor", async () => {
      const r = await h.app.inject({ method: "GET", url: "/openapi.json" });
      const contrato = r.json<{
        paths: Record<
          string,
          Record<string, { security?: unknown; responses?: unknown }>
        >;
      }>();
      const doHub = contrato.paths["/hub/products/{id}/timeline"]?.["get"];
      const daApi = contrato.paths["/products/{id}/timeline"]?.["get"];
      expect(doHub?.security).toEqual([{ sessao: [] }]);
      expect(daApi?.security).toEqual([{ chave: [] }]);
      const resposta = JSON.stringify(doHub?.responses);
      expect(resposta).toContain('"autor"');
      expect(resposta).toContain('"autor_autorizou"');
      expect(resposta).toContain('"autor_do_pedido"');
      expect(JSON.stringify(daApi?.responses)).not.toContain('"autor"');
    });

    it("quem saiu da equipa continua com o nome; quem nunca foi membro, e a chave de outro comerciante, vêm sem nome", async () => {
      const c = await comerciante("Loja Equipa");
      const outro = await comerciante("Outra Loja");
      const dono = await h.pessoaCom(c.id, "dono", "Ana Teste");
      const saiu = await h.pessoaCom(c.id, "gestor", "Rui Teste");
      await mudarNome(c, dono.sessao, "Mudado pela dona");
      await mudarNome(c, saiu.sessao, "Mudado por quem saiu");
      await sql`update membro set ate = now(), terminado_por = 'operador:teste'
        where pessoa_id = ${saiu.pessoa}::uuid
          and comerciante_id = ${c.id}::uuid`.execute(base.dono);
      const deFora = await h.pessoaCom(outro.id, "dono");
      await escreverComo(c.artigo.id, `pessoa:per_${deFora.pessoa}`, "De fora");
      await escreverComo(
        c.artigo.id,
        `chave:key_${outro.chave.id}`,
        "Chave de outro",
      );

      const r = await historico(c, dono.sessao, "?limite=100");
      expect(r.statusCode, r.body).toBe(200);
      const porQuem = new Map(
        r.json<Pagina>().dados.map((e) => [e.quem, e.autor]),
      );
      // Cada um com o seu nome: o de quem saiu continua (P2-2 da revisão).
      expect(porQuem.get(`pessoa:per_${dono.pessoa}`)).toEqual({
        tipo: "pessoa",
        nome: "Ana Teste",
      });
      expect(porQuem.get(`pessoa:per_${saiu.pessoa}`)).toEqual({
        tipo: "pessoa",
        nome: "Rui Teste",
      });
      expect(porQuem.get(`pessoa:per_${deFora.pessoa}`)).toEqual({
        tipo: "pessoa",
        nome: null,
      });
      expect(porQuem.get(`chave:key_${outro.chave.id}`)).toEqual({
        tipo: "chave",
        nome: null,
      });
    });

    it("uma pessoa pseudonimizada aparece como tal; os automáticos e os outros vêm sem nome", async () => {
      const c = await comerciante("Loja Prazos");
      const dono = await h.pessoaCom(c.id, "dono");
      const antiga = await h.pessoaCom(c.id, "gestor");
      await mudarNome(c, antiga.sessao, "Mudado antes de sair");
      // A pseudonimização dos 90 dias (0026), feita à mão para o teste.
      await base.dono.transaction().execute(async (trx) => {
        await sql`alter table pessoa disable trigger pessoa_antes_de_gravar`.execute(
          trx,
        );
        await sql`update pessoa set nome = 'Pessoa pseudonimizada'
          where id = ${antiga.pessoa}::uuid`.execute(trx);
        await sql`alter table pessoa enable always trigger pessoa_antes_de_gravar`.execute(
          trx,
        );
      });
      await escreverComo(c.artigo.id, "sistema:teste", "Pela tarefa");
      await escreverComo(c.artigo.id, "teste:outro", "Por outro");

      const r = await historico(c, dono.sessao, "?limite=100");
      expect(r.statusCode, r.body).toBe(200);
      const porQuem = new Map(
        r.json<Pagina>().dados.map((e) => [e.quem, e.autor]),
      );
      expect(porQuem.get(`pessoa:per_${antiga.pessoa}`)).toEqual({
        tipo: "pessoa",
        nome: "Pessoa pseudonimizada",
      });
      expect(porQuem.get("sistema:teste")).toEqual({
        tipo: "sistema",
        nome: null,
      });
      expect(porQuem.get("teste:outro")).toEqual({ tipo: "outro", nome: null });
    });

    /** Uma alteração com o contexto do rasto escolhido (como uma tarefa). */
    async function escreverComRasto(
      artigo: string,
      rasto: {
        quem: string;
        autorizadoPor?: string;
        aPedidoDe?: { pedido: string; quem: string };
      },
      nome: string,
    ) {
      await base.dono.transaction().execute(async (trx) => {
        const pares: [string, string][] = [
          ["eurolify.quem", rasto.quem],
          ["eurolify.canal", "sistema"],
          ["eurolify.pedido", "tarefa:teste"],
        ];
        if (rasto.autorizadoPor !== undefined)
          pares.push(["eurolify.autorizado_por", rasto.autorizadoPor]);
        if (rasto.aPedidoDe !== undefined)
          pares.push(["eurolify.a_pedido_de", JSON.stringify(rasto.aPedidoDe)]);
        for (const [k, v] of pares) {
          await sql`select set_config(${k}, ${v}, true)`.execute(trx);
        }
        await sql`update artigo set nome = ${nome}
          where id = ${artigo.slice("prd_".length)}::uuid`.execute(trx);
      });
    }

    it("quem autorizou e quem pediu a tarefa vêm com o nome, pela mesma regra de quem fez (docs/22 §26.2)", async () => {
      const c = await comerciante("Loja Autorizou");
      const outro = await comerciante("Outra Autorizou");
      const dono = await h.pessoaCom(c.id, "dono", "Ana Teste");
      const deFora = await h.pessoaCom(outro.id, "dono", "Zé de Fora");
      // No Hub, quem age autoriza: o nome dela nas duas.
      await mudarNome(c, dono.sessao, "Pela dona");
      // Uma tarefa a pedido da chave do comerciante, autorizada pela dona.
      await escreverComRasto(
        c.artigo.id,
        {
          quem: "sistema:teste",
          autorizadoPor: `pessoa:per_${dono.pessoa}`,
          aPedidoDe: { pedido: "req-1", quem: `chave:key_${c.chave.id}` },
        },
        "Pela tarefa",
      );
      // Outra, a pedido da chave e com a autorização de alguém de fora.
      await escreverComRasto(
        c.artigo.id,
        {
          quem: "sistema:fora",
          autorizadoPor: `pessoa:per_${deFora.pessoa}`,
          aPedidoDe: { pedido: "req-2", quem: `chave:key_${outro.chave.id}` },
        },
        "De fora",
      );
      // Sem ninguém a autorizar e sem pedido de origem.
      await escreverComRasto(c.artigo.id, { quem: "sistema:so" }, "Sozinha");

      const r = await historico(c, dono.sessao, "?limite=100");
      expect(r.statusCode, r.body).toBe(200);
      const porQuem = new Map(r.json<Pagina>().dados.map((e) => [e.quem, e]));
      expect(porQuem.get(`pessoa:per_${dono.pessoa}`)).toMatchObject({
        autor_autorizou: { nome: "Ana Teste" },
        autor_do_pedido: null,
      });
      expect(porQuem.get("sistema:teste")).toMatchObject({
        autor_autorizou: { nome: "Ana Teste" },
        autor_do_pedido: { nome: "Escrita" },
      });
      expect(porQuem.get("sistema:fora")).toMatchObject({
        autorizado_por: `pessoa:per_${deFora.pessoa}`,
        autor_autorizou: { nome: null },
        autor_do_pedido: { nome: null },
      });
      expect(porQuem.get("sistema:so")).toMatchObject({
        autor_autorizou: null,
        autor_do_pedido: null,
      });
    });

    it("uma página com mais de 200 pessoas diferentes pede os nomes aos bocados", async () => {
      const c = await comerciante("Loja Muitos");
      const dono = await h.pessoaCom(c.id, "dono", "Ana Muitos");
      // Cada alteração com quem fez, quem autorizou e quem pediu diferentes:
      // 300 pessoas numa página de 100.
      const uuid = () => `pessoa:per_${randomUUID()}`;
      const dona = `pessoa:per_${dono.pessoa}`;
      // 102 alterações; a página traz as 100 mais recentes (i = 101 a 2). A
      // i = 2, a mais antiga da página, é autorizada e pedida pela dona: os
      // nomes pedem-se da mais recente para a mais antiga, por isso o dela é
      // o 299.º, no segundo bocado (revisão do #359, P2-2).
      for (let i = 0; i < 102; i++) {
        await escreverComRasto(
          c.artigo.id,
          {
            quem: uuid(),
            autorizadoPor: i === 2 ? dona : uuid(),
            aPedidoDe: {
              pedido: `req-${String(i)}`,
              quem: i === 2 ? dona : uuid(),
            },
          },
          `Nome ${String(i)}`,
        );
      }
      const r = await historico(c, dono.sessao, "?limite=100");
      expect(r.statusCode, r.body).toBe(200);
      const dados = r.json<Pagina>().dados;
      expect(dados).toHaveLength(100);
      expect(dados[99]).toMatchObject({
        autorizado_por: dona,
        autor_autorizou: { nome: "Ana Muitos" },
        autor_do_pedido: { nome: "Ana Muitos" },
      });
    });

    it("recusa outro comerciante, quem saiu, a sessão terminada e o pedido sem sessão", async () => {
      const c = await comerciante("Loja Recusas");
      const outro = await comerciante("Loja Alheia");
      const dono = await h.pessoaCom(c.id, "dono");
      // Um artigo de outro comerciante: 404, como a ficha.
      const alheio = await h.pedir(
        "GET",
        `/hub/products/${outro.artigo.id}/timeline`,
        { sessao: dono.sessao, comerciante: c.id },
      );
      expect(alheio.statusCode, alheio.body).toBe(404);
      // O cabeçalho de outro comerciante: não é membro.
      const cabecalho = await h.pedir(
        "GET",
        `/hub/products/${outro.artigo.id}/timeline`,
        { sessao: dono.sessao, comerciante: outro.id },
      );
      expect(cabecalho.statusCode, cabecalho.body).toBe(403);
      const semSessao = await h.pedir(
        "GET",
        `/hub/products/${c.artigo.id}/timeline`,
        { comerciante: c.id },
      );
      expect(semSessao.statusCode, semSessao.body).toBe(401);

      const saiu = await h.pessoaCom(c.id, "gestor");
      await sql`update membro set ate = now(), terminado_por = 'operador:teste'
        where pessoa_id = ${saiu.pessoa}::uuid
          and comerciante_id = ${c.id}::uuid`.execute(base.dono);
      const depois = await historico(c, saiu.sessao);
      expect(depois.statusCode, depois.body).toBe(403);

      const fim = await h.pedir("POST", "/hub/session/end", {
        sessao: dono.sessao,
      });
      expect(fim.statusCode, fim.body).toBe(200);
      const terminada = await historico(c, dono.sessao);
      expect(terminada.statusCode, terminada.body).toBe(401);
    });
  },
);
