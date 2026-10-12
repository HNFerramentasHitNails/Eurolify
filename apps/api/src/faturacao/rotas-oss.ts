import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { idCom, semPrefixo } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import {
  ErroRelatorio,
  ESTADO_DO_CODIGO_RELATORIO,
  fecharOss,
  registosOss,
  relatorioOss,
  traduzirRelatorio,
} from "./oss.js";

// O relatório OSS (docs/37 §5; docs/06, EE). Ler é `tax:read`; fechar é
// `tax:write`, que só o dono tem (Q-O4).

async function emRelatorio<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    const e = traduzirRelatorio(erro);
    if (e instanceof ErroRelatorio) {
      if (e.codigo === "tax_reports.retry") {
        void resposta.header("Retry-After", "1");
      }
      throw new ErroApi(
        e.codigo,
        ESTADO_DO_CODIGO_RELATORIO[e.codigo],
        e.codigo.endsWith(".not_found")
          ? { pt: "Não encontrado", en: "Not found" }
          : {
              pt: "Pedido recusado pelo relatório do IVA",
              en: "Rejected by the VAT report",
            },
        e.pormenor === undefined
          ? e.message
          : `${e.message} ${JSON.stringify(e.pormenor)}`,
      );
    }
    throw e;
  }
}

const Livre = Type.Record(Type.String(), Type.Unknown());
const IdEntidade = idCom("lgl", "lgl_…");
const Periodo = Type.String({
  pattern: "^[0-9]{4}-(T[1-4]|(0[1-9]|1[0-2]))$",
  description: "Um trimestre civil (2026-T4) ou um mês (2026-10).",
});

export function rotasDoRelatorioOss(
  rotasBase: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = rotasBase.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/tax-reports/oss",
    {
      config: { ambito: "tax:read" },
      schema: {
        description:
          "O relatório OSS de um período (docs/37): os cinco baldes por país e taxa, das faturas e notas de crédito emitidas (as NC a negativo); as alterações de períodos já fechados; à parte, as vendas emitidas fora do Eurolify, as do sistema próprio e o que está por emitir; o limiar dos 10 000 €; e o que impede o fecho. De um período fechado, a fotografia, nunca recalculada.",
        querystring: Type.Object(
          { entidade: IdEntidade, periodo: Periodo },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () =>
        relatorioOss(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.query.entidade),
          pedido.query.periodo,
        ),
      ),
  );

  rotas.post(
    "/tax-reports/oss/close",
    {
      config: { ambito: "tax:write" },
      schema: {
        description:
          "Fecha um período (só o dono): grava a fotografia dos números e os documentos que entraram, e não se reabre — o que chegar depois entra como alteração no período seguinte (Diretiva IVA, art. 369.º-G, n.º 4). Recusa com divergentes, outra moeda, documentos sem data ou um período em curso; os pedidos por emitir só com `confirmo_por_emitir`.",
        body: Type.Object(
          {
            entidade: IdEntidade,
            periodo: Periodo,
            confirmo_por_emitir: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () => {
        const chave = chaveDo(pedido);
        return fecharOss(
          base,
          chave.comercianteId,
          semPrefixo(pedido.body.entidade),
          pedido.body.periodo,
          { confirmo_por_emitir: pedido.body.confirmo_por_emitir === true },
          `chave:key_${chave.chaveId}`,
        );
      }),
  );

  rotas.get(
    "/tax-reports/oss/records",
    {
      config: { ambito: "tax:read" },
      schema: {
        description:
          "Os registos do art. 63.º-C do Reg. 282/2011 (docs/37 §4), em CSV: uma linha por linha de documento do período. Têm dados pessoais (o NIF e o nome da fatura).",
        querystring: Type.Object(
          { entidade: IdEntidade, periodo: Periodo },
          { additionalProperties: false },
        ),
        response: {
          200: {
            description: "O CSV",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const csv = await emRelatorio(resposta, () =>
        registosOss(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.query.entidade),
          pedido.query.periodo,
        ),
      );
      return resposta
        .header("content-type", "text/csv; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          `attachment; filename="registos-oss-${pedido.query.periodo}.csv"`,
        )
        .send(csv);
    },
  );
}
