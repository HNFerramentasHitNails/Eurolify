import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { idCom, semPrefixo } from "../catalogo/rotas.js";
import { chaveDo, sessaoDo } from "../identidade/autenticacao.js";
import { erroConta } from "../identidade/sessoes.js";
import {
  classificavelOss,
  documentoParaClassificar,
  classificarOss,
  ErroRelatorio,
  ESTADO_DO_CODIGO_RELATORIO,
  fecharOss,
  registosOss,
  relatorioOss,
  traduzirRelatorio,
} from "./oss.js";

// O relatório OSS (docs/37 §5; docs/06, EF). Ler é `tax:read`; fechar é
// `tax:write`, que só o dono tem (Q-O4); classificar um documento também
// (P1-A da 2.ª revisão do #392).

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
const IdDocumento = idCom("inv", "inv_…");
const Balde = Type.Union(
  [
    Type.Literal("oss"),
    Type.Literal("nacional"),
    Type.Literal("intracomunitarias"),
    Type.Literal("exportacao"),
    Type.Literal("outras_isentas"),
  ],
  { description: "O balde do relatório (docs/37 §2.1)." },
);
const Periodo = Type.String({
  pattern: "^[0-9]{4}-(T[1-4]|(0[1-9]|1[0-2]))$",
  description: "Um trimestre civil (2026-T4) ou um mês (2026-10).",
});

const CorpoFecho = Type.Object(
  {
    entidade: IdEntidade,
    periodo: Periodo,
    confirmo_por_emitir: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const CorpoClassificacao = Type.Object(
  {
    documento: IdDocumento,
    linhas: Type.Array(
      Type.Object(
        { balde: Balde, pais: Type.String({ pattern: "^[A-Z]{2}$" }) },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 500 },
    ),
    data: Type.Optional(Type.String({ format: "date" })),
    motivo: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

/** O CSV dos registos: como anexo, sem cache (têm dados pessoais). */
function enviarCsv(resposta: FastifyReply, periodo: string, csv: string) {
  return resposta
    .header("content-type", "text/csv; charset=utf-8")
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "private, no-store")
    .header(
      "content-disposition",
      `attachment; filename="registos-oss-${periodo}.csv"`,
    )
    .send(csv);
}

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
        body: CorpoFecho,
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

  rotas.post(
    "/tax-reports/oss/classifications",
    {
      config: { ambito: "tax:write" },
      schema: {
        description:
          "O dono classifica um documento que o relatório não classifica sozinho (uma fatura resolvida com as linhas da prova diferentes das do pedido, uma linha sem balde, uma prova sem data): o balde e o país de cada linha da prova, pela ordem dela; a taxa e os valores vêm sempre da prova. A data só quando a prova não a tem. Uma vez por documento; não muda.",
        body: CorpoClassificacao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () => {
        const chave = chaveDo(pedido);
        const { documento, linhas, data, motivo } = pedido.body;
        return classificarOss(
          base,
          chave.comercianteId,
          semPrefixo(documento),
          data === undefined ? { linhas, motivo } : { linhas, data, motivo },
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
      return enviarCsv(resposta, pedido.query.periodo, csv);
    },
  );

  // ------------------------------- O ecrã «Faturação» do Hub (docs/22 §30)

  /** A sessão com o âmbito pedido e, para fechar, autenticação recente. */
  const daSessao = (
    pedido: Parameters<typeof sessaoDo>[0],
    ambito: string,
    recente = false,
  ) => {
    const s = sessaoDo(pedido);
    if (!(s.ambitos as readonly string[]).includes(ambito)) {
      throw erroConta("member.role_escalation", `o papel não tem ${ambito}`);
    }
    if (recente && !s.recente) {
      throw erroConta(
        "auth.reauthentication_required",
        "autentique-se outra vez para esta operação",
      );
    }
    // Com `sessao_comerciante` o comerciante vem sempre; um vazio seria um
    // erro silencioso (revisão do #408, P3-9).
    if (s.comercianteId === null) {
      throw erroConta("auth.forbidden", "falta o comerciante");
    }
    return { comercianteId: s.comercianteId, quem: `pessoa:per_${s.pessoaId}` };
  };

  rotas.get(
    "/hub/tax-reports/oss",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pelo Hub (docs/22 §30): o relatório OSS de um período, como GET /tax-reports/oss, com `tax:read`; mais `classificavel`, os países que cada balde aceita numa classificação (a régua do servidor).",
        querystring: Type.Object(
          { entidade: IdEntidade, periodo: Periodo },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () => {
        const s = daSessao(pedido, "tax:read");
        const entidade = semPrefixo(pedido.query.entidade);
        const relatorio = await relatorioOss(
          base,
          s.comercianteId,
          entidade,
          pedido.query.periodo,
        );
        return {
          ...relatorio,
          classificavel: await classificavelOss(
            base,
            s.comercianteId,
            entidade,
          ),
        };
      }),
  );

  rotas.get(
    "/hub/tax-reports/oss/documents/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pelo Hub (docs/22 §30): o documento a classificar — o número, a data da prova, o tipo e as linhas da prova pela ordem dela (descrição, quantidade, taxa e valores), sem os dados do cliente. Com `tax:read`.",
        params: Type.Object({ id: IdDocumento }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () => {
        const s = daSessao(pedido, "tax:read");
        return documentoParaClassificar(
          base,
          s.comercianteId,
          semPrefixo(pedido.params.id),
        );
      }),
  );

  rotas.post(
    "/hub/tax-reports/oss/classifications",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pelo Hub (docs/22 §30): classificar um documento, como POST /tax-reports/oss/classifications, com `tax:write` (o dono).",
        body: CorpoClassificacao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () => {
        const s = daSessao(pedido, "tax:write");
        const { documento, linhas, data, motivo } = pedido.body;
        return classificarOss(
          base,
          s.comercianteId,
          semPrefixo(documento),
          data === undefined ? { linhas, motivo } : { linhas, data, motivo },
          s.quem,
        );
      }),
  );

  rotas.post(
    "/hub/tax-reports/oss/close",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pelo Hub (docs/22 §30): fechar um período, como POST /tax-reports/oss/close, com `tax:write` e autenticação recente; `fechado_por` é a pessoa.",
        body: CorpoFecho,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emRelatorio(resposta, async () => {
        const s = daSessao(pedido, "tax:write", true);
        return fecharOss(
          base,
          s.comercianteId,
          semPrefixo(pedido.body.entidade),
          pedido.body.periodo,
          { confirmo_por_emitir: pedido.body.confirmo_por_emitir === true },
          s.quem,
        );
      }),
  );

  rotas.get(
    "/hub/tax-reports/oss/records",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Pelo Hub (docs/22 §30): os registos do art. 63.º-C em CSV, como GET /tax-reports/oss/records, com `tax:read`. Têm dados pessoais (o NIF e o nome da fatura).",
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
      const csv = await emRelatorio(resposta, () => {
        const s = daSessao(pedido, "tax:read");
        return registosOss(
          base,
          s.comercianteId,
          semPrefixo(pedido.query.entidade),
          pedido.query.periodo,
        );
      });
      return enviarCsv(resposta, pedido.query.periodo, csv);
    },
  );
}
