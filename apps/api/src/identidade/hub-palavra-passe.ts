import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { sessaoDo } from "./autenticacao.js";
import { comPrefixo, porCookie, RespostaOk, SemCorpo } from "./hub.js";
import {
  cifrarSegredo,
  conferirCodigo,
  conferirPalavraPasse,
  decifrarSegredo,
  Ocupado,
  prepararResumoFalso,
  resumirPalavraPasse,
  segredoTotpNovo,
  uriTotp,
  type ChaveTotp,
} from "./palavra-passe.js";
import {
  COOKIE_SESSAO,
  erroConta,
  FORMATO_SESSAO,
  resumo,
  segredoNovo,
  traduzindoConta,
  type ConfigHub,
} from "./sessoes.js";

// Rotas do Hub da parte B3b (docs/21 §4.3, §7, §8 e §12): escolher,
// confirmar e retirar a palavra-passe com o TOTP, e entrar com e-mail +
// palavra-passe + código. A palavra-passe sozinha nunca entra (CA). Só
// existem com a chave dos segredos TOTP (`TOTP_CHAVE`).

const PalavraPasse = Type.String({
  minLength: 12,
  maxLength: 256,
  description: "No mínimo 12 caracteres (proposta, docs/21 §8)",
});
const CodigoTotp = Type.String({
  pattern: "^[0-9]{6}$",
  description: "O código de seis dígitos da aplicação de autenticação",
});

/** O segredo cifrado com outra versão da chave não se abre (troca por fazer). */
function abrir(
  cifrado: Buffer,
  versao: number,
  pessoa: string,
  chave: ChaveTotp,
): string | null {
  if (versao !== chave.versao) return null;
  try {
    return decifrarSegredo(cifrado, pessoa, chave);
  } catch {
    return null;
  }
}

export function rotasDaPalavraPasse(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  _hub: ConfigHub,
  chave: ChaveTotp,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  // O resumo falso (o tempo de quem não tem conta) fica pronto já.
  void prepararResumoFalso();

  /** O Argon2id com a vez contada: cheio, 503. */
  async function argon2<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (erro) {
      if (erro instanceof Ocupado) throw erroConta("auth.busy");
      throw erro;
    }
  }

  rotas.post(
    "/hub/password/setup",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Escolher uma palavra-passe (autenticação recente). Devolve o segredo TOTP e o URI otpauth:// para a aplicação de autenticação; nada fica activo até /hub/password/confirm (CA: a palavra-passe e o TOTP só juntos).",
        body: Type.Object(
          { palavra_passe: PalavraPasse },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            segredo: Type.String({ description: "O segredo TOTP (base32)" }),
            uri: Type.String({ description: "otpauth://totp/…" }),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const segredo = segredoTotpNovo();
      const resumoPalavra = await argon2(() =>
        resumirPalavraPasse(pedido.body.palavra_passe),
      );
      const cifrado = cifrarSegredo(segredo, sessao.pessoaId, chave);
      const email = await traduzindoConta(async () => {
        await sql`select palavra_passe_preparar(${sessao.segredo},
          ${resumoPalavra}, ${cifrado}, ${chave.versao})`.execute(base);
        const { rows } = await sql<{ eu: { email: string } }>`
          select pessoa_eu(${sessao.segredo}) as eu`.execute(base);
        return rows[0]?.eu.email ?? "";
      });
      void resposta.header("cache-control", "no-store");
      return { segredo, uri: uriTotp(segredo, email) };
    },
  );

  rotas.post(
    "/hub/password/confirm",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Confirmar a palavra-passe com o primeiro código (autenticação recente): fica activa com o TOTP; todas as sessões caem e quem pediu recebe uma nova.",
        body: Type.Object(
          { codigo: CodigoTotp },
          { additionalProperties: false },
        ),
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const pendente = await traduzindoConta(async () => {
        const { rows } = await sql<{
          id: string;
          pessoa_id: string;
          totp_cifrado: Buffer;
          chave_versao: number;
        }>`select * from palavra_passe_pendente(${sessao.segredo})`.execute(
          base,
        );
        return rows[0];
      });
      if (pendente === undefined) throw erroConta("password.not_pending");
      const segredo = abrir(
        pendente.totp_cifrado,
        pendente.chave_versao,
        pendente.pessoa_id,
        chave,
      );
      const passo =
        segredo === null
          ? null
          : await conferirCodigo(segredo, pedido.body.codigo, 0);
      if (passo === null) throw erroConta("password.invalid_code");
      const novo = segredoNovo("eus");
      await traduzindoConta(() =>
        sql`select palavra_passe_confirmar(${sessao.segredo},
          ${pendente.id}::uuid, ${passo}, ${resumo(novo)})`.execute(base),
      );
      porCookie(resposta, novo);
      return { ok: true as const };
    },
  );

  rotas.post(
    "/hub/password/remove",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Retirar a palavra-passe e o TOTP (autenticação recente). Recusa se não houver passkey. Todas as sessões caem; quem pediu recebe uma nova.",
        body: SemCorpo,
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const novo = segredoNovo("eus");
      await traduzindoConta(() =>
        sql`select palavra_passe_retirar(${sessao.segredo},
          ${resumo(novo)})`.execute(base),
      );
      porCookie(resposta, novo);
      return { ok: true as const };
    },
  );

  rotas.post(
    "/hub/session/password",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Entrar com e-mail + palavra-passe + código de seis dígitos (nunca só a palavra-passe). A mesma recusa (401) e o mesmo tempo para tudo o que falha; 5 falhas em 15 minutos do mesmo IP (ou do mesmo e-mail, para quem também falhou desse IP) dão 429.",
        body: Type.Object(
          {
            email: Type.String({ minLength: 3, maxLength: 254 }),
            palavra_passe: Type.String({ minLength: 1, maxLength: 256 }),
            codigo: CodigoTotp,
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
      // Passo 1: o limite, e a tentativa fica já registada como falha.
      const { rows } = await sql<{
        resultado: "ok" | "bloqueado";
        tentativa: string | null;
        pessoa_id: string | null;
        resumo: string | null;
        totp_cifrado: Buffer | null;
        chave_versao: number | null;
        ultimo_passo: string | null;
      }>`select * from palavra_passe_para_entrar(${corpo.email},
        ${pedido.ip}::inet)`.execute(base);
      const conta = rows[0];
      if (conta === undefined || conta.tentativa === null) {
        if (conta?.resultado === "bloqueado") throw erroConta("auth.locked");
        throw erroConta("auth.unauthenticated");
      }
      // Sem conta, o Argon2id corre na mesma, contra o resumo falso.
      const palavraCerta = await argon2(() =>
        conferirPalavraPasse(conta.resumo, corpo.palavra_passe),
      );
      if (!palavraCerta || conta.pessoa_id === null) {
        throw erroConta("auth.unauthenticated");
      }
      const segredoTotp =
        conta.totp_cifrado === null || conta.chave_versao === null
          ? null
          : abrir(
              conta.totp_cifrado,
              conta.chave_versao,
              conta.pessoa_id,
              chave,
            );
      const passo =
        segredoTotp === null
          ? null
          : await conferirCodigo(
              segredoTotp,
              corpo.codigo,
              Number(conta.ultimo_passo ?? 0),
            );
      if (passo === null) {
        // Palavra-passe certa, código errado: conta também para a conta (§8).
        await sql`select palavra_passe_codigo_errado(${conta.tentativa}::uuid,
          ${conta.pessoa_id}::uuid)`.execute(base);
        throw erroConta("auth.unauthenticated");
      }
      const antiga = pedido.cookies[COOKIE_SESSAO];
      if (antiga !== undefined && FORMATO_SESSAO.test(antiga)) {
        await sql`select sessao_terminar(${antiga})`.execute(base);
      }
      const segredo = segredoNovo("eus");
      await traduzindoConta(() =>
        sql`select entrar_com_palavra_passe(${conta.tentativa}::uuid,
          ${conta.pessoa_id}::uuid, ${passo}, ${resumo(segredo)})`.execute(
          base,
        ),
      );
      porCookie(resposta, segredo);
      return resposta
        .code(201)
        .send({ pessoa: comPrefixo("per", conta.pessoa_id) });
    },
  );
}
