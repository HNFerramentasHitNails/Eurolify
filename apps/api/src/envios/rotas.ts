import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { TRANSPORTADORAS, type BaseDados } from "../base/esquema.js";
import { escrever, idCom, semPrefixo, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { rastoActual } from "../base/rasto.js";
import type { ConfigEnvios, ServicoTransportadora } from "./adaptador.js";
import {
  anularEtiqueta,
  comercianteDaConta,
  consultarSeguimento,
  definirEmbalagem,
  ficheiroDaEtiqueta,
  lerEtiqueta,
  listarEventos,
  pedirEtiqueta,
  receberAviso,
} from "./etiquetas.js";
import {
  correcoesDaExpedicao,
  corrigirPeso,
  mudarServico,
  servicosDaExpedicao,
} from "./correcoes.js";
import { ErroEnvios, ESTADO_DO_CODIGO } from "./erros.js";
import {
  anularEtiquetaDevolucao,
  ficheiroEtiquetaDevolucao,
  lerEtiquetaDevolucao,
  pedirEtiquetaDevolucao,
  type EtiquetaDaDevolucao,
} from "./devolucoes.js";
import {
  criarConta,
  definirCredenciais,
  listarContas,
  mudarConta,
  servicosDaConta,
  testarConta,
  traduzir,
} from "./repositorio.js";

// A API das contas de transportadora (docs/36 §7.1; migração 0074; Diogo,
// 12/10/2026: «sim, aprovo; avança com a parte A»). Os campos novos do
// método de entrega vivem nas rotas do checkout (/shipping-methods).

function paraApi(erro: unknown): unknown {
  const e = traduzir(erro);
  if (e instanceof ErroEnvios) {
    return new ErroApi(
      e.codigo,
      ESTADO_DO_CODIGO[e.codigo],
      e.codigo.endsWith(".not_found")
        ? { pt: "Não encontrado", en: "Not found" }
        : { pt: "Pedido recusado pelos envios", en: "Rejected by shipping" },
      e.pormenor === undefined
        ? e.message
        : `${e.message} ${JSON.stringify(e.pormenor)}`,
    );
  }
  return e;
}

export async function emEnvios<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
) {
  try {
    return await fn();
  } catch (erro) {
    const e = paraApi(erro);
    if (e instanceof ErroApi && e.codigo === "shipping.retry") {
      void resposta.header("Retry-After", "1");
    }
    throw e;
  }
}

export const IdConta = idCom("cac", "cac_…");
export const IdExpedicao = idCom("shp", "shp_…");
const IdDevolucao = idCom("rma", "rma_…");

/** A etiqueta de uma devolução como a API a mostra (docs/36 §22). */
export const paraEtiquetaDevolucao = (e: EtiquetaDaDevolucao) => ({
  devolucao: `rma_${e.devolucao}`,
  estado: e.estado,
  tentativa: e.tentativa,
  conta: `cac_${e.conta}`,
  transportadora: e.transportadora,
  servico: e.servico,
  peso_g: e.peso_g,
  motivo: e.motivo,
  seguimento: e.seguimento,
  url_seguimento: e.url_seguimento,
  em: e.em.toISOString(),
  ficheiro: e.ficheiro ? "pdf" : null,
});
const IdArmazem = idCom("whs", "whs_…");
export const Versao = Type.Integer({ minimum: 1 });
const iso = (d: Date | null) => (d === null ? null : d.toISOString());

export const Remetente = Type.Object(
  {
    nome: Type.String({ minLength: 1, maxLength: 200 }),
    linha1: Type.String({ minLength: 1, maxLength: 200 }),
    linha2: Type.Optional(Type.String({ maxLength: 200 })),
    codigo_postal: Type.String({ minLength: 1, maxLength: 20 }),
    localidade: Type.String({ minLength: 1, maxLength: 100 }),
    pais: Type.String({ pattern: "^[A-Z]{2}$" }),
    telefone: Type.Optional(Type.String({ pattern: "^\\+[1-9][0-9]{6,14}$" })),
    email: Type.Optional(
      Type.String({ maxLength: 254, pattern: "^[^@\\s]+@[^@\\s]+$" }),
    ),
  },
  { additionalProperties: false },
);

export const CorpoNovaConta = Type.Object(
  {
    transportadora: umDe(TRANSPORTADORAS),
    nome: Type.String({ minLength: 1, maxLength: 100 }),
    remetente: Remetente,
  },
  { additionalProperties: false },
);

export const CorpoMudarConta = Type.Object(
  {
    versao: Versao,
    nome: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    remetente: Type.Optional(Remetente),
    arquivar: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);

export const CorpoCredenciais = Type.Object(
  {
    credenciais: Type.Record(
      Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
      Type.String({ minLength: 1, maxLength: 500 }),
      { minProperties: 1, maxProperties: 10 },
    ),
    // Sem ele, o segredo guardado fica; null tira-o.
    segredo_aviso: Type.Optional(
      Type.Union([Type.String({ minLength: 16, maxLength: 200 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

/** Um serviço como a API o mostra, pela chave e pelo Hub. */
export const servicoParaApi = (s: ServicoTransportadora) => ({
  codigo: s.codigo,
  nome: s.nome,
  paises: s.paises,
  peso_max_g: s.pesoMaxG,
  pede_telefone: s.pedeTelefone,
  pede_email: s.pedeEmail,
  aceita_onu: s.aceitaOnu,
  // Entrega num ponto de recolha: só serve um método `ponto` (docs/36 §21).
  ponto: s.ponto === true,
});

/** Uma conta como a API a mostra, pela chave e pelo Hub (docs/22 §29.2). */
export function contaParaApi(cfg: ConfigEnvios | undefined) {
  return (c: Awaited<ReturnType<typeof listarContas>>[number]) => ({
    id: `cac_${c.id}`,
    transportadora: c.transportadora,
    nome: c.nome,
    modo: c.modo,
    remetente: c.remetente,
    estado: c.estado,
    // As credenciais nunca saem: só quando e por quem foram definidas.
    credenciais_em: iso(c.credenciais_em),
    credenciais_por: c.credenciais_por,
    testada_em: iso(c.testada_em),
    servicos_em: iso(c.servicos_em),
    // Os campos que a transportadora pede, como o adaptador os declara;
    // vazio quando a transportadora ainda não está ligada ao Eurolify.
    campos_credenciais: [
      ...(cfg?.adaptadores[c.transportadora]?.camposCredenciais ?? []),
    ],
    criado_em: c.criado_em.toISOString(),
    versao: c.versao,
  });
}

/** A etiqueta como a API a mostra, pela chave e pelo Hub (docs/22 §33). */
export const paraEtiqueta = (e: Awaited<ReturnType<typeof lerEtiqueta>>) => ({
  expedicao: `shp_${e.id}`,
  estado_expedicao: e.estado,
  etiqueta: e.etiqueta,
  tentativa: e.etiqueta_tentativa,
  motivo: e.etiqueta_motivo,
  em: iso(e.etiqueta_em),
  conta:
    e.conta_transportadora_id === null
      ? null
      : `cac_${e.conta_transportadora_id}`,
  transportadora: e.transportadora,
  servico: e.servico,
  seguimento: e.seguimento,
  url_seguimento: e.url_seguimento,
  peso_g: e.peso_g,
  ficheiro: e.ficheiro,
  // Corrigidos por uma pessoa, com motivo (docs/36 §19).
  peso_corrigido_g: e.peso_corrigido_g,
  escolhido:
    e.conta_escolhida_id === null || e.servico_escolhido === null
      ? null
      : { conta: `cac_${e.conta_escolhida_id}`, servico: e.servico_escolhido },
  versao: e.versao,
});

/** Um evento de seguimento, pela chave e pelo Hub. */
export const paraEvento = (
  e: Awaited<ReturnType<typeof listarEventos>>[number],
) => ({
  origem: e.origem,
  id_externo: e.id_externo,
  estado_transportadora: e.estado_transportadora,
  estado: e.estado_normalizado,
  em: e.em.toISOString(),
  recebido_em: e.recebido_em.toISOString(),
});

export function rotasDosEnvios(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  const paraConta = contaParaApi(cfg);

  rotas.get(
    "/carrier-accounts",
    {
      config: { ambito: "shipping:read" },
      schema: {
        description:
          "As contas do comerciante nas transportadoras, sem as credenciais (docs/36 §3.1).",
        response: {
          200: Type.Object({
            dados: Type.Array(Type.Record(Type.String(), Type.Unknown())),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        dados: (await listarContas(base, chaveDo(pedido).comercianteId)).map(
          paraConta,
        ),
      })),
  );

  rotas.post(
    "/carrier-accounts",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "Cria uma conta numa transportadora (rascunho, modo teste). Só o dono (shipping:accounts).",
        body: CorpoNovaConta,
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emEnvios(resposta, async () => ({
          id: `cac_${await criarConta(trx, chave.comercianteId, pedido.body)}`,
        })),
      ),
  );

  rotas.patch(
    "/carrier-accounts/:id",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "Muda o nome ou o remetente da conta, ou arquiva-a (só sem métodos de entrega activos a usá-la).",
        params: Type.Object({ id: IdConta }),
        body: CorpoMudarConta,
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emEnvios(resposta, async () => {
          const { versao, ...dados } = pedido.body;
          return {
            versao: await mudarConta(
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
    "/carrier-accounts/:id/credentials",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "Define as credenciais da conta na transportadora (os campos dependem dela) e, se a transportadora avisar, o segredo dos avisos (sem o campo, o guardado fica; null tira-o). Ficam cifrados e nunca se devolvem; a conta volta a rascunho até à chamada de teste.",
        params: Type.Object({ id: IdConta }),
        body: CorpoCredenciais,
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emEnvios(resposta, async () => {
          await definirCredenciais(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            `chave:key_${chave.chaveId}`,
            cfg,
          );
          return null;
        }),
      ),
  );

  rotas.post(
    "/carrier-accounts/:id/test",
    {
      config: { ambito: "shipping:accounts" },
      schema: {
        description:
          "A chamada de teste à transportadora com as credenciais da conta: se ela as aceitar, a conta fica pronta (só então um método de entrega pode apontar para ela).",
        params: Type.Object({ id: IdConta }),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        versao: await testarConta(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
          cfg,
        ),
      })),
  );

  rotas.get(
    "/carrier-accounts/:id/services",
    {
      config: { ambito: "shipping:read" },
      schema: {
        description:
          "Os serviços que o adaptador da transportadora declara: código, países, peso máximo, se pede telefone ou e-mail e que perigosos aceita.",
        params: Type.Object({ id: IdConta }),
        response: {
          200: Type.Object({
            dados: Type.Array(Type.Record(Type.String(), Type.Unknown())),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        dados: (
          await servicosDaConta(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
          )
        ).map(servicoParaApi),
      })),
  );

  // ------------------------------------------- A etiqueta (parte B, 0079)

  const quemDo = (pedido: Parameters<typeof chaveDo>[0]) =>
    `chave:key_${chaveDo(pedido).chaveId}`;
  const Expedicao = Type.Object({ id: IdExpedicao });
  const Livre = Type.Record(Type.String(), Type.Unknown());

  rotas.post(
    "/shipments/:id/label",
    {
      config: { ambito: "fulfilment:write" },
      schema: {
        description:
          "Pede a etiqueta à transportadora com a conta e o serviço vendidos (docs/36 R1) e o peso da caixa (as variantes mais a embalagem do armazém). Uma etiqueta viva por expedição: pedir outra exige anular a anterior. Sem resposta da transportadora, a etiqueta fica «incerta» e não se pede outra até se saber (POST …/refresh).",
        params: Expedicao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraEtiqueta(
          await pedirEtiqueta(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
            quemDo(pedido),
          ),
        ),
      ),
  );

  rotas.get(
    "/shipments/:id/label",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description:
          "O estado da etiqueta da expedição: a conta, o serviço, o peso, o seguimento e se há ficheiro.",
        params: Expedicao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraEtiqueta(
          await lerEtiqueta(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.get(
    "/shipments/:id/label/file",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description:
          "O ficheiro da etiqueta (PDF ou ZPL), enquanto existir: apaga-se 30 dias depois de a expedição acabar, ou logo num apagamento do titular (docs/36 Q7).",
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
        const f = await ficheiroDaEtiqueta(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return resposta
          .header(
            "content-type",
            f.formato === "pdf" ? "application/pdf" : "text/plain",
          )
          .header("x-content-type-options", "nosniff")
          .header("cache-control", "no-store")
          .send(f.conteudo);
      }),
  );

  rotas.post(
    "/shipments/:id/label/void",
    {
      config: { ambito: "fulfilment:write" },
      schema: {
        description:
          "Anula a etiqueta emitida, se a transportadora deixar (antes de a expedição sair); o ficheiro apaga-se.",
        params: Expedicao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraEtiqueta(
          await anularEtiqueta(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
            quemDo(pedido),
          ),
        ),
      ),
  );

  // A etiqueta de devolução (docs/36 §22).
  const Devolucao = Type.Object({ id: IdDevolucao });

  rotas.post(
    "/returns/:id/label",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Pede a etiqueta de devolução à transportadora (docs/36 §22): numa devolução à espera, com a conta e um serviço de morada que sirva o país do cliente. Vai o nome e a morada de entrega do cliente, a morada de recolha da conta e o peso das linhas mais a embalagem. A etiqueta é paga pela conta do comerciante. Sem resposta, fica «incerta» e não se pede outra até uma pessoa confirmar no painel da transportadora e a anular aqui.",
        params: Devolucao,
        body: Type.Object(
          {
            conta: IdConta,
            servico: Type.String({ pattern: "^[0-9A-Za-z_.:/-]{1,100}$" }),
          },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraEtiquetaDevolucao(
          await pedirEtiquetaDevolucao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            {
              conta: semPrefixo(pedido.body.conta),
              servico: pedido.body.servico,
            },
            cfg,
            quemDo(pedido),
          ),
        ),
      ),
  );

  rotas.get(
    "/returns/:id/label",
    {
      config: { ambito: "returns:read" },
      schema: {
        description:
          "O estado da etiqueta de devolução: a conta, o serviço, o peso, o seguimento e se há ficheiro (docs/36 §22).",
        params: Devolucao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraEtiquetaDevolucao(
          await lerEtiquetaDevolucao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            quemDo(pedido),
          ),
        ),
      ),
  );

  rotas.get(
    "/returns/:id/label/file",
    {
      config: { ambito: "returns:read" },
      schema: {
        description:
          "O ficheiro da etiqueta de devolução, para mandar ao cliente, enquanto existir: apaga-se 30 dias depois de a devolução acabar, ou logo num apagamento do titular (docs/36 §22, Q7).",
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
        const f = await ficheiroEtiquetaDevolucao(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return resposta
          .header(
            "content-type",
            f.formato === "pdf" ? "application/pdf" : "text/plain",
          )
          .header("x-content-type-options", "nosniff")
          .header("cache-control", "no-store")
          .send(f.conteudo);
      }),
  );

  rotas.post(
    "/returns/:id/label/void",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Anula a etiqueta de devolução emitida ou incerta (docs/36 §22): é quem a pede a dizer que a anulou no painel da transportadora, ou que a incerta não existe lá. O Eurolify não a anula na transportadora. O ficheiro apaga-se e pode pedir-se outra.",
        params: Devolucao,
        body: Type.Object(
          {
            motivo: Type.String({ minLength: 3, maxLength: 500 }),
            // Quem anula diz que a anulou no painel da transportadora (ou
            // que a incerta não existe lá): o Eurolify não a anula lá
            // (revisão do #447, P2).
            anulada_no_painel: Type.Literal(true),
          },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraEtiquetaDevolucao(
          await anularEtiquetaDevolucao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.motivo,
            quemDo(pedido),
          ),
        ),
      ),
  );

  rotas.get(
    "/shipments/:id/events",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description:
          "Os eventos de seguimento da expedição, pela ordem da data da transportadora (docs/36 §3.4).",
        params: Expedicao,
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        dados: (
          await listarEventos(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          )
        ).map(paraEvento),
      })),
  );

  rotas.post(
    "/shipments/:id/refresh",
    {
      config: { ambito: "fulfilment:write" },
      schema: {
        description:
          "Pergunta agora à transportadora: o seguimento de uma etiqueta emitida, ou se uma etiqueta incerta existe.",
        params: Expedicao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => {
        const c = chaveDo(pedido).comercianteId;
        const id = semPrefixo(pedido.params.id);
        const novos = await consultarSeguimento(
          base,
          c,
          id,
          cfg,
          quemDo(pedido),
        );
        return { ...paraEtiqueta(await lerEtiqueta(base, c, id)), novos };
      }),
  );

  // ------------- Corrigir o peso e mudar o serviço (docs/36 §19, 0086)

  rotas.get(
    "/shipments/:id/services",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description:
          "Os serviços que servem esta expedição (o país da morada, o peso, os perigosos e o telefone), de contas prontas, com o vendido e o escolhido marcados; o peso calculado e o corrigido.",
        params: Expedicao,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () =>
        paraServicosDaExpedicao(
          await servicosDaExpedicao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            cfg,
          ),
        ),
      ),
  );

  rotas.get(
    "/shipments/:id/corrections",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description:
          "As correcções do peso e do serviço da expedição, com o valor antigo, o novo, o motivo, quem e quando (só se acrescentam).",
        params: Expedicao,
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emEnvios(resposta, async () => ({
        dados: (
          await correcoesDaExpedicao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          )
        ).map(paraCorrecao),
      })),
  );

  rotas.put(
    "/shipments/:id/weight",
    {
      config: { ambito: "fulfilment:write" },
      schema: {
        description:
          "Corrige o peso da caixa, com motivo, na versão lida (`peso_g: null` volta ao calculado). Só com a expedição criada e sem etiqueta viva (anula-se primeiro). A etiqueta usa-o em vez da soma.",
        params: Expedicao,
        body: CorpoCorrigirPeso,
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emEnvios(resposta, async () => ({
          versao: await corrigirPeso(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            cfg,
            `chave:key_${chave.chaveId}`,
          ),
        })),
      ),
  );

  rotas.put(
    "/shipments/:id/service",
    {
      config: { ambito: "shipping:write" },
      schema: {
        description:
          "Escolhe outro serviço para a etiqueta, com motivo, na versão lida (`conta` e `servico` a `null` voltam ao vendido). O vendido não muda (o preço, a data-limite, o método). Só um serviço de uma conta pronta que sirva esta expedição; só com a expedição criada e sem etiqueta viva. Uma chave de agente de IA não muda o serviço.",
        params: Expedicao,
        body: CorpoMudarServico,
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emEnvios(resposta, async () => {
          semIaNoServico(chave.agenteIa);
          return {
            versao: await mudarServico(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              dadosDoServico(pedido.body),
              cfg,
              `chave:key_${chave.chaveId}`,
            ),
          };
        }),
      ),
  );

  rotas.put(
    "/warehouses/:id/packaging",
    {
      config: { ambito: "shipping:write" },
      schema: {
        description:
          "O peso da embalagem por omissão do armazém, em gramas, somado ao das variantes na etiqueta (docs/36 Q6).",
        params: Type.Object({ id: IdArmazem }),
        body: Type.Object(
          { embalagem_g: Type.Integer({ minimum: 0, maximum: 100_000 }) },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, (trx, chave) =>
        emEnvios(resposta, async () => {
          await definirEmbalagem(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.embalagem_g,
          );
          return null;
        }),
      ),
  );

  // ---------------------- Os avisos das transportadoras (R3; sem chave)

  // Num plugin próprio: o corpo lê-se em bruto (a assinatura é sobre ele),
  // como os avisos dos pagamentos.
  void rotas.register((avisos, _o, pronto) => {
    avisos.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 65536 },
      (_pedido, corpo, feito) => {
        feito(null, corpo);
      },
    );
    avisos.withTypeProvider<TypeBoxTypeProvider>().post(
      "/webhooks/carriers/:transportadora/:conta",
      {
        config: { ambito: "publico" as const, loja: true },
        schema: {
          description:
            "Os avisos de seguimento de uma transportadora para uma conta. O aviso grava-se em bruto; só com a assinatura certa muda alguma coisa; o mesmo evento duas vezes não conta duas vezes; um processamento que falha responde 5xx para a transportadora reenviar.",
          params: Type.Object({
            transportadora: umDe(TRANSPORTADORAS),
            conta: IdConta,
          }),
          response: {
            200: Type.Object({ recebido: Type.Boolean() }),
            ...RESPOSTA_DE_ERRO,
          },
        },
      },
      async (pedido, resposta) =>
        emEnvios(resposta, async () => {
          const conta = semPrefixo(pedido.params.conta);
          const c = await comercianteDaConta(base, conta);
          // Conta desconhecida responde como assinatura errada: não se
          // confirma se um endereço existe.
          const corpo = typeof pedido.body === "string" ? pedido.body : "";
          if (
            c === null ||
            !(await receberAviso(base, c, conta, pedido.headers, corpo, cfg))
          ) {
            throw new ErroEnvios(
              "shipping.signature_invalid",
              "a assinatura do aviso não confere",
            );
          }
          return { recebido: true };
        }),
    );
    pronto();
  });
}

// ---------------- Corrigir o peso e mudar o serviço (docs/36 §19): comuns

const Motivo = Type.String({ minLength: 3, maxLength: 500 });

export const CorpoCorrigirPeso = Type.Object(
  {
    versao: Type.Integer({ minimum: 1 }),
    peso_g: Type.Union([
      Type.Integer({ minimum: 1, maximum: 1_000_000 }),
      Type.Null(),
    ]),
    motivo: Motivo,
  },
  { additionalProperties: false },
);

export const CorpoMudarServico = Type.Object(
  {
    versao: Type.Integer({ minimum: 1 }),
    conta: Type.Union([IdConta, Type.Null()]),
    servico: Type.Union([
      Type.String({ pattern: "^[0-9A-Za-z_.:/-]{1,100}$" }),
      Type.Null(),
    ]),
    motivo: Motivo,
  },
  { additionalProperties: false },
);

export const dadosDoServico = (b: {
  versao: number;
  conta: string | null;
  servico: string | null;
  motivo: string;
}) => ({ ...b, conta: b.conta === null ? null : semPrefixo(b.conta) });

/**
 * Uma IA não muda o serviço (muda o custo e a transportadora): nem uma chave
 * de agente, nem um pedido com a IA declarada (como o R11 do docs/33).
 */
export function semIaNoServico(agenteIa = false) {
  if (agenteIa || rastoActual()?.ia !== undefined) {
    throw new ErroEnvios(
      "shipping.ai_not_allowed",
      "uma IA não muda o serviço de uma expedição (docs/36 §19.3)",
    );
  }
}

export function paraServicosDaExpedicao(
  r: Awaited<ReturnType<typeof servicosDaExpedicao>>,
) {
  const servico = (x: { conta: string; servico: string } | null) =>
    x === null ? null : { conta: `cac_${x.conta}`, servico: x.servico };
  return {
    versao: r.versao,
    peso_calculado_g: r.peso_calculado_g,
    peso_corrigido_g: r.peso_corrigido_g,
    vendido: servico(r.vendido),
    escolhido: servico(r.escolhido),
    escolhido_nao_serve: r.escolhido_nao_serve,
    opcoes: r.opcoes.map((o) => ({ ...o, conta: `cac_${o.conta}` })),
  };
}

export function paraCorrecao(
  c: Awaited<ReturnType<typeof correcoesDaExpedicao>>[number],
) {
  const conta = (v: unknown) => {
    if (v === null || typeof v !== "object") return v;
    const o = v as { conta?: string; servico?: string };
    return { conta: `cac_${String(o.conta)}`, servico: o.servico };
  };
  return {
    campo: c.campo,
    antes: c.campo === "servico" ? conta(c.antes) : c.antes,
    depois: c.campo === "servico" ? conta(c.depois) : c.depois,
    motivo: c.motivo,
    quem: c.quem,
    em: c.em.toISOString(),
  };
}
