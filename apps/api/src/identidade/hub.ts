import type { FastifyInstance, FastifyReply } from "fastify";
import { comRastoNaBase } from "../base/rasto.js";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { sessaoDo } from "./autenticacao.js";
import { AMBITOS, type Ambito } from "./chaves.js";
import { emailAceiteNoConviteDoHub } from "./dominios-de-ensaio.js";
import { PAPEIS } from "./papeis.js";
import {
  COOKIE_SESSAO,
  erroConta,
  FORMATO_CONVITE,
  FORMATO_SESSAO,
  IDADE_MAXIMA_COOKIE,
  OPCOES_COOKIE,
  resumo,
  segredoNovo,
  traduzindoConta,
  type ConfigHub,
} from "./sessoes.js";

// Rotas do Hub da parte B2 (docs/21 §11): entrar com passkey, sair,
// reautenticar, aceitar convites e gerir a equipa. A assinatura WebAuthn
// verifica-se aqui (@simplewebauthn/server); o desafio de uso único, o
// contador, a sessão, os convites e os papéis decide-os a base (0018, 0020).
// Os segredos (sessão, convite) só andam no cookie e no corpo, nunca no
// caminho nem na consulta, e nunca vão para o registo.
//
// Sem Idempotency-Key nestas rotas (proposta, docs/21 §11): são do Hub, não
// da API de integração, e repetir um pedido não duplica nada que importe —
// entrar dá outra sessão, os convites e as mudanças de papel recusam a
// repetição.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Os desafios valem 5 minutos na base (0020); o navegador espera o mesmo. */
export const TEMPO_WEBAUTHN = 5 * 60 * 1000;

const Papel = Type.Union(PAPEIS.map((p) => Type.Literal(p)));
const Instante = Type.String({ format: "date-time" });

export const OpcoesWebAuthn = Type.Object(
  {},
  {
    additionalProperties: true,
    description:
      "Opções WebAuthn (PublicKeyCredentialCreationOptionsJSON ou RequestOptionsJSON) para o navegador.",
  },
);

// A resposta da passkey, como o navegador a dá (PublicKeyCredential.toJSON()).
// A biblioteca valida o conteúdo; aqui só a forma e o tamanho.
// Os campos que a API lê têm tamanho e forma limitados (revisão do #142,
// P2-4); os outros que o navegador mande ficam de fora da base.
const Base64Url = (maximo: number) =>
  Type.String({ maxLength: maximo, pattern: "^[A-Za-z0-9_-]*$" });
const TRANSPORTES = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
] as const;
export const Credencial = Type.Object(
  {
    id: Type.String({
      minLength: 16,
      maxLength: 1366,
      pattern: "^[A-Za-z0-9_-]+$",
    }),
    rawId: Type.String({
      minLength: 16,
      maxLength: 1366,
      pattern: "^[A-Za-z0-9_-]+$",
    }),
    type: Type.Literal("public-key"),
    response: Type.Object(
      {
        clientDataJSON: Base64Url(4096),
        attestationObject: Type.Optional(Base64Url(16384)),
        authenticatorData: Type.Optional(Base64Url(4096)),
        signature: Type.Optional(Base64Url(1024)),
        userHandle: Type.Optional(Base64Url(128)),
        transports: Type.Optional(
          Type.Array(Type.Union(TRANSPORTES.map((t) => Type.Literal(t))), {
            maxItems: 10,
          }),
        ),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);

const SegredoConvite = Type.String({
  pattern: FORMATO_CONVITE.source,
  description: "O segredo da ligação do convite (euc_…)",
});

const RespostaEntrada = Type.Object({
  pessoa: Type.String({ description: "per_…" }),
});

export const CodigosRecuperacao = Type.Array(Type.String(), {
  minItems: 10,
  maxItems: 10,
  description:
    "Os 10 códigos de recuperação (XXXX-XXXX-XXXX-XXXX). Só aparecem nesta resposta: guarde-os já.",
});

const RespostaConta = Type.Object({
  pessoa: Type.String({ description: "per_…" }),
  comerciante: Type.String({ description: "mer_…" }),
  codigos: CodigosRecuperacao,
});

const RespostaEu = Type.Object({
  pessoa: Type.String({ description: "per_…" }),
  nome: Type.String(),
  email: Type.String(),
  palavra_passe: Type.Optional(
    Type.Union(
      [Type.Literal("activa"), Type.Literal("pendente"), Type.Null()],
      {
        description:
          "A palavra-passe com o TOTP: activa, à espera do primeiro código, ou nenhuma (null). Só existe quando a API tem a palavra-passe ligada (TOTP_CHAVE).",
      },
    ),
  ),
  comerciantes: Type.Array(
    Type.Object({
      comerciante: Type.String({ description: "mer_…" }),
      nome: Type.String(),
      papel: Papel,
      membro: Type.String({ description: "mbr_…" }),
      ambitos: Type.Array(Type.Union(AMBITOS.map((a) => Type.Literal(a))), {
        description:
          "Os âmbitos do papel neste comerciante, lidos da base (papel_ambitos): o que o Hub oferece; o servidor confere na mesma em cada pedido (docs/22 §13.2).",
      }),
    }),
  ),
});

/**
 * Os âmbitos que esta versão da API conhece, pela ordem da base. Um âmbito
 * novo, acrescentado aos papéis por uma migração que corre antes de a API
 * mudar (eurolify-publicar), não pode fazer o /hub/me dar 500 à API
 * anterior: fica de fora, e o ecrã só esconde um botão (o servidor confere
 * na mesma em cada pedido). Sem a 0033, uma lista vazia (revisão do #212,
 * P1-1 e P3-2).
 */
export function ambitosConhecidos(
  ambitos: readonly string[] | null | undefined,
): Ambito[] {
  return (ambitos ?? []).filter((a): a is Ambito =>
    (AMBITOS as readonly string[]).includes(a),
  );
}

const RespostaMembros = Type.Object({
  membros: Type.Array(
    Type.Object({
      membro: Type.String({ description: "mbr_…" }),
      pessoa: Type.String({ description: "per_…" }),
      nome: Type.String(),
      email: Type.String(),
      papel: Papel,
      desde: Instante,
    }),
  ),
  convites: Type.Union([
    Type.Array(
      Type.Object({
        convite: Type.String({ description: "inv_…" }),
        email: Type.String(),
        papel: Papel,
        criado_em: Instante,
        expira_em: Instante,
      }),
    ),
    Type.Null(),
  ]),
});

export const RespostaOk = Type.Object({ ok: Type.Literal(true) });

const CabecalhoComerciante = Type.Object({
  "eurolify-comerciante": Type.String({
    pattern: `^mer_${UUID}$`,
    description: "O comerciante do pedido (mer_…), escolhido no Hub",
  }),
});

const ParametroConvite = Type.Object({
  id: Type.String({ pattern: `^inv_${UUID}$`, description: "inv_…" }),
});
const ParametroMembro = Type.Object({
  id: Type.String({ pattern: `^mbr_${UUID}$`, description: "mbr_…" }),
});

export const SemCorpo = Type.Object({}, { additionalProperties: false });

/** O desafio que o navegador assinou, lido do clientDataJSON. */
export function desafioDe(credencial: {
  response: { clientDataJSON: string };
}) {
  try {
    const dados = JSON.parse(
      Buffer.from(credencial.response.clientDataJSON, "base64url").toString(
        "utf8",
      ),
    ) as { challenge?: unknown; crossOrigin?: unknown };
    // O Hub nunca corre dentro de uma moldura de outro site (revisão do #142,
    // P3-1): uma resposta de outra origem de topo recusa-se aqui.
    if (dados.crossOrigin === true) throw erroConta("auth.unauthenticated");
    if (
      typeof dados.challenge === "string" &&
      /^[A-Za-z0-9_-]{16,128}$/.test(dados.challenge)
    ) {
      return dados.challenge;
    }
  } catch {
    // cai no erro abaixo
  }
  throw erroConta("auth.unauthenticated");
}

export const comPrefixo = (prefixo: string, id: string) => `${prefixo}_${id}`;

/** Verifica o registo de uma passkey nova; devolve o desafio e a credencial. */
export async function verificarRegisto(credencial: unknown, hub: ConfigHub) {
  const registo = credencial as RegistrationResponseJSON;
  const desafio = desafioDe(registo);
  let verificado;
  try {
    verificado = await verifyRegistrationResponse({
      response: registo,
      expectedChallenge: desafio,
      expectedOrigin: hub.origem,
      expectedRPID: hub.rpId,
      requireUserVerification: true,
    });
  } catch {
    // A mensagem da biblioteca traz o desafio e a origem (P-T5).
    throw erroConta("auth.unauthenticated");
  }
  if (!verificado.verified) throw erroConta("auth.unauthenticated");
  return { desafio, credencial: verificado.registrationInfo.credential };
}

/** As opções WebAuthn de registo de uma passkey (detectável, verificada). */
export function opcoesDeRegisto(
  hub: ConfigHub,
  email: string,
  desafio: string,
  excluir: string[] = [],
) {
  return generateRegistrationOptions({
    rpName: "Eurolify",
    rpID: hub.rpId,
    userName: email,
    challenge: Buffer.from(desafio, "base64url"),
    timeout: TEMPO_WEBAUTHN,
    attestationType: "none",
    excludeCredentials: excluir.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
}

/** Um desafio novo de 32 bytes, em base64url (como o da biblioteca). */
export const desafioNovo = () => randomBytes(32).toString("base64url");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 10 códigos de recuperação de 80 bits, `XXXX-XXXX-XXXX-XXXX` (§7). */
export function codigosNovos(): { codigos: string[]; resumos: string[] } {
  const codigos = Array.from({ length: 10 }, () => {
    const bytes = randomBytes(10);
    let bits = 0;
    let valor = 0;
    let texto = "";
    for (const byte of bytes) {
      valor = (valor << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        texto += BASE32.charAt((valor >>> (bits - 5)) & 31);
        bits -= 5;
      }
    }
    return texto.match(/.{4}/g)?.join("-") ?? texto;
  });
  return { codigos, resumos: codigos.map(resumoDoCodigo) };
}

/**
 * O resumo de um código, sem traços, espaços nem minúsculas. Os algarismos
 * que se confundem com letras do alfabeto (0, 1, 8) lêem-se como O, I e B
 * (revisão do #144, P3-4).
 */
export const resumoDoCodigo = (codigo: string) =>
  resumo(
    codigo
      .toUpperCase()
      .replace(/0/g, "O")
      .replace(/1/g, "I")
      .replace(/8/g, "B")
      .replace(/[^A-Z2-7]/g, ""),
  );

export function porCookie(resposta: FastifyReply, segredo: string) {
  void resposta.setCookie(COOKIE_SESSAO, segredo, {
    ...OPCOES_COOKIE,
    maxAge: IDADE_MAXIMA_COOKIE,
  });
}

export function rotasDoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  hub: ConfigHub,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  /** Revoga a sessão de um cookie, se o houver e tiver o formato. */
  async function terminarSessaoDoCookie(segredo: string | undefined) {
    if (segredo === undefined || !FORMATO_SESSAO.test(segredo)) return;
    await sql`select sessao_terminar(${segredo})`.execute(base);
  }

  /**
   * Num convite, um comerciante suspenso ou fechado dá o mesmo erro que um
   * convite que não vale (docs/21 §11; revisão do #142, P3-5).
   */
  async function noConvite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await traduzindoConta(fn);
    } catch (erro) {
      if (
        erro instanceof ErroApi &&
        erro.codigo === "member.merchant_inactive"
      ) {
        throw erroConta("invite.invalid");
      }
      throw erro;
    }
  }

  /** Verifica uma passkey de entrada; devolve a passkey e o contador novo. */
  async function verificarEntrada(credencial: unknown) {
    const resposta = credencial as AuthenticationResponseJSON;
    const desafio = desafioDe(resposta);
    const { rows } = await sql<{
      passkey_id: string;
      pessoa_id: string;
      chave_publica: Buffer;
      contador: string;
      transportes: string[];
    }>`select * from passkey_para_entrar(${resposta.id})`.execute(base);
    const passkey = rows[0];
    if (passkey === undefined) throw erroConta("auth.unauthenticated");
    let verificada;
    try {
      verificada = await verifyAuthenticationResponse({
        response: resposta,
        expectedChallenge: desafio,
        expectedOrigin: hub.origem,
        expectedRPID: hub.rpId,
        requireUserVerification: true,
        credential: {
          id: resposta.id,
          publicKey: new Uint8Array(passkey.chave_publica),
          counter: Number(passkey.contador),
          transports: passkey.transportes,
        },
      });
    } catch {
      // A mensagem da biblioteca traz o desafio e a origem: não vai para o
      // registo nem para a resposta (P-T5).
      throw erroConta("auth.unauthenticated");
    }
    if (!verificada.verified) throw erroConta("auth.unauthenticated");
    return {
      desafio: resumo(desafio),
      passkeyId: passkey.passkey_id,
      contador: verificada.authenticationInfo.newCounter,
    };
  }

  rotas.post(
    "/hub/session/options",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Opções WebAuthn para entrar com uma passkey (credenciais detectáveis, sem e-mail). O desafio vale uma vez, 5 minutos.",
        body: SemCorpo,
        response: { 200: OpcoesWebAuthn, ...RESPOSTA_DE_ERRO },
      },
    },
    async () => {
      const opcoes = await generateAuthenticationOptions({
        rpID: hub.rpId,
        userVerification: "required",
        timeout: TEMPO_WEBAUTHN,
      });
      await sql`select desafio_criar_entrada(${resumo(opcoes.challenge)})`.execute(
        base,
      );
      return opcoes;
    },
  );

  rotas.post(
    "/hub/session",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Entrar com uma passkey. Cria uma sessão nova (cookie __Host-eurolify_sessao). O mesmo 401 para passkey desconhecida, de pessoa desactivada ou que não verifica.",
        body: Type.Object(
          { credencial: Credencial },
          { additionalProperties: false },
        ),
        response: { 201: RespostaEntrada, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const v = await verificarEntrada(pedido.body.credencial);
      // Num computador partilhado, a sessão que estava no cookie acaba
      // (revisão do #142, P3-4).
      await terminarSessaoDoCookie(pedido.cookies[COOKIE_SESSAO]);
      const segredo = segredoNovo("eus");
      const pessoa = await traduzindoConta(async () => {
        await sql`select entrar_com_passkey(${v.desafio}, ${v.passkeyId}::uuid,
          ${v.contador}, ${resumo(segredo)}, ${pedido.ip}::inet)`.execute(base);
        const { rows } = await sql<{ pessoa_id: string }>`
          select pessoa_id from sessao_verificar(${segredo})`.execute(base);
        const id = rows[0]?.pessoa_id;
        if (id === undefined) throw erroConta("auth.unauthenticated");
        return id;
      });
      porCookie(resposta, segredo);
      return resposta.code(201).send({ pessoa: comPrefixo("per", pessoa) });
    },
  );

  rotas.post(
    "/hub/session/reauthenticate",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Autenticação recente (10 minutos) com uma passkey da mesma pessoa, com o desafio de /hub/session/options. A sessão é trocada por outra, com segredo novo.",
        body: Type.Object(
          { credencial: Credencial },
          { additionalProperties: false },
        ),
        response: { 200: RespostaEntrada, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const v = await verificarEntrada(pedido.body.credencial);
      const segredo = segredoNovo("eus");
      await traduzindoConta(() =>
        sql`select reautenticar_com_passkey(${v.desafio}, ${sessao.segredo},
          ${v.passkeyId}::uuid, ${v.contador}, ${resumo(segredo)})`.execute(
          base,
        ),
      );
      porCookie(resposta, segredo);
      return { pessoa: comPrefixo("per", sessao.pessoaId) };
    },
  );

  rotas.post(
    "/hub/session/end",
    {
      // Pública: sair apaga o cookie mesmo com a sessão já expirada
      // (revisão do #142, P3-4).
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Sair: a sessão do cookie, se ainda valer, é revogada; o cookie é sempre apagado.",
        body: SemCorpo,
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      await terminarSessaoDoCookie(pedido.cookies[COOKIE_SESSAO]);
      void resposta.clearCookie(COOKIE_SESSAO, OPCOES_COOKIE);
      return { ok: true as const };
    },
  );

  rotas.get(
    "/hub/me",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "A pessoa da sessão e os comerciantes de que é membro activo, com o papel e os âmbitos dele.",
        response: { 200: RespostaEu, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const eu = await traduzindoConta(async () => {
        const { rows } = await sql<{
          eu: {
            pessoa: string;
            nome: string;
            email: string;
            palavra_passe: "activa" | "pendente" | null;
            comerciantes: {
              comerciante: string;
              nome: string;
              papel: (typeof PAPEIS)[number];
              membro: string;
              ambitos?: string[] | null;
            }[];
          };
        }>`select pessoa_eu(${sessao.segredo}) as eu`.execute(base);
        const linha = rows[0]?.eu;
        if (linha === undefined) throw erroConta("auth.unauthenticated");
        return linha;
      });
      return {
        pessoa: comPrefixo("per", eu.pessoa),
        nome: eu.nome,
        email: eu.email,
        // Sem a chave TOTP não há palavra-passe: o campo não aparece, e o
        // Hub não a oferece (docs/22 §9.2).
        ...(hub.chaveTotp === undefined
          ? {}
          : { palavra_passe: eu.palavra_passe }),
        comerciantes: eu.comerciantes.map((c) => ({
          comerciante: comPrefixo("mer", c.comerciante),
          nome: c.nome,
          papel: c.papel,
          membro: comPrefixo("mbr", c.membro),
          ambitos: ambitosConhecidos(c.ambitos),
        })),
      };
    },
  );

  rotas.post(
    "/hub/invitations/preview",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "O que o convite diz, para o ecrã o mostrar antes de aceitar: o comerciante, o papel, o e-mail e quando expira. Para qualquer convite que não vale, também com o comerciante suspenso ou fechado, a mesma recusa de /hub/invitations/accept/options e /hub/invitations/accept-new (404 invite.invalid; issue #194).",
        body: Type.Object(
          { convite: SegredoConvite },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            comerciante_nome: Type.String(),
            papel: Papel,
            email: Type.String(),
            expira_em: Instante,
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      // O e-mail e o nome do comerciante não ficam em nenhuma cache
      // (revisão do #196, P3-7).
      void resposta.header("cache-control", "no-store");
      const linha = await noConvite(async () => {
        const { rows } = await sql<{
          comerciante_nome: string;
          papel: (typeof PAPEIS)[number];
          email: string;
          expira_em: string;
        }>`select * from convite_ver(${pedido.body.convite})`.execute(base);
        const r = rows[0];
        if (r === undefined) throw erroConta("invite.invalid");
        return r;
      });
      return {
        comerciante_nome: linha.comerciante_nome,
        papel: linha.papel,
        email: linha.email,
        expira_em: new Date(linha.expira_em).toISOString(),
      };
    },
  );

  rotas.post(
    "/hub/invitations/accept/options",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Opções WebAuthn para criar a conta a partir de um convite (registo de uma passkey). O desafio fica preso ao convite e vale uma vez, 5 minutos.",
        body: Type.Object(
          { convite: SegredoConvite },
          { additionalProperties: false },
        ),
        response: { 200: OpcoesWebAuthn, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const convite = pedido.body.convite;
      // O desafio gera-se antes de se saber o e-mail; guarda-se com o
      // convite e as opções completam-se com o e-mail dele. O identificador
      // do utilizador no WebAuthn é aleatório: a passkey encontra-se pelo
      // identificador da credencial, nunca por ele.
      const provisorio = await generateRegistrationOptions({
        rpName: "Eurolify",
        rpID: hub.rpId,
        userName: "convite",
      });
      const email = await noConvite(async () => {
        const { rows } = await sql<{ email: string }>`
          select email from desafio_criar_registo(
            ${resumo(provisorio.challenge)}, ${convite})`.execute(base);
        const valor = rows[0]?.email;
        if (valor === undefined) throw erroConta("invite.invalid");
        return valor;
      });
      return opcoesDeRegisto(hub, email, provisorio.challenge);
    },
  );

  rotas.post(
    "/hub/invitations/accept-new",
    {
      config: { ambito: "publico", hub: true },
      schema: {
        description:
          "Aceitar um convite criando a conta: a pessoa, o membro, a passkey e a sessão nascem na mesma transacção. Para um e-mail que já tem conta, 409 invite.account_exists: entre e use /hub/invitations/accept.",
        body: Type.Object(
          {
            convite: SegredoConvite,
            nome: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
            nome_passkey: Type.Optional(
              Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
            ),
            credencial: Credencial,
          },
          { additionalProperties: false },
        ),
        response: { 201: RespostaConta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const corpo = pedido.body;
      const { desafio, credencial } = await verificarRegisto(
        corpo.credencial,
        hub,
      );
      await terminarSessaoDoCookie(pedido.cookies[COOKIE_SESSAO]);
      const segredo = segredoNovo("eus");
      const { codigos, resumos } = codigosNovos();
      const conta = await noConvite(async () => {
        const { rows } = await comRastoNaBase(base, (trx) =>
          sql<{
            pessoa_id: string;
            comerciante_id: string;
          }>`select * from conta_nova_com_passkey(${resumo(desafio)},
          ${corpo.convite}, ${corpo.nome}, ${credencial.id},
          ${Buffer.from(credencial.publicKey)}, ${credencial.counter},
          ${credencial.transports ?? []}::text[],
          ${corpo.nome_passkey ?? null}, ${resumo(segredo)},
          ${resumos}::text[], ${pedido.ip}::inet)`.execute(trx),
        );
        const linha = rows[0];
        if (linha === undefined) throw erroConta("invite.invalid");
        return linha;
      });
      porCookie(resposta, segredo);
      // Os códigos de recuperação não ficam em nenhuma cache.
      void resposta.header("cache-control", "no-store");
      return resposta.code(201).send({
        pessoa: comPrefixo("per", conta.pessoa_id),
        comerciante: comPrefixo("mer", conta.comerciante_id),
        codigos,
      });
    },
  );

  rotas.post(
    "/hub/invitations/accept",
    {
      config: { ambito: "sessao", hub: true },
      schema: {
        description:
          "Aceitar um convite com a conta da sessão (o e-mail do convite tem de ser o da pessoa), com autenticação recente.",
        body: Type.Object(
          { convite: SegredoConvite },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            comerciante: Type.String({ description: "mer_…" }),
            membro: Type.String({ description: "mbr_…" }),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const linha = await traduzindoConta(async () => {
        const { rows } = await comRastoNaBase(base, (trx) =>
          sql<{
            comerciante_id: string;
            membro_id: string;
          }>`select * from convite_aceitar(${pedido.body.convite}, ${sessao.segredo})`.execute(
            trx,
          ),
        );
        const r = rows[0];
        if (r === undefined) throw erroConta("invite.invalid");
        return r;
      });
      return {
        comerciante: comPrefixo("mer", linha.comerciante_id),
        membro: comPrefixo("mbr", linha.membro_id),
      };
    },
  );

  rotas.get(
    "/hub/members",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os membros activos do comerciante; o dono vê também os convites em aberto (para os outros papéis, `convites` é null).",
        headers: CabecalhoComerciante,
        response: { 200: RespostaMembros, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const lista = await traduzindoConta(() =>
        comComerciante(base, sessao.comercianteId ?? "", async (trx) => {
          const { rows } = await sql<{
            lista: {
              membros: {
                membro: string;
                pessoa: string;
                nome: string;
                email: string;
                papel: (typeof PAPEIS)[number];
                desde: string;
              }[];
              convites:
                | {
                    convite: string;
                    email: string;
                    papel: (typeof PAPEIS)[number];
                    criado_em: string;
                    expira_em: string;
                  }[]
                | null;
            };
          }>`select membros_listar(${sessao.segredo}) as lista`.execute(trx);
          const r = rows[0]?.lista;
          if (r === undefined) throw erroConta("auth.forbidden");
          return r;
        }),
      );
      const instante = (t: string) => new Date(t).toISOString();
      return {
        membros: lista.membros.map((m) => ({
          membro: comPrefixo("mbr", m.membro),
          pessoa: comPrefixo("per", m.pessoa),
          nome: m.nome,
          email: m.email,
          papel: m.papel,
          desde: instante(m.desde),
        })),
        convites:
          lista.convites === null
            ? null
            : lista.convites.map((c) => ({
                convite: comPrefixo("inv", c.convite),
                email: c.email,
                papel: c.papel,
                criado_em: instante(c.criado_em),
                expira_em: instante(c.expira_em),
              })),
      };
    },
  );

  rotas.post(
    "/hub/invitations",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Convidar (com autenticação recente): o dono com qualquer papel, o gestor só armazém ou apoio. O segredo da ligação só aparece nesta resposta; o dono envia-a (CB). Vale uma vez, 7 dias. No ensaio, só endereços de domínios de teste ou de @eurolify.eu (422 invite.email_not_allowed; rede temporária até à migração para Paris, ADR-0019).",
        headers: CabecalhoComerciante,
        body: Type.Object(
          {
            email: Type.String({ minLength: 3, maxLength: 254 }),
            papel: Papel,
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({
            convite: Type.String({ description: "inv_…" }),
            segredo: Type.String({
              description: "O segredo da ligação (euc_…). Só aparece aqui.",
            }),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      // Antes de tudo: um endereço de alguém nunca chega à base do ensaio
      // (dominios-de-ensaio.ts; ADR-0019).
      if (!emailAceiteNoConviteDoHub(pedido.body.email)) {
        throw erroConta("invite.email_not_allowed");
      }
      const segredo = segredoNovo("euc");
      const id = await traduzindoConta(() =>
        comComerciante(base, sessao.comercianteId ?? "", async (trx) => {
          const { rows } = await sql<{ id: string }>`
            select convite_criar(${sessao.segredo}, ${pedido.body.email},
              ${pedido.body.papel}, ${resumo(segredo)}) as id`.execute(trx);
          const r = rows[0]?.id;
          if (r === undefined) throw new Error("a base não devolveu o convite");
          return r;
        }),
      );
      return resposta
        .code(201)
        .send({ convite: comPrefixo("inv", id), segredo });
    },
  );

  rotas.post(
    "/hub/invitations/:id/cancel",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description: "Cancelar um convite em aberto (só o dono).",
        headers: CabecalhoComerciante,
        params: ParametroConvite,
        body: SemCorpo,
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const id = pedido.params.id.slice("inv_".length);
      await traduzindoConta(() =>
        comComerciante(base, sessao.comercianteId ?? "", (trx) =>
          sql`select convite_cancelar(${sessao.segredo}, ${id}::uuid)`.execute(
            trx,
          ),
        ),
      );
      return { ok: true as const };
    },
  );

  rotas.post(
    "/hub/members/:id/role",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Mudar o papel de um membro (só o dono, com autenticação recente; nunca o seu). Vale no pedido seguinte.",
        headers: CabecalhoComerciante,
        params: ParametroMembro,
        body: Type.Object({ papel: Papel }, { additionalProperties: false }),
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const id = pedido.params.id.slice("mbr_".length);
      await traduzindoConta(() =>
        comComerciante(base, sessao.comercianteId ?? "", (trx) =>
          sql`select membro_mudar_papel(${sessao.segredo}, ${id}::uuid,
            ${pedido.body.papel})`.execute(trx),
        ),
      );
      return { ok: true as const };
    },
  );

  rotas.post(
    "/hub/members/:id/end",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Tirar um membro da equipa: cada um sai por si; tirar outro é do dono, com autenticação recente. Nunca o último dono. Os convites e as chaves que a pessoa criou neste comerciante fecham-se.",
        headers: CabecalhoComerciante,
        params: ParametroMembro,
        body: SemCorpo,
        response: { 200: RespostaOk, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const id = pedido.params.id.slice("mbr_".length);
      await traduzindoConta(() =>
        comComerciante(base, sessao.comercianteId ?? "", (trx) =>
          sql`select membro_terminar(${sessao.segredo}, ${id}::uuid)`.execute(
            trx,
          ),
        ),
      );
      return { ok: true as const };
    },
  );
}
