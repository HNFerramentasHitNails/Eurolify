import { randomUUID } from "node:crypto";
import type { FastifyError } from "fastify";
import { criarApp } from "./app.js";
import { abrirBase } from "./base/ligacao.js";

// Por omissão só ouve dentro da máquina (ADR-0027). Dentro do contentor o
// fluxo de publicação passa ANFITRIAO=0.0.0.0 e a porta só se liga a
// 127.0.0.1 do lado da VPS.
const anfitriao = process.env["ANFITRIAO"] ?? "127.0.0.1";
const porta = Number(process.env["PORTA"] ?? "8080");
// A ligação do eurolify_api (docs/15 §5). Sem ela, a API arranca só com as
// rotas públicas (/health, /paises, /openapi.json): é o caso da VPS enquanto
// o api.env estiver vazio (docs/19 §6).
const urlBase = process.env["BASE_DADOS_URL"];
const base =
  urlBase === undefined || urlBase === "" ? undefined : abrirBase(urlBase);

const app = criarApp(
  {
    // Um identificador por pedido que não recomeça a cada arranque: é o
    // `instance` dos erros (revisão do #106, P3-2).
    genReqId: () => randomUUID(),
    logger: {
      // Sem endereços IP nem cabeçalhos nos registos: são dados pessoais
      // (skill eu-gdpr-privacy, regra 7).
      serializers: {
        req: (pedido) => ({
          id: pedido.id,
          metodo: pedido.method,
          url: pedido.url,
        }),
        // Do erro só o tipo, o código, a mensagem e a pilha: um erro do pg
        // traz no `detail` os valores da linha (eu-gdpr-privacy, regra 7;
        // revisão do #106, P2-6).
        err: (erro: FastifyError) => ({
          type: erro.name,
          code: erro.code,
          message: erro.message,
          stack: erro.stack ?? "",
        }),
      },
    },
  },
  undefined,
  base,
);

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, "a fechar");
    app.close().then(
      () => process.exit(0),
      (erro: unknown) => {
        app.log.error({ erro }, "erro ao fechar");
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: anfitriao, port: porta });
