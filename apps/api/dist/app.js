import Fastify, {} from "fastify";
import { Type } from "typebox";
const RespostaSaude = Type.Object({ estado: Type.Literal("ok") });
/**
 * Cria a aplicação sem a pôr a ouvir, para os testes a chamarem por
 * `inject` e o `servidor.ts` a ligar à rede.
 */
export function criarApp(opcoes = {}) {
    const app = Fastify(opcoes).withTypeProvider();
    app.get("/health", { schema: { response: { 200: RespostaSaude } } }, () => ({
        estado: "ok",
    }));
    return app;
}
//# sourceMappingURL=app.js.map