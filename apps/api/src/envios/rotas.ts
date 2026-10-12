import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { TRANSPORTADORAS, type BaseDados } from "../base/esquema.js";
import { escrever, idCom, semPrefixo, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import type { ConfigEnvios } from "./adaptador.js";
import { ErroEnvios, ESTADO_DO_CODIGO } from "./erros.js";
import {
  criarConta,
  definirCredenciais,
  listarContas,
  mudarConta,
  servicosDaConta,
  testarConta,
  traduzir,
} from "./repositorio.js";

// A API das contas de transportadora (docs/36 §7.1; migração 0072; Diogo,
// 12/10/2026: «sim, aprovo; avança com a parte A»). Os campos novos do
// método de entrega vivem nas rotas do checkout (/shipping-methods).

function paraApi(erro: unknown): unknown {
  const e = traduzir(erro);
  if (e instanceof ErroEnvios) {
    return new ErroApi(
      e.codigo,
      ESTADO_DO_CODIGO[e.codigo],
      e.codigo.endsWith(".not_found")
        ? { pt: "Não encontrado", en: "Not found" }
        : { pt: "Pedido recusado pelos envios", en: "Rejected by shipping" },
      e.pormenor === undefined
        ? e.message
        : `${e.message} ${JSON.stringify(e.pormenor)}`,
    );
  }
  return e;
}

export async function emEnvios<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
) {
  try {
    return await fn();
  } catch (erro) {
    const e = paraApi(erro);
    if (e instanceof ErroApi && e.codigo === "shipping.retry") {
      void resposta.header("Retry-After", "1");
    }
    throw e;
  }
}

const IdConta = idCom("cac", "cac_…");
const Versao = Type.Integer({ minimum: 1 });
const iso = (d: Date | null) => (d === null ? null : d.toISOString());

const Remetente = Type.Object(
  {
    nome: Type.String({ minLength: 1, maxLength: 200 }),
    linha1: Type.String({ minLength: 1, maxLength: 200 }),
    linha2: Type.Optional(Type.String({ maxLength: 200 })),
    codigo_postal: Type.String({ minLength: 1, maxLength: 20 }),
    localidade: Type.String({ minLength: 1, maxLength: 100 }),
    pais: Type.String({ pattern: "^[A-Z]{2}$" }),
    telefone: Type.Optional(Type.String({ pattern: "^\\+[1-9][0-9]{6,14}$" })),
    email: Type.Optional(
      Type.String({ maxLength: 254, pattern: "^[^@\\s]+@[^@\\s]+$" }),
    ),
  },
  { additionalProperties: false },
);

export function rotasDosEnvios(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  const paraConta = (c: Awaited<ReturnType<typeof listarContas>>[number]) => ({
    id: `cac_${c.id}`,
    transportadora: c.transportadora,
    nome: c.nome,
    modo: c.modo,
    remetente: c.remetente,
    estado: c.estado,
    // As credenciais nunca saem: só quando e por quem foram definidas.
    credenciais_em: iso(c.credenciais_em),
    credenciais_por: c.credenciais_por,
    testada_em: iso(c.testada_em),
    criado_em: c.criado_em.toISOString(),
    versao: c.versao,
  });

  rotas.get(
    "/carrier-accounts",
    {
      config: { ambito: "shipping:read" },
      schema: {
        description:
          "As contas do comerciante nas transportadoras, sem as credenciais (docs/36 §3.1).",
        response: {
          200: Type.Object({
            dados: Type.Array(Type.Record(Type.String(), Type.Unknown())),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        dados: (await listarContas(base, chaveDo(pedido).comercianteId)).map(
          paraConta,
        ),
      })),
  );

  rotas.post(
    "/carrier-accounts",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "Cria uma conta numa transportadora (rascunho, modo teste). Só o dono (shipping:accounts).",
        body: Type.Object(
          {
            transportadora: umDe(TRANSPORTADORAS),
            nome: Type.String({ minLength: 1, maxLength: 100 }),
            remetente: Remetente,
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emEnvios(resposta, async () => ({
          id: `cac_${await criarConta(trx, chave.comercianteId, pedido.body)}`,
        })),
      ),
  );

  rotas.patch(
    "/carrier-accounts/:id",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "Muda o nome ou o remetente da conta, ou arquiva-a (só sem métodos de entrega activos a usá-la).",
        params: Type.Object({ id: IdConta }),
        body: Type.Object(
          {
            versao: Versao,
            nome: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            remetente: Type.Optional(Remetente),
            arquivar: Type.Optional(Type.Literal(true)),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emEnvios(resposta, async () => {
          const { versao, ...dados } = pedido.body;
          return {
            versao: await mudarConta(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              versao,
              dados,
            ),
          };
        }),
      ),
  );

  rotas.put(
    "/carrier-accounts/:id/credentials",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "Define as credenciais da conta na transportadora (os campos dependem dela) e, se a transportadora avisar, o segredo dos avisos. Ficam cifrados e nunca se devolvem; a conta volta a rascunho até à chamada de teste.",
        params: Type.Object({ id: IdConta }),
        body: Type.Object(
          {
            credenciais: Type.Record(
              Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
              Type.String({ minLength: 1, maxLength: 500 }),
              { minProperties: 1, maxProperties: 10 },
            ),
            segredo_aviso: Type.Optional(
              Type.String({ minLength: 16, maxLength: 200 }),
            ),
          },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emEnvios(resposta, async () => {
          await definirCredenciais(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            `chave:key_${chave.chaveId}`,
            cfg,
          );
          return null;
        }),
      ),
  );

  rotas.post(
    "/carrier-accounts/:id/test",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "A chamada de teste à transportadora com as credenciais da conta: se ela as aceitar, a conta fica pronta (só então um método de entrega pode apontar para ela).",
        params: Type.Object({ id: IdConta }),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        versao: await testarConta(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
          cfg,
        ),
      })),
  );

  rotas.get(
    "/carrier-accounts/:id/services",
    {
      config: { ambito: "shipping:read" },
      schema: {
        description:
          "Os serviços que o adaptador da transportadora declara: código, países, peso máximo, se pede telefone ou e-mail e que perigosos aceita.",
        params: Type.Object({ id: IdConta }),
        response: {
          200: Type.Object({
            dados: Type.Array(Type.Record(Type.String(), Type.Unknown())),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        dados: (
          await servicosDaConta(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
          )
        ).map((s) => ({
          codigo: s.codigo,
          nome: s.nome,
          paises: s.paises,
          peso_max_g: s.pesoMaxG,
          pede_telefone: s.pedeTelefone,
          pede_email: s.pedeEmail,
          aceita_onu: s.aceitaOnu,
        })),
      })),
  );
}
