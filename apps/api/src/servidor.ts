import { randomUUID } from "node:crypto";
import { criarApp } from "./app.js";
import { abrirBase } from "./base/ligacao.js";
import { proxyConfiavel } from "./base/limite.js";
import { serializadores } from "./base/registo.js";
import { chaveTotp } from "./identidade/palavra-passe.js";
import { configHub } from "./identidade/sessoes.js";

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

// A origem do Hub (docs/21 §3 e §11). Sem ela, as rotas do Hub não existem.
const origemHub = process.env["HUB_ORIGEM"]?.trim();
// A chave dos segredos TOTP (docs/21 §8): sem ela, não há palavra-passe.
const chaveTotpBase64 = process.env["TOTP_CHAVE"]?.trim();
const hub =
  origemHub === undefined || origemHub === ""
    ? undefined
    : {
        ...configHub(origemHub),
        ...(chaveTotpBase64 === undefined || chaveTotpBase64 === ""
          ? {}
          : {
              chaveTotp: chaveTotp(
                chaveTotpBase64,
                process.env["TOTP_CHAVE_VERSAO"]?.trim() || "1",
              ),
            }),
      };

// Na VPS a API corre num contentor: o que ela vê é o gateway da rede do
// Docker, não o cliente. Com o Hub ligado e sem PROXY_CONFIAVEL, todos os
// clientes contavam no mesmo IP — não arranca (revisão do #154, P1-1).
const textoProxy = process.env["PROXY_CONFIAVEL"]?.trim() ?? "";
if (hub !== undefined && textoProxy === "") {
  throw new Error(
    "PROXY_CONFIAVEL: com HUB_ORIGEM, diga o endereço do proxy visto pela API (na VPS, o gateway da rede Docker), ou «nenhum» se a API recebe os clientes directamente (docs/21 §14)",
  );
}
const trustProxy = proxyConfiavel(textoProxy);

const app = criarApp(
  {
    // Um identificador por pedido que não recomeça a cada arranque: é o
    // `instance` dos erros (revisão do #106, P3-2).
    genReqId: () => randomUUID(),
    logger: { serializers: serializadores },
    // Atrás de um proxy, o IP de quem pede vem no X-Forwarded-For, e só se
    // aceita do endereço exacto do proxy, que o reescreve (docs/21 §12 e
    // §14). Sem PROXY_CONFIAVEL, conta o IP da ligação.
    trustProxy,
  },
  undefined,
  base,
  hub,
);

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, "a fechar");
    app
      .close()
      .then(() => base?.destroy())
      .then(
        () => process.exit(0),
        (erro: unknown) => {
          app.log.error({ erro }, "erro ao fechar");
          process.exit(1);
        },
      );
  });
}

await app.listen({ host: anfitriao, port: porta });
