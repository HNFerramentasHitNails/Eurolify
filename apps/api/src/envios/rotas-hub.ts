import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely, type Transaction } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { idCom, semPrefixo } from "../catalogo/rotas.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { sessaoDo } from "../identidade/autenticacao.js";
import { SemCorpo } from "../identidade/hub.js";
import { erroConta } from "../identidade/sessoes.js";
import {
  CorpoMudarMetodo,
  CorpoNovoMetodo,
  emCheckout,
  enviosDo,
  IdMetodo,
  paraMetodo,
} from "../checkout/rotas.js";
import {
  criarMetodoEntrega,
  listarMetodosEntrega,
  mudarMetodoEntrega,
} from "../checkout/repositorio.js";
import { emPrecos, paraMercado } from "../precos/rotas.js";
import { listarMercados } from "../precos/repositorio.js";
import { paraArmazem } from "../stock/rotas.js";
import { listarArmazens } from "../stock/repositorio.js";
import type { ConfigEnvios } from "./adaptador.js";
import { definirEmbalagem } from "./etiquetas.js";
import {
  criarConta,
  definirCredenciais,
  listarContas,
  mudarConta,
  servicosDaConta,
  testarConta,
} from "./repositorio.js";
import {
  contaParaApi,
  CorpoCredenciais,
  CorpoMudarConta,
  CorpoNovaConta,
  emEnvios,
  IdConta,
  servicoParaApi,
} from "./rotas.js";

// As contas de transportadora pelo Hub (docs/22 §29; Diogo, 12/10/2026:
// «sim, aprovo; avança com o código»): as mesmas funções das rotas pela
// chave (docs/36 §7.1), com a sessão de uma pessoa e o mesmo âmbito. Sem
// Idempotency-Key, como as outras rotas do Hub (docs/21 §11): a `versao`
// recusa a repetição de uma alteração.

type Ambito =
  | "shipping:read"
  | "shipping:accounts"
  | "shipping:write"
  | "prices:read"
  | "inventory:read"
  | "fulfilment:read"
  | "fulfilment:write"
  | "returns:read"
  | "returns:write";

const RECUSA: Record<Ambito, string> = {
  "shipping:read": "o papel não vê os envios",
  "shipping:accounts": "o papel não gere as contas de transportadora",
  "shipping:write":
    "o papel não muda os métodos de entrega, a embalagem nem o serviço de uma expedição",
  "prices:read": "o papel não vê os mercados",
  "inventory:read": "o papel não vê os armazéns",
  "fulfilment:read": "o papel não vê as expedições",
  "fulfilment:write": "o papel não expede",
  "returns:read": "o papel não vê as devoluções",
  "returns:write": "o papel não trata das devoluções",
};

/**
 * O que todas as rotas dos envios no Hub partilham (docs/22 §29.2): a
 * sessão com o âmbito pedido e as respostas fora de qualquer cache (também
 * um 403), e uma escrita na transacção do comerciante com a pessoa como
 * «quem».
 */
export function ferramentasDoHub(base: Kysely<BaseDados>) {
  const daSessao = (
    pedido: FastifyRequest,
    resposta: FastifyReply,
    ambito: Ambito,
  ) => {
    // O cabeçalho antes de tudo: também um 403 sai fora das caches.
    void resposta.header("cache-control", "private, no-store");
    const sessao = sessaoDo(pedido);
    if (!sessao.ambitos.includes(ambito)) {
      throw erroConta("member.role_escalation", RECUSA[ambito]);
    }
    if (sessao.comercianteId === null) {
      throw new Error("rota com comerciante sem o comerciante da sessão");
    }
    return { ...sessao, comercianteId: sessao.comercianteId };
  };

  const escreverNoHub = <T>(
    comercianteId: string,
    pessoaId: string,
    fn: (trx: Transaction<BaseDados>) => Promise<T>,
  ) =>
    comComerciante(base, comercianteId, async (trx) => {
      await sql`select set_config('eurolify.quem', ${`pessoa:per_${pessoaId}`}, true)`.execute(
        trx,
      );
      return fn(trx);
    });

  const Lista = Type.Object({
    dados: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  });

  return { daSessao, escreverNoHub, Lista };
}

export function rotasDosEnviosNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const paraConta = contaParaApi(cfg);

  const { daSessao, escreverNoHub, Lista } = ferramentasDoHub(base);

  rotas.get(
    "/hub/carrier-accounts",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As contas do comerciante nas transportadoras pelo Hub (docs/22 §29), sem as credenciais: a mesma lista de GET /carrier-accounts, com shipping:read.",
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:read");
        return {
          dados: (await listarContas(base, s.comercianteId)).map(paraConta),
        };
      }),
  );

  rotas.post(
    "/hub/carrier-accounts",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Liga uma transportadora pelo Hub (rascunho, modo teste): só o dono (shipping:accounts).",
        body: CorpoNovaConta,
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:accounts");
        const id = await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
          criarConta(trx, s.comercianteId, pedido.body),
        );
        void resposta.code(201);
        return { id: `cac_${id}` };
      }),
  );

  rotas.patch(
    "/hub/carrier-accounts/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Muda o nome ou o remetente da conta, ou arquiva-a, pelo Hub (só o dono), com a versão lida: outra dá 409.",
        params: Type.Object({ id: IdConta }),
        body: CorpoMudarConta,
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:accounts");
        const { versao, ...dados } = pedido.body;
        return {
          versao: await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
            mudarConta(
              trx,
              s.comercianteId,
              semPrefixo(pedido.params.id),
              versao,
              dados,
            ),
          ),
        };
      }),
  );

  rotas.put(
    "/hub/carrier-accounts/:id/credentials",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Guarda as credenciais da conta pelo Hub (só o dono). Ficam cifradas e nunca se devolvem; a conta volta a «por testar».",
        params: Type.Object({ id: IdConta }),
        body: CorpoCredenciais,
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:accounts");
        await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
          definirCredenciais(
            trx,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            `pessoa:per_${s.pessoaId}`,
            cfg,
          ),
        );
        void resposta.code(204);
        return null;
      }),
  );

  rotas.post(
    "/hub/carrier-accounts/:id/test",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "A chamada de teste à transportadora pelo Hub (só o dono): se ela aceitar as credenciais, a conta fica pronta.",
        params: Type.Object({ id: IdConta }),
        body: SemCorpo,
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:accounts");
        return {
          versao: await testarConta(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
          ),
        };
      }),
  );

  rotas.get(
    "/hub/carrier-accounts/:id/services",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os serviços da conta pelo Hub (shipping:read): os mesmos de GET /carrier-accounts/{id}/services.",
        params: Type.Object({ id: IdConta }),
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:read");
        return {
          dados: (
            await servicosDaConta(
              base,
              s.comercianteId,
              semPrefixo(pedido.params.id),
              cfg,
            )
          ).map(servicoParaApi),
        };
      }),
  );

  // ------------------ Os métodos de entrega e a embalagem (docs/22 §31)

  const IdMercadoNaConsulta = idCom("mkt", "mkt_…");
  const IdArmazem = idCom("whs", "whs_…");

  rotas.get(
    "/hub/shipping-methods",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os métodos de entrega pelo Hub (docs/22 §31): a mesma lista de GET /shipping-methods, com shipping:read.",
        querystring: Type.Object({
          mercado: Type.Optional(IdMercadoNaConsulta),
        }),
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:read");
        return {
          dados: (
            await listarMetodosEntrega(
              base,
              s.comercianteId,
              pedido.query.mercado === undefined
                ? undefined
                : semPrefixo(pedido.query.mercado),
            )
          ).map(paraMetodo),
        };
      }),
  );

  rotas.post(
    "/hub/shipping-methods",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Cria um método de entrega num mercado pelo Hub (dono e gestor, shipping:write).",
        body: CorpoNovoMetodo,
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, () =>
        emCheckout(resposta, async () => {
          const s = daSessao(pedido, resposta, "shipping:write");
          const b = pedido.body;
          const id = await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
            criarMetodoEntrega(
              trx,
              s.comercianteId,
              semPrefixo(b.mercado),
              {
                nome: b.nome,
                prazo: b.prazo ?? {},
                tarifa: b.tarifa,
                gratis_a_partir_de: b.gratis_a_partir_de ?? null,
                pede_telefone: b.pede_telefone ?? false,
                ...enviosDo(b),
              },
              cfg,
            ),
          );
          void resposta.code(201);
          return { id: `shm_${id}` };
        }),
      ),
  );

  rotas.patch(
    "/hub/shipping-methods/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Muda, arquiva ou reactiva um método de entrega pelo Hub (dono e gestor), na versão lida: outra dá 409.",
        params: Type.Object({ id: IdMetodo }),
        body: CorpoMudarMetodo,
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, () =>
        emCheckout(resposta, async () => {
          const s = daSessao(pedido, resposta, "shipping:write");
          const b = pedido.body;
          await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
            mudarMetodoEntrega(
              trx,
              s.comercianteId,
              semPrefixo(pedido.params.id),
              b.versao,
              {
                ...(b.nome === undefined ? {} : { nome: b.nome }),
                ...(b.prazo === undefined ? {} : { prazo: b.prazo }),
                ...(b.tarifa === undefined ? {} : { tarifa: b.tarifa }),
                ...(b.gratis_a_partir_de === undefined
                  ? {}
                  : { gratis_a_partir_de: b.gratis_a_partir_de }),
                ...(b.pede_telefone === undefined
                  ? {}
                  : { pede_telefone: b.pede_telefone }),
                ...(b.estado === undefined ? {} : { estado: b.estado }),
                ...enviosDo(b),
              },
              cfg,
            ),
          );
          void resposta.code(204);
          return null;
        }),
      ),
  );

  rotas.get(
    "/hub/markets",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Todos os mercados do comerciante pelo Hub, para escolher o de um método (prices:read; docs/22 §31).",
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPrecos(resposta, async () => {
        const s = daSessao(pedido, resposta, "prices:read");
        // Todas as páginas: o ecrã nunca corta a lista em silêncio.
        const dados: ReturnType<typeof paraMercado>[] = [];
        let depois: string | null = null;
        do {
          const p = await listarMercados(base, s.comercianteId, 200, depois);
          dados.push(...p.dados.map(paraMercado));
          depois = p.ultimo;
        } while (depois !== null);
        return { dados };
      }),
  );

  rotas.get(
    "/hub/warehouses",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os armazéns pelo Hub, com o peso da embalagem (inventory:read; docs/22 §31).",
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "inventory:read");
        return {
          dados: (await listarArmazens(base, s.comercianteId)).map(paraArmazem),
        };
      }),
  );

  rotas.put(
    "/hub/warehouses/:id/packaging",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "O peso da embalagem por omissão do armazém pelo Hub (dono e gestor, shipping:write). Sem versão: ganha a última escrita.",
        params: Type.Object({ id: IdArmazem }),
        body: Type.Object(
          { embalagem_g: Type.Integer({ minimum: 0, maximum: 100_000 }) },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "shipping:write");
        await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
          definirEmbalagem(
            trx,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.embalagem_g,
          ),
        );
        void resposta.code(204);
        return null;
      }),
  );
}
