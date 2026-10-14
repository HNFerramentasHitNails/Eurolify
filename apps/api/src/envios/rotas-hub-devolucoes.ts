import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import { ESTADOS_DEVOLUCAO, type BaseDados } from "../base/esquema.js";
import { semPrefixo, umDe } from "../catalogo/rotas.js";
import {
  lerDevolucao,
  LIMITE_DA_LISTA_DE_DEVOLUCOES,
  listarDevolucoes,
} from "../posvenda/repositorio.js";
import {
  emPosVenda,
  paraDevolucao,
  paraDevolucaoNaLista,
} from "../posvenda/rotas.js";
import type { ConfigEnvios } from "./adaptador.js";
import {
  anularEtiquetaDevolucao,
  ficheiroEtiquetaDevolucao,
  lerEtiquetaDevolucao,
  pedirEtiquetaDevolucao,
  servicosDaDevolucao,
} from "./devolucoes.js";
import { ferramentasDoHub } from "./rotas-hub.js";
import {
  CorpoAnularEtiquetaDevolucao,
  CorpoEtiquetaDevolucao,
  emEnvios,
  IdDevolucao,
  paraEtiquetaDevolucao,
} from "./rotas.js";

// As devoluções e a etiqueta de devolução pelo Hub (docs/36 §22.10; Diogo,
// 14/10/2026: «sim, aprovo; avança com o código»): as mesmas funções das
// rotas da chave (`/returns`), com o papel da sessão e o mesmo âmbito. Só
// leitura da devolução; a recepção, a inspecção e a decisão continuam na
// API. Quem escreve fica `pessoa:per_…`.

export function rotasDasDevolucoesNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const { daSessao, Lista } = ferramentasDoHub(base);
  const Livre = Type.Record(Type.String(), Type.Unknown());
  const quem = (pessoaId: string) => `pessoa:per_${pessoaId}`;
  const Devolucao = Type.Object({ id: IdDevolucao });

  rotas.get(
    "/hub/returns",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As devoluções pelo Hub, das mais recentes, com o filtro do estado: as 200 mais recentes (docs/36 §22.10). Sem o motivo do cliente.",
        querystring: Type.Object(
          { estado: Type.Optional(umDe(ESTADOS_DEVOLUCAO)) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            dados: Lista.properties.dados,
            limite: Type.Integer(),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => {
        const s = daSessao(pedido, resposta, "returns:read");
        return {
          dados: (
            await listarDevolucoes(
              base,
              s.comercianteId,
              pedido.query.estado === undefined
                ? {}
                : { estado: pedido.query.estado },
            )
          ).map(paraDevolucaoNaLista),
          limite: LIMITE_DA_LISTA_DE_DEVOLUCOES,
        };
      }),
  );

  rotas.get(
    "/hub/returns/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Uma devolução pelo Hub: o estado, as linhas, a transportadora e o seguimento, o prazo do reembolso e o motivo.",
        params: Devolucao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => {
        const s = daSessao(pedido, resposta, "returns:read");
        return paraDevolucao(
          await lerDevolucao(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
          ),
        );
      }),
  );

  rotas.get(
    "/hub/returns/:id/label/services",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os serviços que servem a etiqueta desta devolução, das contas prontas, com a regra de pedir; e o peso da caixa (null se uma variante não tem peso).",
        params: Devolucao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "returns:write");
        const r = await servicosDaDevolucao(
          base,
          s.comercianteId,
          semPrefixo(pedido.params.id),
          cfg,
        );
        return {
          estado: r.estado,
          peso_g: r.peso_g,
          opcoes: r.opcoes.map((o) => ({ ...o, conta: `cac_${o.conta}` })),
        };
      }),
  );

  rotas.get(
    "/hub/returns/:id/label",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "O estado da etiqueta de devolução pelo Hub (404 se ainda não tem).",
        params: Devolucao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "returns:read");
        return paraEtiquetaDevolucao(
          await lerEtiquetaDevolucao(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            quem(s.pessoaId),
          ),
        );
      }),
  );

  rotas.post(
    "/hub/returns/:id/label",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pede a etiqueta de devolução pelo Hub (returns:write), paga pela conta do comerciante. Sem resposta, fica «incerta».",
        params: Devolucao,
        body: CorpoEtiquetaDevolucao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "returns:write");
        return paraEtiquetaDevolucao(
          await pedirEtiquetaDevolucao(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            {
              conta: semPrefixo(pedido.body.conta),
              servico: pedido.body.servico,
            },
            cfg,
            quem(s.pessoaId),
          ),
        );
      }),
  );

  rotas.get(
    "/hub/returns/:id/label/file",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "O PDF da etiqueta de devolução pelo Hub, enquanto existir. Tem dados pessoais: nunca fica em cache.",
        params: Devolucao,
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
        const s = daSessao(pedido, resposta, "returns:read");
        const f = await ficheiroEtiquetaDevolucao(
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
    "/hub/returns/:id/label/void",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Anula a etiqueta de devolução pelo Hub (returns:write): quem anula confirma que a anulou no painel da transportadora, ou que a incerta não existe lá.",
        params: Devolucao,
        body: CorpoAnularEtiquetaDevolucao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const s = daSessao(pedido, resposta, "returns:write");
        return paraEtiquetaDevolucao(
          await anularEtiquetaDevolucao(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.motivo,
            quem(s.pessoaId),
          ),
        );
      }),
  );
}
