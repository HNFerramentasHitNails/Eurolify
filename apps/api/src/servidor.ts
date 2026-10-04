import { criarApp } from "./app.js";

// Por omissão só ouve dentro da máquina (ADR-0027). Dentro do contentor o
// fluxo de publicação passa ANFITRIAO=0.0.0.0 e a porta só se liga a
// 127.0.0.1 do lado da VPS.
const anfitriao = process.env["ANFITRIAO"] ?? "127.0.0.1";
const porta = Number(process.env["PORTA"] ?? "8080");

const app = criarApp({
  logger: {
    // Sem endereços IP nem cabeçalhos nos registos: são dados pessoais
    // (skill eu-gdpr-privacy, regra 7).
    serializers: {
      req: (pedido) => ({
        id: pedido.id,
        metodo: pedido.method,
        url: pedido.url,
      }),
    },
  },
});

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
