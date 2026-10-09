import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { erroBase, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  ENTIDADES_DA_LINHA_DO_TEMPO,
  type BaseDados,
  type EntidadeDaLinhaDoTempo,
} from "../base/esquema.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { ErroCatalogo, noCatalogo } from "./erros.js";
import {
  ConsultaPagina,
  idCom,
  Instante,
  Lista,
  noCatalogoApi,
  ParametroArtigo,
  semPrefixo,
  umDe,
} from "./rotas.js";

// A linha do tempo do artigo (docs/14 §3.12; C7): as entradas que os
// gatilhos da migração 0033 escreveram, da mais recente para a mais antiga.
// Pede `catalog:history`, porque traz quem fez (docs/06, CL e CU).

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** O prefixo público de cada entidade que o tem (docs/14 §3). */
const PREFIXO: Partial<Record<string, string>> = {
  artigo: "prd",
  variante: "var",
  opcao: "opt",
  valor_opcao: "ovl",
  media: "med",
  publicacao: "pub",
  categoria: "cat",
  colecao: "col",
};

const Entidade = umDe(ENTIDADES_DA_LINHA_DO_TEMPO);

const ConsultaLinhaDoTempo = Type.Object(
  {
    limite: ConsultaPagina.properties.limite,
    cursor: ConsultaPagina.properties.cursor,
    desde: Type.Optional(
      Type.String({
        format: "date-time",
        description: "Só as entradas deste instante em diante",
      }),
    ),
    entidade: Type.Optional(
      Type.Unsafe<EntidadeDaLinhaDoTempo>({
        type: "string",
        enum: [...ENTIDADES_DA_LINHA_DO_TEMPO],
        description: "Só as entradas desta entidade",
      }),
    ),
  },
  { additionalProperties: false },
);

const Alteracao = Type.Object({
  id: idCom("chg", "chg_…"),
  em: Instante,
  quem: Type.String({
    description:
      "chave:key_…, pessoa:per_… ou sistema:<tarefa>; um identificador, nunca o nome",
  }),
  origem: Type.Union([Type.String(), Type.Null()], {
    description: "importacao:imp_… numa importação; vazio numa escrita normal",
  }),
  transacao: Type.String({
    description:
      "As entradas com a mesma transacção são uma só alteração (ex.: mudar o nome e a publicação sair de venda)",
  }),
  entidade: Entidade,
  entidade_id: Type.Union([Type.String(), Type.Null()], {
    description:
      "O identificador da linha, com o prefixo quando a entidade o tem; vazio nas tabelas de ligação (as chaves vêm nos campos)",
  }),
  operacao: Type.Union([
    Type.Literal("criado"),
    Type.Literal("alterado"),
    Type.Literal("apagado"),
  ]),
  campos: Type.Record(
    Type.String(),
    Type.Object({ antes: Type.Unknown(), depois: Type.Unknown() }),
    {
      description:
        "Os campos que mudaram, com o valor antes e depois, como estão guardados (os identificadores sem prefixo)",
    },
  ),
});

const cursorDe = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function idDoCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!new RegExp(`^${UUID}$`).test(id)) {
    throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
  }
  return id;
}

export function rotasDaLinhaDoTempo(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/products/:id/timeline",
    {
      config: { ambito: "catalog:history" },
      schema: {
        description:
          "A linha do tempo do artigo (docs/14 §3.12): cada mudança no artigo, nas variantes, opções, traduções, imagens, categorias, colecções e publicações dele, com quem, quando, o antes e o depois, da mais recente para a mais antiga, no formato das listas (docs/18 §2a). Começa no dia em que esta parte entrou: não há entradas de antes. Um artigo apagado (um rascunho) mantém as entradas. Pede catalog:history, porque traz quem fez.",
        params: ParametroArtigo,
        querystring: ConsultaLinhaDoTempo,
        response: { 200: Lista(Alteracao), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      const artigoId = semPrefixo(pedido.params.id);
      const q = pedido.query;
      const limite = q.limite === undefined ? 25 : Number(q.limite);
      const depois = q.cursor === undefined ? null : idDoCursor(q.cursor);
      // O ano 0000 passa o formato `date-time` mas a base não o lê (como no
      // GET /products).
      if (q.desde?.startsWith("0000-") === true) {
        throw erroBase(
          "request.invalid",
          "`desde` fora do intervalo (o ano 0000 não existe)",
        );
      }
      const { linhas, total } = await noCatalogoApi(resposta, () =>
        noCatalogo(
          base,
          comercianteId,
          async (trx) => {
            let filtro = trx
              .selectFrom("alteracao_catalogo")
              .where("artigo_id", "=", artigoId);
            if (q.desde !== undefined) {
              filtro = filtro.where("em", ">=", new Date(q.desde));
            }
            if (q.entidade !== undefined) {
              filtro = filtro.where("entidade", "=", q.entidade);
            }
            const { n } = await filtro
              .select((eb) => eb.fn.countAll<string>().as("n"))
              .executeTakeFirstOrThrow();
            if (Number(n) === 0) {
              // Sem entradas: o artigo tem de existir, ou ter existido (um
              // rascunho apagado mantém as entradas; um artigo criado antes
              // da 0033 e nunca mudado não tem nenhuma).
              const existe = await trx
                .selectFrom("artigo")
                .select("id")
                .where("id", "=", artigoId)
                .executeTakeFirst();
              const teveEntradas = await trx
                .selectFrom("alteracao_catalogo")
                .select("id")
                .where("artigo_id", "=", artigoId)
                .limit(1)
                .executeTakeFirst();
              const artigo = existe ?? teveEntradas;
              if (artigo === undefined) {
                throw new ErroCatalogo(
                  "catalog.not_found",
                  `artigo ${artigoId}`,
                );
              }
            }
            let consulta = filtro.selectAll();
            if (depois !== null) consulta = consulta.where("id", "<", depois);
            const linhas = await consulta
              .orderBy("id", "desc")
              .limit(limite + 1)
              .execute();
            return { linhas, total: Number(n) };
          },
          { soLeitura: true },
        ),
      );
      const haMais = linhas.length > limite;
      const dados = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? dados.at(-1) : undefined;
      return {
        dados: dados.map((a) => {
          const prefixo = PREFIXO[a.entidade];
          return {
            id: `chg_${a.id}`,
            em: a.em.toISOString(),
            quem: a.quem,
            origem: a.origem,
            transacao: a.transacao,
            entidade: a.entidade,
            entidade_id:
              a.entidade_id === null
                ? null
                : prefixo === undefined
                  ? a.entidade_id
                  : `${prefixo}_${a.entidade_id}`,
            operacao: a.operacao,
            campos: a.campos,
          };
        }),
        total,
        ha_mais: haMais,
        cursor_seguinte: ultima === undefined ? null : cursorDe(ultima.id),
      };
    },
  );
}
