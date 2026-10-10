import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { sql } from "kysely";
import { expect } from "vitest";
import { criarApp } from "../src/app.js";
import type { Armazenamento } from "../src/catalogo/armazenamento.js";
import { serializadores } from "../src/base/registo.js";
import { configHub, resumo } from "../src/identidade/sessoes.js";
import { AutenticadorDeTeste } from "./autenticador-de-teste.js";
import type { BaseDeTeste } from "./base-de-teste.js";

// O que os testes das rotas do Hub partilham: a aplicação com o Hub ligado,
// os pedidos com cookie e Origin, e as pessoas criadas pelo convite com um
// autenticador WebAuthn em software.

export const ORIGEM = "https://hub.exemplo.test";
export const HUB = configHub(ORIGEM);
export const OPERADOR = "operador:github:1001";
export const COOKIE = "__Host-eurolify_sessao";
export const NO_HUB = { origem: ORIGEM, rpId: HUB.rpId };

export type App = ReturnType<typeof criarApp>;
export type Resposta = Awaited<ReturnType<App["inject"]>>;

export interface Pedido {
  corpo?: unknown;
  sessao?: string;
  comerciante?: string;
  origem?: string | null;
  /** O IP de quem pede; por omissão, um diferente em cada pedido. */
  ip?: string;
}

let contadorDeIp = 0;
/** Um IP de teste novo (10.x.y.z), para os limites por IP não se cruzarem. */
export function ipNovo(): string {
  contadorDeIp += 1;
  return `10.${String((contadorDeIp >> 16) & 255)}.${String((contadorDeIp >> 8) & 255)}.${String(contadorDeIp & 255)}`;
}

/** Uma chave de teste para os segredos TOTP (nunca a de um ambiente). */
export const CHAVE_TOTP = { versao: 1, chave: Buffer.alloc(32, 7) };

export function hubDeTeste(
  base: BaseDeTeste,
  opcoes: { comTotp?: boolean; armazenamento?: Armazenamento } = {},
) {
  const registo: string[] = [];
  const destino = new Writable({
    write(pedaco: Buffer, _codificacao, feito) {
      registo.push(pedaco.toString());
      feito();
    },
  });
  const app = criarApp(
    { logger: { level: "info", stream: destino, serializers: serializadores } },
    undefined,
    base.api,
    opcoes.comTotp === true ? { ...HUB, chaveTotp: CHAVE_TOTP } : HUB,
    opcoes.armazenamento,
  );

  const pedir = (
    metodo: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    p: Pedido = {},
  ) => {
    const cabecalhos: Record<string, string> = {};
    if (p.origem !== null) cabecalhos["origin"] = p.origem ?? ORIGEM;
    if (p.sessao !== undefined) cabecalhos["cookie"] = `${COOKIE}=${p.sessao}`;
    if (p.comerciante !== undefined) {
      cabecalhos["eurolify-comerciante"] = `mer_${p.comerciante}`;
    }
    const comCorpo = metodo !== "GET";
    if (comCorpo) cabecalhos["content-type"] = "application/json";
    return app.inject({
      method: metodo,
      url,
      remoteAddress: p.ip ?? ipNovo(),
      headers: cabecalhos,
      ...(comCorpo ? { payload: JSON.stringify(p.corpo ?? {}) } : {}),
    });
  };

  const codigo = (r: Resposta) => r.json<{ codigo?: string }>().codigo;

  /** O segredo do cookie da sessão numa resposta. */
  function cookieDe(r: Resposta): string {
    const valor = r.headers["set-cookie"];
    const linha = (Array.isArray(valor) ? valor : [valor ?? ""]).find((l) =>
      l.startsWith(`${COOKIE}=`),
    );
    if (linha === undefined) throw new Error("sem cookie da sessão");
    return (linha.split(";")[0] ?? "").slice(COOKIE.length + 1);
  }

  async function conviteDoOperador(
    comerciante: string,
    email: string,
    papel: string,
  ) {
    const segredo = `euc_${randomBytes(32).toString("base64url")}`;
    await sql`select convite_criar_pelo_operador(${comerciante}::uuid, ${email},
      ${papel}, ${resumo(segredo)}, ${OPERADOR})`.execute(base.dono);
    return segredo;
  }

  /** Uma pessoa nova pelo convite, com a sessão, os códigos e a passkey. */
  async function pessoaCom(
    comerciante: string,
    papel: string,
    nome = "Pessoa Teste",
  ) {
    const email = `p${randomBytes(4).toString("hex")}@exemplo.test`;
    const convite = await conviteDoOperador(comerciante, email, papel);
    const opcoes = await pedir("POST", "/hub/invitations/accept/options", {
      corpo: { convite },
    });
    expect(opcoes.statusCode, opcoes.body).toBe(200);
    const autenticador = new AutenticadorDeTeste();
    const r = await pedir("POST", "/hub/invitations/accept-new", {
      corpo: {
        convite,
        nome,
        credencial: autenticador.registar(
          opcoes.json<{ challenge: string }>().challenge,
          NO_HUB,
        ),
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = r.json<{ pessoa: string; codigos: string[] }>();
    return {
      email,
      pessoa: corpo.pessoa.slice("per_".length),
      codigos: corpo.codigos,
      sessao: cookieDe(r),
      autenticador,
    };
  }

  async function desafioDeEntrada() {
    const r = await pedir("POST", "/hub/session/options");
    expect(r.statusCode, r.body).toBe(200);
    return r.json<{ challenge: string }>().challenge;
  }

  /** Entra com o autenticador; devolve a resposta. */
  async function entrar(autenticador: AutenticadorDeTeste) {
    return pedir("POST", "/hub/session", {
      corpo: {
        credencial: autenticador.assinar(await desafioDeEntrada(), NO_HUB),
      },
    });
  }

  async function envelhecerSessao(
    segredo: string,
    coluna: string,
    intervalo: string,
  ) {
    await base.dono.transaction().execute(async (trx) => {
      await sql`alter table sessao disable trigger sessao_antes_de_gravar`.execute(
        trx,
      );
      await sql`update sessao set ${sql.ref(coluna)} = now() - ${intervalo}::interval
        where resumo = ${resumo(segredo)}`.execute(trx);
      await sql`alter table sessao enable always trigger sessao_antes_de_gravar`.execute(
        trx,
      );
    });
  }

  return {
    app,
    registo,
    pedir,
    codigo,
    cookieDe,
    conviteDoOperador,
    pessoaCom,
    desafioDeEntrada,
    entrar,
    envelhecerSessao,
  };
}
