import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely } from "kysely";
import { Type } from "typebox";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados, FormatoDeImportacao } from "../base/esquema.js";
import { chaveJaGuardada, FORMATO_CHAVE } from "../base/idempotencia.js";
import { noCatalogo } from "../catalogo/erros.js";
import {
  aplicarPlano,
  ensaiar,
  ErroImportacao,
  lerFicheiro,
  MAX_VARIANTES,
  type Plano,
  type Relatorio,
} from "../catalogo/importacao.js";
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

// A importação do catálogo (docs/14 §3.11, «Importação do catálogo»;
// docs/06, CT; issue #77): o ensaio (`POST /imports`, com o ficheiro) e a
// aplicação do plano (`POST /imports/{id}/apply`), tudo ou nada.

/** O tamanho máximo do ficheiro (**proposta**): 10 MB. */
export const TAMANHO_MAXIMO_IMPORTACAO = 10 * 1024 * 1024;

const TIPOS: Record<string, FormatoDeImportacao> = {
  "text/csv": "csv",
  "application/json": "eurolify.catalogo/1",
};

const MENSAGENS: Record<ErroImportacao["codigo"], [number, string, string]> = {
  "import.invalid_file": [
    422,
    "O ficheiro não se pode ler",
    "The file cannot be read",
  ],
  "import.external_product": [
    422,
    "O artigo vem de um sistema externo",
    "The product comes from an external system",
  ],
  "import.too_large": [
    422,
    "O ficheiro tem variantes a mais",
    "The file has too many variants",
  ],
  "import.stale": [
    409,
    "O catálogo mudou desde o ensaio; faça outro",
    "The catalogue changed since the dry run; run another",
  ],
  "import.expired": [
    410,
    "O ensaio expirou; faça outro",
    "The dry run has expired; run another",
  ],
};

/** Um erro da importação como erro da API (código, estado e mensagens). */
function paraApi(erro: ErroImportacao): ErroApi {
  const [status, pt, en] = MENSAGENS[erro.codigo];
  const lista = Array.isArray(erro.pormenor)
    ? `: ${(erro.pormenor as string[]).slice(0, 20).join("; ")}`
    : "";
  return new ErroApi(
    erro.codigo,
    status,
    { pt, en },
    `${erro.message}${lista}`,
  );
}

const Contagem = Type.Object({
  artigos: Type.Integer(),
  variantes: Type.Integer(),
});

const RelatorioEsquema = Type.Object(
  {
    criar: Contagem,
    alterar: Contagem,
    iguais: Contagem,
    recusadas: Type.Array(
      Type.Object(
        {
          onde: Type.String({
            description: "«linha 17» ou «artigo 3, variante 2»",
          }),
          codigo: Type.String(),
        },
        { additionalProperties: true },
      ),
    ),
    alteracoes: Type.Array(
      Type.Object(
        {
          recurso: Type.String(),
          campo: Type.String(),
          antes: Type.Union([Type.String(), Type.Number(), Type.Null()]),
          depois: Type.Union([Type.String(), Type.Number()]),
        },
        { additionalProperties: false },
      ),
    ),
    recusadas_a_mais: Type.Integer({
      description: "As recusas que já não cabem na lista (só se contam)",
    }),
    avisos: Type.Array(Type.String()),
    alteracoes_a_mais: Type.Integer({
      description: "As alterações que já não cabem na lista (só se contam)",
    }),
    ignorado: Type.Record(Type.String(), Type.Integer(), {
      description: "O que o ficheiro trazia e esta parte não importa",
    }),
  },
  { additionalProperties: false },
);

const ImportacaoEsquema = Type.Object({
  id: Type.String({ description: "imp_…" }),
  estado: Type.Unsafe<"analisada" | "aplicada">({
    type: "string",
    enum: ["analisada", "aplicada"],
  }),
  formato: Type.String(),
  bytes: Type.Integer(),
  resumo: Type.String({ description: "SHA-256 do ficheiro" }),
  relatorio: RelatorioEsquema,
  resultado: Type.Union([
    Type.Object(
      {
        artigos: Type.Array(Type.String({ description: "prd_…" })),
        variantes: Type.Integer(),
      },
      { additionalProperties: false },
    ),
    Type.Null(),
  ]),
  analisada_em: Instante,
  aplicada_em: Type.Union([Instante, Type.Null()]),
  expira_em: Instante,
  expirada: Type.Boolean({
    description: "Depois de `expira_em` já não se aplica (410)",
  }),
});

const ParametroImportacao = Type.Object({ id: idCom("imp", "imp_…") });

const COLUNAS = [
  "id",
  "estado",
  "formato",
  "bytes",
  "resumo",
  "relatorio",
  "resultado",
  "analisada_em",
  "aplicada_em",
  "expira_em",
] as const;

interface LinhaImportacao {
  id: string;
  estado: "analisada" | "aplicada";
  formato: string;
  bytes: number;
  resumo: string;
  relatorio: unknown;
  resultado: unknown;
  analisada_em: Date;
  aplicada_em: Date | null;
  expira_em: Date;
}

const paraImportacao = (i: LinhaImportacao, agora: Date) => ({
  id: `imp_${i.id}`,
  estado: i.estado,
  formato: i.formato,
  bytes: i.bytes,
  resumo: i.resumo,
  relatorio: i.relatorio as Relatorio,
  resultado: (i.resultado ?? null) as {
    artigos: string[];
    variantes: number;
  } | null,
  analisada_em: i.analisada_em.toISOString(),
  aplicada_em: i.aplicada_em === null ? null : i.aplicada_em.toISOString(),
  expira_em: i.expira_em.toISOString(),
  expirada: i.estado === "analisada" && i.expira_em <= agora,
});

const naoExiste = (id: string) =>
  new ErroApi(
    "import.not_found",
    404,
    { pt: "Importação não encontrada", en: "Import not found" },
    `importação ${id}`,
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cursorDe = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function idDoCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID.test(id)) throw erroBase("request.invalid", "cursor inválido");
  return id;
}

/** A chave de idempotência, conferida antes do trabalho (como na exportação). */
function chaveConferida(pedido: Parameters<typeof chaveDeIdempotencia>[0]) {
  const chave = chaveDeIdempotencia(pedido);
  if (chave === undefined || chave === "") {
    throw erroBase("idempotency.key_required");
  }
  if (!FORMATO_CHAVE.test(chave)) {
    throw erroBase(
      "request.invalid",
      "Idempotency-Key: de 1 a 255 caracteres visíveis em ASCII",
    );
  }
  return chave;
}

export function rotasDasImportacoes(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  // O ensaio num plugin só dele: o corpo chega em bytes (CSV ou JSON), até
  // 10 MB, só nesta rota.
  void instancia.register((envio, _o, pronto) => {
    rotaDoEnsaio(envio, base);
    pronto();
  });
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  // Uma aplicação de cada vez por comerciante (**proposta**), neste processo.
  const emCurso = new Set<string>();

  rotas.get(
    "/imports",
    {
      config: { ambito: "catalog:import" },
      schema: {
        description:
          "As importações do comerciante, das mais novas para as mais velhas (docs/18 §2a), com o relatório.",
        querystring: ConsultaPagina,
        response: { 200: Lista(ImportacaoEsquema), ...RESPOSTA_DE_ERRO },
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
              .selectFrom("importacao")
              .select((eb) => eb.fn.countAll<string>().as("n"))
              .executeTakeFirstOrThrow();
            let consulta = trx.selectFrom("importacao").select(COLUNAS);
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
        dados: dados.map((i) => paraImportacao(i, agora)),
        total,
        ha_mais: haMais,
        cursor_seguinte: ultima === undefined ? null : cursorDe(ultima.id),
      };
    },
  );

  rotas.get(
    "/imports/:id",
    {
      config: { ambito: "catalog:import" },
      schema: {
        description:
          "Uma importação: o estado, o relatório do ensaio e, depois de aplicada, o resultado.",
        params: ParametroImportacao,
        response: { 200: ImportacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const { comercianteId } = chaveDo(pedido);
      const id = semPrefixo(pedido.params.id);
      const linha = await noCatalogo(
        base,
        comercianteId,
        (trx) =>
          trx
            .selectFrom("importacao")
            .select(COLUNAS)
            .where("id", "=", id)
            .executeTakeFirst(),
        { soLeitura: true },
      );
      if (linha === undefined) throw naoExiste(id);
      return paraImportacao(linha, new Date());
    },
  );

  rotas.post(
    "/imports/:id/apply",
    {
      config: { ambito: "catalog:import" },
      schema: {
        description:
          "Aplica o plano do ensaio, numa transacção só: ou tudo, ou nada. Se o catálogo mudou desde o ensaio (a versão de um artigo, um campo de uma variante, um SKU a criar que já existe), nada se grava e dá 409 import.stale: faz-se outro ensaio. Depois de 24 h, 410 import.expired. Aplicar uma já aplicada devolve o resultado da primeira. Uma de cada vez por comerciante (429).",
        headers: CabecalhoIdempotencia,
        params: ParametroImportacao,
        response: { 200: ImportacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      chaveConferida(pedido);
      if (emCurso.has(comercianteId)) {
        void resposta.header("Retry-After", "5");
        throw erroBase(
          "rate_limit.exceeded",
          "já há uma importação a ser aplicada para este comerciante",
        );
      }
      emCurso.add(comercianteId);
      try {
        const id = semPrefixo(pedido.params.id);
        return await escrever(base, pedido, resposta, 200, async (trx) => {
          const linha = await trx
            .selectFrom("importacao")
            .select([...COLUNAS, "plano"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
          if (linha === undefined) throw naoExiste(id);
          if (linha.estado === "aplicada") {
            return paraImportacao(linha, new Date());
          }
          const { rows } = await sql<{ expirada: boolean }>`
            select ${linha.expira_em} <= now() as expirada`.execute(trx);
          if (rows[0]?.expirada === true) {
            throw paraApi(
              new ErroImportacao("import.expired", "o ensaio expirou"),
            );
          }
          // Na linha do tempo, o que a importação muda leva a origem
          // (docs/14 §3.12).
          // E o canal é a importação (docs/28 §3.1; #322).
          await sql`select set_config('eurolify.origem', ${`importacao:imp_${id}`}, true),
                           set_config('eurolify.canal', 'importacao', true)`.execute(
            trx,
          );
          let resultado;
          try {
            resultado = await aplicarPlano(
              trx,
              comercianteId,
              linha.plano as Plano,
            );
          } catch (erro) {
            if (erro instanceof ErroImportacao) throw paraApi(erro);
            throw erro;
          }
          const aplicada = await trx
            .updateTable("importacao")
            .set({ estado: "aplicada", resultado: JSON.stringify(resultado) })
            .where("id", "=", id)
            .returning(COLUNAS)
            .executeTakeFirstOrThrow();
          return paraImportacao(aplicada, new Date());
        });
      } finally {
        emCurso.delete(comercianteId);
      }
    },
  );
}

function rotaDoEnsaio(instancia: FastifyInstance, base: Kysely<BaseDados>) {
  // CSV e JSON chegam como bytes: o JSON da exportação lê-se aqui, não pelo
  // leitor da app (que o transformava em objecto).
  instancia.removeContentTypeParser("application/json");
  instancia.addContentTypeParser(
    ["text/csv", "application/json"],
    { parseAs: "buffer", bodyLimit: TAMANHO_MAXIMO_IMPORTACAO },
    (_pedido, corpo, feito) => {
      feito(null, corpo);
    },
  );
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  rotas.post(
    "/imports",
    {
      config: { ambito: "catalog:import" },
      schema: {
        description: `O ensaio da importação (docs/14 §3.11): o corpo é o ficheiro, um CSV (text/csv, uma linha por variante, com as colunas de docs/14) ou o catalogo.json da exportação (application/json), até ${String(TAMANHO_MAXIMO_IMPORTACAO / 1024 / 1024)} MB e ${String(MAX_VARIANTES)} variantes. Confere tudo contra o catálogo e responde com o relatório (o que se cria, altera, fica igual ou se recusa, e porquê), **sem gravar nada no catálogo**. Aplica-se em POST /imports/{id}/apply nas 24 h seguintes. Cria artigos sempre em rascunho; nunca apaga, nunca arquiva, e uma célula vazia não muda o campo.`,
        headers: CabecalhoIdempotencia,
        response: { 201: ImportacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      const chave = chaveConferida(pedido);
      const bytes = pedido.body as Buffer;
      const tipo = (pedido.headers["content-type"] ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();
      const formato = TIPOS[tipo ?? ""];
      if (formato === undefined) throw erroBase("media_type.unsupported");
      if (bytes.length === 0) {
        throw paraApi(
          new ErroImportacao("import.invalid_file", "o ficheiro está vazio"),
        );
      }
      const resumo = createHash("sha256").update(bytes).digest("hex");
      const corpoIdempotente = { resumo, formato, bytes: bytes.length };
      // Uma chave já guardada: a resposta guardada, sem novo ensaio.
      if (await chaveJaGuardada(base, comercianteId, chave)) {
        return escrever(
          base,
          pedido,
          resposta,
          201,
          () => {
            throw erroBase("idempotency.in_progress");
          },
          undefined,
          corpoIdempotente,
        );
      }
      let lido;
      try {
        lido = lerFicheiro(bytes, formato);
      } catch (erro) {
        if (erro instanceof ErroImportacao) throw paraApi(erro);
        throw erro;
      }
      if (lido.variantes > MAX_VARIANTES) {
        throw paraApi(
          new ErroImportacao(
            "import.too_large",
            `${String(lido.variantes)} variantes; no máximo ${String(MAX_VARIANTES)}`,
          ),
        );
      }
      return escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx) => {
          const { relatorio, plano } = await ensaiar(trx, comercianteId, lido);
          const linha = await trx
            .insertInto("importacao")
            .values({
              comerciante_id: comercianteId,
              formato,
              resumo,
              bytes: bytes.length,
              relatorio: JSON.stringify(relatorio),
              plano: JSON.stringify(plano),
            })
            .returning(COLUNAS)
            .executeTakeFirstOrThrow();
          return paraImportacao(linha, new Date());
        },
        (corpo) => `/imports/${(corpo as { id: string }).id}`,
        corpoIdempotente,
      );
    },
  );
}
