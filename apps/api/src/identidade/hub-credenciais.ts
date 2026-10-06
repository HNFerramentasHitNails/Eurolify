import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { sessaoDo } from "./autenticacao.js";
import {
  CodigosRecuperacao,
  codigosNovos,
  comPrefixo,
  Credencial,
  desafioNovo,
  opcoesDeRegisto,
  OpcoesWebAuthn,
  porCookie,
  RespostaOk,
  resumoDoCodigo,
  SemCorpo,
  verificarRegisto,
} from "./hub.js";
import {
  erroConta,
  resumo,
  segredoNovo,
  traduzindoConta,
  type ConfigHub,
} from "./sessoes.js";

// Rotas do Hub da parte B3a (docs/21 §7, §8 e §12): acrescentar e retirar
// passkeys, as sessões abertas, os códigos de recuperação e recuperar a
// conta. As regras ficam na base (0021); aqui verifica-se a passkey
// (@simplewebauthn) e traduzem-se os erros. O IP de quem pede vai só para o
// registo de entradas da base (14 dias), nunca para o registo da aplicação.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const Instante = Type.String({ format: "date-time" });
const InstanteOuNulo = Type.Union([Instante, Type.Null()]);
const NomePasskey = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "\\S",
});
const Email = Type.String({ minLength: 3, maxLength: 254 });
const Codigo = Type.String({
  minLength: 16,
  maxLength: 32,
  pattern: "^[A-Za-z2-7 -]+$",
  description: "Um código de recuperação (XXXX-XXXX-XXXX-XXXX)",
});

const ParametroPasskey = Type.Object({
  id: Type.String({ pattern: `^pky_${UUID}$`, description: "pky_…" }),
});

const instante = (t: string | null) =>
  t === null ? null : new Date(t).toISOString();

export function rotasDasCredenciais(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  hub: ConfigHub,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/hub/passkeys",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description: "As passkeys da pessoa da sessão.",
        response: {
          200: Type.Object({
            passkeys: Type.Array(
              Type.Object({
                passkey: Type.String({ description: "pky_…" }),
                nome: Type.String(),
                criada_em: Instante,
                ultimo_uso_em: InstanteOuNulo,
              }),
            ),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const lista = await traduzindoConta(async () => {
        const { rows } = await sql<{
          lista: {
            passkey: string;
            nome: string;
            criada_em: string;
            ultimo_uso_em: string | null;
          }[];
        }>`select passkeys_listar(${sessao.segredo}) as lista`.execute(base);
        return rows[0]?.lista ?? [];
      });
      return {
        passkeys: lista.map((k) => ({
          passkey: comPrefixo("pky", k.passkey),
          nome: k.nome,
          criada_em: new Date(k.criada_em).toISOString(),
          ultimo_uso_em: instante(k.ultimo_uso_em),
        })),
      };
    },
  );

  rotas.post(
    "/hub/passkeys/options",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Opções WebAuthn para acrescentar uma passkey à conta (autenticação recente), sem as que a pessoa já tem. O desafio vale uma vez, 5 minutos.",
        body: SemCorpo,
        response: { 200: OpcoesWebAuthn, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const desafio = desafioNovo();
      const linha = await traduzindoConta(async () => {
        const { rows } = await sql<{ email: string; credenciais: string[] }>`
          select * from desafio_criar_acrescentar(${resumo(desafio)},
            ${sessao.segredo})`.execute(base);
        const r = rows[0];
        if (r === undefined) throw erroConta("auth.unauthenticated");
        return r;
      });
      return opcoesDeRegisto(hub, linha.email, desafio, linha.credenciais);
    },
  );

  rotas.post(
    "/hub/passkeys",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Acrescentar uma passkey à conta (autenticação recente), com o desafio de /hub/passkeys/options.",
        body: Type.Object(
          { nome: NomePasskey, credencial: Credencial },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ passkey: Type.String({ description: "pky_…" }) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const { desafio, credencial } = await verificarRegisto(
        pedido.body.credencial,
        hub,
      );
      const id = await traduzindoConta(async () => {
        const { rows } = await sql<{ id: string }>`
          select passkey_acrescentar(${resumo(desafio)}, ${sessao.segredo},
            ${credencial.id}, ${Buffer.from(credencial.publicKey)},
            ${credencial.counter}, ${credencial.transports ?? []}::text[],
            ${pedido.body.nome}) as id`.execute(base);
        const r = rows[0]?.id;
        if (r === undefined) throw new Error("a base não devolveu a passkey");
        return r;
      });
      return resposta.code(201).send({ passkey: comPrefixo("pky", id) });
    },
  );

  rotas.post(
    "/hub/passkeys/:id/remove",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Retirar uma passkey (autenticação recente). Nunca a última forma de entrar. Todas as sessões caem; quem pediu recebe uma nova (docs/21 §7).",
        params: ParametroPasskey,
        body: SemCorpo,
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const id = pedido.params.id.slice("pky_".length);
      const segredo = segredoNovo("eus");
      await traduzindoConta(() =>
        sql`select passkey_retirar(${sessao.segredo}, ${id}::uuid,
          ${resumo(segredo)})`.execute(base),
      );
      porCookie(resposta, segredo);
      return { ok: true as const };
    },
  );

  rotas.get(
    "/hub/sessions",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description: "As sessões abertas da pessoa da sessão.",
        response: {
          200: Type.Object({
            sessoes: Type.Array(
              Type.Object({
                sessao: Type.String({ description: "ses_…" }),
                criada_em: Instante,
                ultimo_uso_em: Instante,
                esta: Type.Boolean(),
              }),
            ),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const lista = await traduzindoConta(async () => {
        const { rows } = await sql<{
          lista: {
            sessao: string;
            criada_em: string;
            ultimo_uso_em: string;
            esta: boolean;
          }[];
        }>`select sessoes_listar(${sessao.segredo}) as lista`.execute(base);
        return rows[0]?.lista ?? [];
      });
      return {
        sessoes: lista.map((x) => ({
          sessao: comPrefixo("ses", x.sessao),
          criada_em: new Date(x.criada_em).toISOString(),
          ultimo_uso_em: new Date(x.ultimo_uso_em).toISOString(),
          esta: x.esta,
        })),
      };
    },
  );

  rotas.post(
    "/hub/sessions/end-all",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Terminar todas as sessões (autenticação recente); quem pediu recebe uma nova.",
        body: SemCorpo,
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const segredo = segredoNovo("eus");
      await traduzindoConta(() =>
        sql`select sessoes_terminar_todas(${sessao.segredo},
          ${resumo(segredo)})`.execute(base),
      );
      porCookie(resposta, segredo);
      return { ok: true as const };
    },
  );

  rotas.post(
    "/hub/recovery-codes",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "10 códigos de recuperação novos (autenticação recente); os antigos deixam de valer. Só aparecem nesta resposta.",
        body: SemCorpo,
        response: {
          201: Type.Object({ codigos: CodigosRecuperacao }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const { codigos, resumos } = codigosNovos();
      await traduzindoConta(() =>
        sql`select codigos_gerar(${sessao.segredo}, ${resumos}::text[])`.execute(
          base,
        ),
      );
      return resposta.code(201).send({ codigos });
    },
  );

  rotas.post(
    "/hub/recovery/options",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Recuperar a conta, passo 1: e-mail e um código de recuperação. Devolve as opções WebAuthn para registar uma passkey nova. A mesma recusa (401) para e-mail sem conta, código errado ou já usado; 5 falhas em 15 minutos por e-mail bloqueiam 15 minutos (429).",
        body: Type.Object(
          { email: Email, codigo: Codigo },
          { additionalProperties: false },
        ),
        response: { 200: OpcoesWebAuthn, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const desafio = desafioNovo();
      const resultado = await traduzindoConta(async () => {
        const { rows } = await sql<{ r: "ok" | "falhou" | "bloqueado" }>`
          select recuperacao_iniciar(${resumo(desafio)}, ${pedido.body.email},
            ${resumoDoCodigo(pedido.body.codigo)}, ${pedido.ip}::inet) as r`.execute(
          base,
        );
        return rows[0]?.r;
      });
      if (resultado === "bloqueado") throw erroConta("auth.locked");
      if (resultado !== "ok") throw erroConta("auth.unauthenticated");
      return opcoesDeRegisto(hub, pedido.body.email, desafio);
    },
  );

  rotas.post(
    "/hub/recovery",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Recuperar a conta, passo 2: o código gasta-se, a passkey nova entra, todas as sessões caem e nasce uma (cookie).",
        body: Type.Object(
          {
            email: Email,
            codigo: Codigo,
            nome_passkey: Type.Optional(NomePasskey),
            credencial: Credencial,
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ pessoa: Type.String({ description: "per_…" }) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const corpo = pedido.body;
      const { desafio, credencial } = await verificarRegisto(
        corpo.credencial,
        hub,
      );
      const segredo = segredoNovo("eus");
      const pessoa = await traduzindoConta(async () => {
        const { rows } = await sql<{ id: string }>`
          select recuperacao_concluir(${resumo(desafio)}, ${corpo.email},
            ${resumoDoCodigo(corpo.codigo)}, ${credencial.id},
            ${Buffer.from(credencial.publicKey)}, ${credencial.counter},
            ${credencial.transports ?? []}::text[], ${corpo.nome_passkey ?? null},
            ${resumo(segredo)}, ${pedido.ip}::inet) as id`.execute(base);
        const r = rows[0]?.id;
        if (r === undefined) throw erroConta("auth.unauthenticated");
        return r;
      });
      porCookie(resposta, segredo);
      return resposta.code(201).send({ pessoa: comPrefixo("per", pessoa) });
    },
  );
}
