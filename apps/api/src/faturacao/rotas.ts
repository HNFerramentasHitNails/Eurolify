import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { ESTADOS_DOCUMENTO, type BaseDados } from "../base/esquema.js";
import { escrever, idCom, semPrefixo, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import type { ConfigFaturacao } from "./adaptador.js";
import { ErroDocumentos, ESTADO_DO_CODIGO, traduzir } from "./erros.js";
import {
  corrigir,
  criarLigacao,
  definirCredenciais,
  definirEmissor,
  libertar,
  lerDocumento,
  listarDocumentos,
  listarLigacoes,
  mudarLigacao,
  MOTIVOS_RETENCAO,
  pdfDoDocumento,
  reconciliar,
  resolver,
  reverificar,
  testarLigacao,
} from "./repositorio.js";

// A API dos documentos fiscais (docs/28 §7; issue #310; Diogo, 10/10/2026:
// «sim, aprovo; avança com o código da fatia 10»). As decisões de uma pessoa
// são uma de cada vez: nenhuma rota aceita listas (R10).

async function emDocumentos<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    const e = traduzir(erro);
    if (e instanceof ErroDocumentos) {
      if (e.codigo === "invoices.retry") {
        void resposta.header("Retry-After", "1");
      }
      throw new ErroApi(
        e.codigo,
        ESTADO_DO_CODIGO[e.codigo],
        e.codigo.endsWith(".not_found")
          ? { pt: "Não encontrado", en: "Not found" }
          : {
              pt: "Pedido recusado pelos documentos fiscais",
              en: "Rejected by fiscal documents",
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
const IdLigacao = idCom("isx", "isx_…");
const IdDocumento = idCom("inv", "inv_…");
const IdEncomenda = idCom("ord", "ord_…");
const Versao = Type.Integer({ minimum: 1 });
const Motivo = Type.String({ minLength: 3, maxLength: 500 });
const Taxas = Type.Array(
  Type.Object(
    {
      pais: Type.String({ pattern: "^[A-Z]{2}$" }),
      taxa: Type.Integer({ minimum: 0, maximum: 10000 }),
      emissor: Type.String({ pattern: "^[A-Za-z0-9._:-]{1,60}$" }),
    },
    { additionalProperties: false },
  ),
  { maxItems: 200 },
);
const Isencoes = Type.Array(
  Type.Object(
    {
      codigo: Type.String({ pattern: "^[A-Z0-9]{1,10}$" }),
      emissor: Type.String({ pattern: "^[A-Za-z0-9._:-]{1,60}$" }),
    },
    { additionalProperties: false },
  ),
  { maxItems: 100 },
);
const Serie = Type.Union([
  Type.String({ pattern: "^[A-Za-z0-9._/-]{1,40}$" }),
  Type.Null(),
]);
const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const quemDe = (chave: { chaveId: string }) => `chave:key_${chave.chaveId}`;

/**
 * Corrigir e libertar são decisões do dono, como nos clientes (Diogo,
 * 10/10/2026, revisão do #312, P2-4): corrigir o NIF, o nome e a morada pede
 * `customers:billing`; libertar pede `customers:exemptions`.
 */
function exigir(ambitos: readonly string[], ambito: string) {
  if (!ambitos.includes(ambito)) {
    throw new ErroApi(
      "auth.forbidden",
      403,
      {
        pt: "A chave não tem o âmbito desta operação",
        en: "The key lacks the scope for this operation",
      },
      `âmbito pedido: ${ambito}`,
    );
  }
}

export function rotasDosDocumentos(
  rotasBase: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigFaturacao | undefined,
) {
  const rotas = rotasBase.withTypeProvider<TypeBoxTypeProvider>();

  // ------------------------------------------------------ Quem emite (§3.1)

  rotas.put(
    "/legal-entities/:id/invoicing",
    {
      config: { ambito: "invoices:accounts" },
      schema: {
        description:
          "Quem emite os documentos fiscais desta entidade: `eurolify` (pela ligação ao software certificado) ou `sistema_proprio` (o sistema de gestão do comerciante; o Eurolify não pede documento nenhum — ADR-0041). Copia-se para cada encomenda no botão final: mudar só vale para encomendas novas. Só o dono (invoices:accounts).",
        params: Type.Object({ id: IdEntidade }),
        body: Type.Object(
          { emissor: umDe(["eurolify", "sistema_proprio"] as const) },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emDocumentos(resposta, async () => {
          await definirEmissor(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.emissor,
          );
          return null;
        }),
      ),
  );

  // ---------------------------------------------------- As ligações (§3.2)

  const paraLigacao = (
    l: Awaited<ReturnType<typeof listarLigacoes>>[number],
  ) => ({
    id: `isx_${l.id}`,
    entidade_legal: `lgl_${l.entidade_legal_id}`,
    adaptador: l.adaptador,
    modo: l.modo,
    estado: l.estado,
    activa: l.activa,
    serie: l.serie,
    taxas: l.taxas,
    isencoes: l.isencoes,
    credenciais_em: iso(l.credenciais_em),
    credenciais_por: l.credenciais_por,
    testada_em: iso(l.testada_em),
    erro: l.erro,
    versao: l.versao,
  });

  rotas.post(
    "/invoicing-connections",
    {
      config: { ambito: "invoices:accounts" },
      schema: {
        description:
          "Liga uma entidade a um software de faturação certificado: o adaptador (nesta parte só `ensaio`, que nunca emite nada real), a série e os mapas (país, taxa) → taxa do emissor e código do motivo → isenção do emissor. Uma ligação activa por entidade. Só o dono.",
        body: Type.Object(
          {
            entidade_legal: IdEntidade,
            adaptador: umDe(["ensaio", "moloni"] as const),
            serie: Type.Optional(Serie),
            taxas: Type.Optional(Taxas),
            isencoes: Type.Optional(Isencoes),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, async (trx, chave) =>
        emDocumentos(resposta, async () => ({
          id: `isx_${await criarLigacao(
            trx,
            chave.comercianteId,
            {
              entidade_legal: semPrefixo(pedido.body.entidade_legal),
              adaptador: pedido.body.adaptador,
              serie: pedido.body.serie ?? null,
              taxas: pedido.body.taxas ?? [],
              isencoes: pedido.body.isencoes ?? [],
            },
            quemDe(chave),
          )}`,
        })),
      ),
  );

  rotas.get(
    "/invoicing-connections",
    {
      config: { ambito: "invoices:read" },
      schema: {
        description:
          "As ligações aos softwares de faturação (sem as credenciais: só quando e por quem foram definidas).",
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emDocumentos(resposta, async () => ({
        dados: (await listarLigacoes(base, chaveDo(pedido).comercianteId)).map(
          paraLigacao,
        ),
      })),
  );

  rotas.patch(
    "/invoicing-connections/:id",
    {
      config: { ambito: "invoices:accounts" },
      schema: {
        description:
          "Muda a série ou os mapas, ou desliga a ligação. Mudar obriga a testar outra vez; com documentos a meio no emissor, recusa (R15).",
        params: Type.Object({ id: IdLigacao }),
        body: Type.Object(
          {
            versao: Versao,
            serie: Type.Optional(Serie),
            taxas: Type.Optional(Taxas),
            isencoes: Type.Optional(Isencoes),
            activa: Type.Optional(Type.Literal(false)),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) =>
        emDocumentos(resposta, async () => {
          const { versao, ...dados } = pedido.body;
          return {
            versao: await mudarLigacao(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              versao,
              dados,
            ),
          };
        }),
      ),
  );

  rotas.put(
    "/invoicing-connections/:id/credentials",
    {
      config: { ambito: "invoices:accounts" },
      schema: {
        description:
          "As credenciais do software de faturação. Ficam cifradas e nunca se devolvem; a ligação volta a «por testar». Só o dono.",
        params: Type.Object({ id: IdLigacao }),
        body: Type.Object(
          {
            credenciais: Type.Record(
              Type.String({ pattern: "^[a-z_]{1,40}$" }),
              Type.String({ minLength: 1, maxLength: 500 }),
              { minProperties: 1, maxProperties: 10 },
            ),
          },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emDocumentos(resposta, async () => {
          await definirCredenciais(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.credenciais,
            cfg,
            quemDe(chave),
          );
          return null;
        }),
      ),
  );

  rotas.post(
    "/invoicing-connections/:id/test",
    {
      config: { ambito: "invoices:accounts" },
      schema: {
        description:
          "A chamada de teste ao software de faturação: se aceitar as credenciais, a ligação fica pronta (só então emite).",
        params: Type.Object({ id: IdLigacao }),
        response: {
          200: Type.Object({
            estado: Type.String(),
            erro: Type.Union([Type.String(), Type.Null()]),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return emDocumentos(resposta, () =>
        testarLigacao(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          cfg,
          quemDe(chave),
        ),
      );
    },
  );

  // ------------------------------------------------- Os documentos (§3.3)

  rotas.get(
    "/invoices",
    {
      config: { ambito: "invoices:read" },
      schema: {
        description:
          "Os pedidos de documento fiscal (os 200 mais recentes), com o estado e os motivos de retenção. A fila: `estado=retido`, `incerto` ou `divergente`.",
        querystring: Type.Object(
          {
            estado: Type.Optional(umDe(ESTADOS_DOCUMENTO)),
            encomenda: Type.Optional(IdEncomenda),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emDocumentos(resposta, async () => ({
        dados: (
          await listarDocumentos(base, chaveDo(pedido).comercianteId, {
            ...(pedido.query.estado === undefined
              ? {}
              : { estado: pedido.query.estado }),
            ...(pedido.query.encomenda === undefined
              ? {}
              : { encomenda: semPrefixo(pedido.query.encomenda) }),
          })
        ).map((d) => ({
          id: `inv_${d.id}`,
          encomenda: `ord_${d.encomenda_id}`,
          tipo: d.tipo,
          modo: d.modo,
          estado: d.estado,
          motivos: d.motivos,
          versao: d.versao,
          criado_em: d.criado_em.toISOString(),
          actualizado_em: d.actualizado_em.toISOString(),
        })),
      })),
  );

  rotas.get(
    "/invoices/:id",
    {
      config: { ambito: "invoices:read" },
      schema: {
        description:
          "Um pedido de documento: as versões do conteúdo (o que vai sair), a prova (o documento lido de volta do emissor) com as divergências, e o rasto de cada passo.",
        params: Type.Object({ id: IdDocumento }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emDocumentos(resposta, async () => {
        const d = await lerDocumento(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          id: `inv_${d.id}`,
          encomenda: `ord_${d.encomenda_id}`,
          entidade_legal: `lgl_${d.entidade_legal_id}`,
          tipo: d.tipo,
          original: d.original_id === null ? null : `inv_${d.original_id}`,
          reembolso: d.reembolso_id === null ? null : `rfd_${d.reembolso_id}`,
          modo: d.modo,
          estado: d.estado,
          motivos: d.motivos,
          validados: d.validados,
          notas_credito: d.notas_credito.map((n) => ({
            id: `inv_${n.id}`,
            estado: n.estado,
            reembolso: n.reembolso_id === null ? null : `rfd_${n.reembolso_id}`,
            numero: n.numero,
            total: (n.totais as { total: number } | null)?.total ?? null,
          })),
          saldo: d.saldo,
          ligacao: d.ligacao_id === null ? null : `isx_${d.ligacao_id}`,
          emissor_id: d.emissor_id,
          versao: d.versao,
          criado_em: d.criado_em.toISOString(),
          conteudos: d.conteudos.map((x) => ({
            versao: x.versao,
            conteudo: x.conteudo,
            impressao: x.impressao,
            motivo: x.motivo,
            quem: x.quem,
            em: x.em.toISOString(),
          })),
          prova:
            d.prova === null
              ? null
              : {
                  id: `ivp_${d.prova.id}`,
                  numero: d.prova.numero,
                  serie: d.prova.serie,
                  data: d.prova.data,
                  atcud: d.prova.atcud,
                  nif: d.prova.nif,
                  nome: d.prova.nome,
                  pais: d.prova.pais,
                  linhas: d.prova.linhas,
                  totais: d.prova.totais,
                  divergencias: d.prova.divergencias,
                  tem_pdf: d.prova.tem_pdf,
                  lida_em: d.prova.lida_em.toISOString(),
                },
          rasto: d.rasto.map((p) => ({
            passo: p.passo,
            de: p.de,
            para: p.para,
            motivo: p.motivo,
            quem: p.quem,
            dados: p.dados,
            em: p.em.toISOString(),
          })),
        };
      }),
  );

  rotas.get(
    "/invoices/:id/pdf",
    {
      config: { ambito: "invoices:read" },
      schema: {
        description:
          "O PDF do documento emitido, como o emissor o devolveu (application/pdf).",
        params: Type.Object({ id: IdDocumento }),
        response: {
          200: {
            description: "O PDF",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const p = await emDocumentos(resposta, () =>
        pdfDoDocumento(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        ),
      );
      return resposta
        .header("content-type", "application/pdf")
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          `attachment; filename="${p.numero.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
        )
        .send(p.pdf);
    },
  );

  // -------------------------------------- As decisões de uma pessoa (§7.1)

  const Resposta = {
    200: Type.Object({ versao: Type.Integer() }),
    ...RESPOSTA_DE_ERRO,
  };

  rotas.post(
    "/invoices/:id/release",
    {
      config: { ambito: "invoices:write" },
      schema: {
        description:
          "Liberta um motivo de retenção, com o motivo da decisão (R9). Só o dono: pede também `customers:exemptions`. vale como validação desse motivo para este pedido. Só se libertam `nif_recusado`, `isencao_sem_prova` e `perfil_de_outra_ficha`; os outros resolvem-se na configuração ou corrigindo. Um de cada vez.",
        params: Type.Object({ id: IdDocumento }),
        body: Type.Object(
          {
            versao: Versao,
            motivo_retencao: umDe(MOTIVOS_RETENCAO),
            motivo: Motivo,
          },
          { additionalProperties: false },
        ),
        response: Resposta,
      },
    },
    (pedido, resposta) => {
      exigir(chaveDo(pedido).ambitos, "customers:exemptions");
      return escrever(base, pedido, resposta, 200, async (trx, chave) =>
        emDocumentos(resposta, async () => ({
          versao: await libertar(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            quemDe(chave),
          ),
        })),
      );
    },
  );

  rotas.post(
    "/invoices/:id/recheck",
    {
      config: { ambito: "invoices:write" },
      schema: {
        description:
          "Verifica outra vez um retido (depois de mudar a configuração: a ligação, os mapas, quem emite).",
        params: Type.Object({ id: IdDocumento }),
        body: Type.Object({ versao: Versao }, { additionalProperties: false }),
        response: Resposta,
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) =>
        emDocumentos(resposta, async () => ({
          versao: await reverificar(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.versao,
            quemDe(chave),
          ),
        })),
      ),
  );

  rotas.post(
    "/invoices/:id/correct",
    {
      config: { ambito: "invoices:write" },
      schema: {
        description:
          "Corrige um retido antes de emitir (Q4). Só o dono: pede também `customers:billing`. só o NIF (passa pela régua), o nome do documento e a morada fiscal, numa versão nova do conteúdo, com motivo. Nunca taxas, isenções nem montantes (é o que o cliente pagou). A encomenda não muda.",
        params: Type.Object({ id: IdDocumento }),
        body: Type.Object(
          {
            versao: Versao,
            motivo: Motivo,
            nif: Type.Optional(Type.String({ minLength: 2, maxLength: 30 })),
            nome_documento: Type.Optional(
              Type.String({ minLength: 1, maxLength: 200 }),
            ),
            morada: Type.Optional(
              Type.Object(
                {
                  linha1: Type.String({ minLength: 1, maxLength: 200 }),
                  linha2: Type.Optional(
                    Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
                  ),
                  codigo_postal: Type.String({ minLength: 1, maxLength: 20 }),
                  localidade: Type.String({ minLength: 1, maxLength: 100 }),
                  pais: Type.String({ pattern: "^[A-Z]{2}$" }),
                },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
        response: Resposta,
      },
    },
    (pedido, resposta) => {
      exigir(chaveDo(pedido).ambitos, "customers:billing");
      return escrever(base, pedido, resposta, 200, async (trx, chave) =>
        emDocumentos(resposta, async () => {
          const { morada, ...resto } = pedido.body;
          return {
            versao: await corrigir(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              {
                ...resto,
                ...(morada === undefined
                  ? {}
                  : { morada: { ...morada, linha2: morada.linha2 ?? null } }),
              },
              quemDe(chave),
            ),
          };
        }),
      );
    },
  );

  rotas.post(
    "/invoices/:id/reconcile",
    {
      config: { ambito: "invoices:write" },
      schema: {
        description:
          "Uma pessoa olhou para o emissor (§4.2, 4): `encontrado` com o identificador do documento lá (o Eurolify lê-o de volta e confere a referência), ou `nao_existe` (volta a pronto).",
        params: Type.Object({ id: IdDocumento }),
        body: Type.Object(
          {
            versao: Versao,
            resultado: umDe(["encontrado", "nao_existe"] as const),
            emissor_id: Type.Optional(
              Type.String({ minLength: 1, maxLength: 100 }),
            ),
            motivo: Motivo,
          },
          { additionalProperties: false },
        ),
        response: Resposta,
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return emDocumentos(resposta, async () => ({
        versao: await reconciliar(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          pedido.body,
          cfg,
          quemDe(chave),
        ),
      }));
    },
  );

  rotas.post(
    "/invoices/:id/resolve",
    {
      config: { ambito: "invoices:write" },
      schema: {
        description:
          "Uma divergência vista e decidida, com motivo. O documento emitido não muda (corrige-se com nota de crédito, na fatia 11).",
        params: Type.Object({ id: IdDocumento }),
        body: Type.Object(
          { versao: Versao, motivo: Motivo },
          { additionalProperties: false },
        ),
        response: Resposta,
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) =>
        emDocumentos(resposta, async () => ({
          versao: await resolver(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            quemDe(chave),
          ),
        })),
      ),
  );
}
