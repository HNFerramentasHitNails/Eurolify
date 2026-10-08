import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  DOMINIOS_EXPORTAVEIS,
  FORMATO_DO_CATALOGO,
  type BaseDados,
} from "../base/esquema.js";
import type { ArmazenamentoDeExportacoes } from "../catalogo/armazenamento.js";
import { noCatalogo } from "../catalogo/erros.js";
import { escreverCatalogo, lerCatalogo } from "../catalogo/exportacao.js";
import {
  ConsultaPagina,
  escrever,
  idCom,
  Instante,
  Lista,
  noCatalogoApi,
  semPrefixo,
} from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import {
  CabecalhoIdempotencia,
  chaveDeIdempotencia,
} from "../identidade/rotas.js";
import { EscritorZip, ErroZipGrandeDemais } from "./zip.js";

// As exportações dos dados do comerciante (docs/14 §3.11, «Exportação do
// catálogo»; docs/15 §7; docs/06, CS; issue #77). Diogo, 08/10/2026: «sim,
// aprovo; avança com o código da exportação». Um recurso comum aos
// domínios; hoje só o catálogo. O ZIP faz-se dentro do pedido, a partir de
// uma leitura de um momento só, e descarrega-se depois sem a base aberta.

const Dominio = Type.Unsafe<(typeof DOMINIOS_EXPORTAVEIS)[number]>({
  type: "string",
  enum: [...DOMINIOS_EXPORTAVEIS],
});

const PedidoExportar = Type.Object(
  {
    dominios: Type.Array(Dominio, {
      minItems: 1,
      uniqueItems: true,
      description: "O que a exportação leva; hoje só `catalogo`",
    }),
  },
  { additionalProperties: false },
);

const ExportacaoEsquema = Type.Object({
  id: Type.String({ description: "exp_…" }),
  estado: Type.Unsafe<"pronta">({ type: "string", enum: ["pronta"] }),
  dominios: Type.Array(Dominio),
  formato: Type.String({ description: "eurolify.catalogo/1" }),
  bytes: Type.Integer({ minimum: 1 }),
  resumo: Type.String({ description: "SHA-256 do ZIP, em hexadecimal" }),
  criada_em: Instante,
  expira_em: Instante,
  expirada: Type.Boolean({
    description: "Depois de `expira_em` o ZIP já não se descarrega (410)",
  }),
});

const ParametroExportacao = Type.Object({ id: idCom("exp", "exp_…") });

interface LinhaExportacao {
  id: string;
  estado: "pronta";
  dominios: (typeof DOMINIOS_EXPORTAVEIS)[number][];
  formato: string;
  bytes: string;
  resumo: string;
  criada_em: Date;
  expira_em: Date;
}

const COLUNAS = [
  "id",
  "estado",
  "dominios",
  "formato",
  "bytes",
  "resumo",
  "criada_em",
  "expira_em",
] as const;

const paraExportacao = (e: LinhaExportacao, agora: Date) => ({
  id: `exp_${e.id}`,
  estado: e.estado,
  dominios: e.dominios,
  formato: e.formato,
  bytes: Number(e.bytes),
  resumo: e.resumo,
  criada_em: e.criada_em.toISOString(),
  expira_em: e.expira_em.toISOString(),
  expirada: e.expira_em <= agora,
});

const naoExiste = (id: string) =>
  new ErroApi(
    "export.not_found",
    404,
    { pt: "Exportação não encontrada", en: "Export not found" },
    `exportação ${id}`,
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O cursor da lista: o id da última da página, em base64url (opaco). */
const cursorDe = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function idDoCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID.test(id)) {
    throw erroBase("request.invalid", "cursor inválido");
  }
  return id;
}

/** O resumo SHA-256 de um ficheiro, lido aos bocados. */
async function resumoDoFicheiro(caminho: string): Promise<string> {
  const f = await open(caminho, "r");
  try {
    const h = createHash("sha256");
    for await (const bocado of f.createReadStream({ autoClose: false })) {
      h.update(bocado as Buffer);
    }
    return h.digest("hex");
  } finally {
    await f.close();
  }
}

export function rotasDasExportacoes(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  armazenamento: ArmazenamentoDeExportacoes,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  // Uma exportação de cada vez por comerciante (**proposta**, docs/14
  // §3.11): o ZIP ocupa disco e a leitura ocupa uma ligação à base. Contada
  // neste processo (a API corre num só, na VPS).
  const emCurso = new Set<string>();

  rotas.post(
    "/exports",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Exporta os dados do comerciante num ZIP (docs/14 §3.11): hoje só o catálogo (`catalogo`), com catalogo.json (o ficheiro completo), um CSV por entidade e as imagens, em todos os estados, sem quem fez cada coisa nem preços. O ZIP faz-se dentro do pedido, a partir de um só momento; responde 201 com a exportação pronta, que se descarrega em GET /exports/{id}/file durante 7 dias. Uma de cada vez por comerciante (a segunda ao mesmo tempo dá 429). Sem custo.",
        headers: CabecalhoIdempotencia,
        body: PedidoExportar,
        response: { 201: ExportacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      // A chave de idempotência confere-se antes de fazer o ZIP: sem ela, o
      // trabalho era deitado fora.
      if (chaveDeIdempotencia(pedido) === undefined) {
        throw erroBase("idempotency.key_required");
      }
      if (emCurso.has(comercianteId)) {
        void resposta.header("Retry-After", "5");
        throw erroBase(
          "rate_limit.exceeded",
          "já há uma exportação em curso para este comerciante",
        );
      }
      emCurso.add(comercianteId);
      let temporario: string | undefined;
      try {
        const geradoEm = new Date();
        const lido = await noCatalogoApi(resposta, () =>
          lerCatalogo(base, comercianteId, geradoEm),
        );
        temporario = await armazenamento.temporarioDeExportacao(comercianteId);
        const f = await open(temporario, "wx", 0o640);
        let bytes: number;
        try {
          const zip = new EscritorZip(f, geradoEm);
          await escreverCatalogo(zip, lido, (resumo) =>
            armazenamento.ler(comercianteId, resumo),
          );
          bytes = await zip.fechar();
        } catch (erro) {
          if (erro instanceof ErroZipGrandeDemais) {
            throw new ErroApi(
              "export.too_large",
              422,
              {
                pt: "Os dados não cabem numa exportação",
                en: "The data does not fit in one export",
              },
              erro.message,
            );
          }
          throw erro;
        } finally {
          await f.close();
        }
        const resumo = await resumoDoFicheiro(temporario);
        const caminho = temporario;
        // Uma repetição com a mesma chave devolve a exportação guardada e
        // este ZIP novo apaga-se (abaixo): fez-se trabalho a mais, mas a
        // resposta é a mesma.
        return await escrever(
          base,
          pedido,
          resposta,
          201,
          async (trx) => {
            const linha = await trx
              .insertInto("exportacao")
              .values({
                comerciante_id: comercianteId,
                dominios: [...pedido.body.dominios],
                formato: FORMATO_DO_CATALOGO,
                bytes,
                resumo,
              })
              .returning(COLUNAS)
              .executeTakeFirstOrThrow();
            // Dentro da transacção: se o nome falhar, a linha não fica.
            await armazenamento.guardarExportacao(
              comercianteId,
              linha.id,
              caminho,
            );
            return paraExportacao(linha, new Date());
          },
          (corpo) => `/exports/${(corpo as { id: string }).id}`,
        );
      } finally {
        emCurso.delete(comercianteId);
        if (temporario !== undefined) {
          await armazenamento.largarTemporario(temporario);
        }
      }
    },
  );

  rotas.get(
    "/exports",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As exportações do comerciante, das mais novas para as mais velhas, no formato das listas (docs/18 §2a); também as expiradas.",
        querystring: ConsultaPagina,
        response: { 200: Lista(ExportacaoEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      const limite =
        pedido.query.limite === undefined ? 25 : Number(pedido.query.limite);
      const depois =
        pedido.query.cursor === undefined
          ? null
          : idDoCursor(pedido.query.cursor);
      const { linhas, total, agora } = await noCatalogoApi(resposta, () =>
        noCatalogo(
          base,
          comercianteId,
          async (trx) => {
            const { n } = await trx
              .selectFrom("exportacao")
              .select((eb) => eb.fn.countAll<string>().as("n"))
              .executeTakeFirstOrThrow();
            let consulta = trx.selectFrom("exportacao").select(COLUNAS);
            if (depois !== null) consulta = consulta.where("id", "<", depois);
            const linhas = await consulta
              .orderBy("id", "desc")
              .limit(limite + 1)
              .execute();
            return { linhas, total: Number(n), agora: new Date() };
          },
          { soLeitura: true },
        ),
      );
      const haMais = linhas.length > limite;
      const dados = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? dados.at(-1) : undefined;
      return {
        dados: dados.map((e) => paraExportacao(e, agora)),
        total,
        ha_mais: haMais,
        cursor_seguinte: ultima === undefined ? null : cursorDe(ultima.id),
      };
    },
  );

  /** Uma exportação do comerciante, ou `export.not_found`. */
  const ler = (comercianteId: string, id: string) =>
    noCatalogo(
      base,
      comercianteId,
      async (trx) => {
        const linha = await trx
          .selectFrom("exportacao")
          .select(COLUNAS)
          .where("id", "=", id)
          .executeTakeFirst();
        if (linha === undefined) throw naoExiste(id);
        return linha;
      },
      { soLeitura: true },
    );

  rotas.get(
    "/exports/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description: "Uma exportação: estado, tamanho, resumo e prazo.",
        params: ParametroExportacao,
        response: { 200: ExportacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const { comercianteId } = chaveDo(pedido);
      const linha = await ler(comercianteId, semPrefixo(pedido.params.id));
      return paraExportacao(linha, new Date());
    },
  );

  rotas.get(
    "/exports/:id/file",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "O ZIP da exportação (application/zip). Depois de `expira_em`, 410 export.expired: pede-se outra.",
        params: ParametroExportacao,
        response: {
          200: {
            description: "O ZIP",
            content: {
              "application/zip": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      const linha = await ler(comercianteId, semPrefixo(pedido.params.id));
      if (linha.expira_em <= new Date()) {
        throw new ErroApi(
          "export.expired",
          410,
          {
            pt: "A exportação expirou; peça outra",
            en: "The export has expired; request a new one",
          },
          `expirou em ${linha.expira_em.toISOString()}`,
        );
      }
      let ficheiro;
      try {
        ficheiro = await armazenamento.abrirExportacao(comercianteId, linha.id);
      } catch (erro) {
        // A linha existe e o ficheiro não (apagado à mão, cópia reposta só
        // da base): 500 sem pormenor para fora, e o registo diz qual.
        pedido.log.error(
          { err: erro, exportacao: linha.id },
          "exportação: o ficheiro não está no armazenamento",
        );
        throw erro;
      }
      const dia = linha.criada_em.toISOString().slice(0, 10);
      return resposta
        .header("content-type", "application/zip")
        .header("content-length", linha.bytes)
        .header(
          "content-disposition",
          `attachment; filename="eurolify-exportacao-${dia}.zip"`,
        )
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header("etag", `"${linha.resumo}"`)
        .send(ficheiro);
    },
  );
}
