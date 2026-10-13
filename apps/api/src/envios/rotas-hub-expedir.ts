import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { semPrefixo } from "../catalogo/rotas.js";
import { SemCorpo } from "../identidade/hub.js";
import {
  criarExpedicao,
  lerParaExpedir,
  listarParaExpedir,
  mudarExpedicao,
} from "../stock/repositorio.js";
import {
  CorpoMudarExpedicao,
  CorpoNovaExpedicao,
  dadosDaMudanca,
  dadosDaNovaExpedicao,
  emStock,
  IdEncomenda,
  IdExpedicao,
  paraVista,
  paraVistaComExpedicoes,
} from "../stock/rotas.js";
import type { ConfigEnvios } from "./adaptador.js";
import {
  anularEtiqueta,
  consultarSeguimento,
  ficheiroDaEtiqueta,
  lerEtiqueta,
  listarEventos,
  pedirEtiqueta,
} from "./etiquetas.js";
import { ferramentasDoHub } from "./rotas-hub.js";
import { emEnvios, paraEtiqueta, paraEvento } from "./rotas.js";

// O ecrã «Expedir» do Hub (docs/22 §32; Diogo, 13/10/2026: «sim, aprovo;
// avança com o código»): a vista do armazém, as expedições, a etiqueta e o
// seguimento, com as mesmas funções das rotas da chave (docs/27 §7.2,
// docs/36 §7.1) e o mesmo âmbito. Quem escreve fica `pessoa:per_…`.

export function rotasDeExpedirNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const { daSessao, escreverNoHub, Lista } = ferramentasDoHub(base);
  const Livre = Type.Record(Type.String(), Type.Unknown());
  const quem = (pessoaId: string) => `pessoa:per_${pessoaId}`;
  const Expedicao = Type.Object({ id: IdExpedicao });

  rotas.get(
    "/hub/fulfilment/orders",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As encomendas por expedir pelo Hub (docs/22 §32), na vista do armazém: sem perfil de faturação, NIF, e-mail nem preços. As 100 mais antigas.",
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:read");
        return {
          dados: (await listarParaExpedir(base, s.comercianteId, 100)).map(
            paraVista,
          ),
        };
      }),
  );

  rotas.get(
    "/hub/fulfilment/orders/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Uma encomenda na vista do armazém pelo Hub, com as expedições.",
        params: Type.Object({ id: IdEncomenda }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:read");
        return paraVistaComExpedicoes(
          await lerParaExpedir(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
          ),
        );
      }),
  );

  rotas.post(
    "/hub/orders/:id/shipments",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Cria uma expedição pelo Hub (fulfilment:write): as linhas e as quantidades a enviar. O servidor recusa mais do que falta.",
        params: Type.Object({ id: IdEncomenda }),
        body: CorpoNovaExpedicao,
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:write");
        const id = await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
          criarExpedicao(
            trx,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            dadosDaNovaExpedicao(pedido.body),
            quem(s.pessoaId),
          ),
        );
        void resposta.code(201);
        return { id: `shp_${id}` };
      }),
  );

  rotas.patch(
    "/hub/shipments/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Muda a expedição pelo Hub (fulfilment:write), na versão lida: expedida, entregue, devolvida, perdida, cancelada; a transportadora e o seguimento de um método manual.",
        params: Expedicao,
        body: CorpoMudarExpedicao,
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:write");
        return {
          versao: await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
            mudarExpedicao(
              trx,
              s.comercianteId,
              semPrefixo(pedido.params.id),
              pedido.body.versao,
              dadosDaMudanca(pedido.body),
              quem(s.pessoaId),
            ),
          ),
        };
      }),
  );

  rotas.post(
    "/hub/shipments/:id/label",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pede a etiqueta pelo Hub (fulfilment:write), com a conta e o serviço vendidos. Uma viva por expedição; uma incerta só se consulta.",
        params: Expedicao,
        body: SemCorpo,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:write");
        return paraEtiqueta(
          await pedirEtiqueta(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
            quem(s.pessoaId),
          ),
        );
      }),
  );

  rotas.get(
    "/hub/shipments/:id/label",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description: "O estado da etiqueta da expedição pelo Hub.",
        params: Expedicao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:read");
        return paraEtiqueta(
          await lerEtiqueta(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
          ),
        );
      }),
  );

  rotas.get(
    "/hub/shipments/:id/label/file",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "O ficheiro da etiqueta pelo Hub (PDF ou ZPL), enquanto existir. Tem dados pessoais: nunca fica em cache.",
        params: Expedicao,
        response: {
          200: {
            description: "A etiqueta",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
              "text/plain": { schema: { type: "string" } },
            },
          },
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:read");
        const f = await ficheiroDaEtiqueta(
          base,
          s.comercianteId,
          semPrefixo(pedido.params.id),
        );
        return resposta
          .header(
            "content-type",
            f.formato === "pdf" ? "application/pdf" : "text/plain",
          )
          .header("x-content-type-options", "nosniff")
          .send(f.conteudo);
      }),
  );

  rotas.post(
    "/hub/shipments/:id/label/void",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Anula a etiqueta pelo Hub (fulfilment:write), se a transportadora deixar; o ficheiro apaga-se.",
        params: Expedicao,
        body: SemCorpo,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:write");
        return paraEtiqueta(
          await anularEtiqueta(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
            quem(s.pessoaId),
          ),
        );
      }),
  );

  rotas.get(
    "/hub/shipments/:id/events",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os eventos de seguimento da expedição pelo Hub, pela data da transportadora.",
        params: Expedicao,
        response: { 200: Lista, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:read");
        return {
          dados: (
            await listarEventos(
              base,
              s.comercianteId,
              semPrefixo(pedido.params.id),
            )
          ).map(paraEvento),
        };
      }),
  );

  rotas.post(
    "/hub/shipments/:id/refresh",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Consulta a transportadora pelo Hub (fulfilment:write): resolve uma etiqueta incerta e lê o seguimento.",
        params: Expedicao,
        body: SemCorpo,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "fulfilment:write");
        const id = semPrefixo(pedido.params.id);
        const novos = await consultarSeguimento(
          base,
          s.comercianteId,
          id,
          cfg,
          quem(s.pessoaId),
        );
        return {
          ...paraEtiqueta(await lerEtiqueta(base, s.comercianteId, id)),
          novos,
        };
      }),
  );
}
