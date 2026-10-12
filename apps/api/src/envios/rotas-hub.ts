import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely, type Transaction } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { semPrefixo } from "../catalogo/rotas.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { sessaoDo } from "../identidade/autenticacao.js";
import { SemCorpo } from "../identidade/hub.js";
import { erroConta } from "../identidade/sessoes.js";
import type { ConfigEnvios } from "./adaptador.js";
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

type Ambito = "shipping:read" | "shipping:accounts";

export function rotasDosEnviosNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const paraConta = contaParaApi(cfg);

  /** A sessão, com o âmbito pedido, e as respostas fora de qualquer cache. */
  const daSessao = (
    pedido: FastifyRequest,
    resposta: FastifyReply,
    ambito: Ambito,
  ) => {
    // O cabeçalho antes de tudo: também um 403 sai fora das caches.
    void resposta.header("cache-control", "private, no-store");
    const sessao = sessaoDo(pedido);
    if (!sessao.ambitos.includes(ambito)) {
      throw erroConta(
        "member.role_escalation",
        ambito === "shipping:read"
          ? "o papel não vê os envios"
          : "o papel não gere as contas de transportadora",
      );
    }
    if (sessao.comercianteId === null) {
      throw new Error("rota com comerciante sem o comerciante da sessão");
    }
    return { ...sessao, comercianteId: sessao.comercianteId };
  };

  /** Uma escrita na transacção do comerciante, com a pessoa como «quem». */
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
}
