import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  ESTADOS_PAGAMENTO,
  METODOS_PAGAMENTO,
  type BaseDados,
} from "../base/esquema.js";
import { escrever, idCom, semPrefixo, umDe } from "../catalogo/rotas.js";
import {
  encomendaDaSessao,
  naSessao,
  traduzir as traduzirCheckout,
} from "../checkout/repositorio.js";
import {
  ErroCheckout,
  ESTADO_DO_CODIGO as ESTADO_CHECKOUT,
} from "../checkout/erros.js";
import { chaveDo } from "../identidade/autenticacao.js";
import type { ConfigPagamentos } from "./adaptador.js";
import { ErroPagamentos, ESTADO_DO_CODIGO } from "./erros.js";
import {
  cobrar,
  comercianteDaConta,
  consultarPagamento,
  criarConta,
  criarMetodo,
  definirCredenciais,
  lerPagamento,
  listarContas,
  listarDiferencas,
  listarMetodos,
  listarPagamentos,
  metodosDoMercado,
  mudarConta,
  mudarMetodo,
  NOME_DO_METODO,
  pagamentoDaEncomenda,
  prepararPagamento,
  receberAviso,
  resolverDiferenca,
  testarConta,
  traduzir,
  type PagamentoLido,
} from "./repositorio.js";

// A API dos pagamentos (docs/26 §8; issue #287; Diogo, 09/10/2026: «sim,
// aprovo; avança com o código da fatia 8»): o pagamento pelo token do
// checkout, os avisos dos prestadores (pela assinatura) e a Administração
// das contas, da régua, dos pagamentos e da fila de diferenças.

function paraApi(erro: unknown): unknown {
  const e = traduzir(erro);
  if (e instanceof ErroPagamentos) {
    return new ErroApi(
      e.codigo,
      ESTADO_DO_CODIGO[e.codigo],
      e.codigo.endsWith(".not_found")
        ? { pt: "Não encontrado", en: "Not found" }
        : {
            pt: "Pedido recusado pelos pagamentos",
            en: "Rejected by payments",
          },
      e.pormenor === undefined
        ? e.message
        : `${e.message} ${JSON.stringify(e.pormenor)}`,
    );
  }
  const c = traduzirCheckout(e);
  if (c instanceof ErroCheckout) {
    return new ErroApi(
      c.codigo,
      ESTADO_CHECKOUT[c.codigo],
      c.codigo.endsWith(".not_found")
        ? { pt: "Não encontrado", en: "Not found" }
        : { pt: "Pedido recusado pelo checkout", en: "Rejected by checkout" },
      c.message,
    );
  }
  return e;
}

async function emPagamentos<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    const e = paraApi(erro);
    if (e instanceof ErroApi && e.codigo === "payments.retry") {
      void resposta.header("Retry-After", "1");
    }
    throw e;
  }
}

const Livre = Type.Record(Type.String(), Type.Unknown());
const IdConta = idCom("pac", "pac_…");
const IdMetodo = idCom("pmm", "pmm_…");
const IdPagamento = idCom("pay", "pay_…");
const IdDiferenca = idCom("pdi", "pdi_…");
const IdMercado = idCom("mkt", "mkt_…");
const IdEncomenda = idCom("ord", "ord_…");
const Token = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const Metodo = umDe(METODOS_PAGAMENTO);
const Versao = Type.Integer({ minimum: 1 });
const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** O pagamento para o cliente do checkout: estado e instruções, sem ids internos da conta. */
const paraCliente = (p: PagamentoLido) => ({
  id: `pay_${p.id}`,
  metodo: p.metodo,
  estado: p.estado,
  montante: Number(p.montante),
  moeda: p.moeda,
  instrucoes: p.instrucoes,
  expira_em: p.expira_em.toISOString(),
  modo: p.modo,
});

const paraAdministracao = (p: PagamentoLido) => ({
  ...paraCliente(p),
  encomenda: `ord_${p.encomenda_id}`,
  conta: `pac_${p.conta_id}`,
  prestador: p.prestador,
  referencia: p.referencia,
  referencia_prestador: p.referencia_prestador,
  criado_em: p.criado_em.toISOString(),
  actualizado_em: p.actualizado_em.toISOString(),
});

export function rotasDosPagamentos(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigPagamentos | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const publico = { ambito: "publico" as const, loja: true };
  const ParamToken = Type.Object({ token: Token });

  // ----------------------------------------------- Checkout alojado (token)

  rotas.get(
    "/checkout/:token/payment-methods",
    {
      config: publico,
      schema: {
        description:
          "Os métodos de pagamento do mercado da sessão (a régua do comerciante; só os activos com a conta pronta), pela ordem dele.",
        params: ParamToken,
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, () =>
        naSessao(
          base,
          pedido.params.token,
          async (trx, s) => ({
            dados: (await metodosDoMercado(trx, s.mercado_id)).map((m) => ({
              metodo: m.metodo,
              nome: NOME_DO_METODO[m.metodo],
              escolhido: s.metodo_pagamento === m.metodo,
              modo: m.modo,
            })),
          }),
          { soAberta: false },
        ),
      ),
  );

  rotas.post(
    "/checkout/:token/payment",
    {
      config: publico,
      schema: {
        description:
          "Depois do botão final: cria o pagamento da encomenda e pede-o ao prestador; devolve as instruções (Multibanco: entidade, referência, montante, prazo; MB WAY: aprovar na aplicação). Com um pagamento a decorrer, devolve esse (o clique repetido). Depois de um falhado ou expirado, pode escolher outro método da régua, dentro das 24 h. Pago só com a prova do prestador.",
        params: ParamToken,
        response: { 201: Livre, 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => {
        // O corpo é opcional (`{ "metodo": … }`): sem ele, o método da
        // encomenda. Lê-se aqui porque um esquema de corpo obriga a ter corpo.
        const corpo: unknown = pedido.body;
        let metodo: (typeof METODOS_PAGAMENTO)[number] | undefined;
        if (corpo !== undefined && corpo !== null) {
          const m =
            typeof corpo === "object" && !Array.isArray(corpo)
              ? (corpo as Record<string, unknown>)
              : null;
          if (
            m === null ||
            Object.keys(m).some((k) => k !== "metodo") ||
            (m["metodo"] !== undefined &&
              !(METODOS_PAGAMENTO as readonly unknown[]).includes(m["metodo"]))
          ) {
            throw new ErroPagamentos(
              "payments.invalid_field",
              `o corpo só pode ter «metodo» (${METODOS_PAGAMENTO.join(", ")})`,
            );
          }
          metodo = m["metodo"] as
            (typeof METODOS_PAGAMENTO)[number] | undefined;
        }
        // Sem a chave das credenciais ou o adaptador, nada se cria.
        if (cfg?.chave === undefined || cfg.adaptadores.eupago === undefined) {
          throw new ErroPagamentos(
            "payments.not_configured",
            "os pagamentos não estão ligados neste servidor (PAGAMENTOS_CHAVE)",
          );
        }
        const { preparado, sessao } = await naSessao(
          base,
          pedido.params.token,
          async (trx, s) => ({
            sessao: s.id,
            preparado: await prepararPagamento(
              trx,
              s,
              metodo,
              s.estado === "concluida"
                ? await encomendaDaSessao(trx, s.id)
                : null,
            ),
          }),
          { soAberta: false },
        );
        if (!preparado.novo) {
          return resposta.code(200).send(paraCliente(preparado.pagamento));
        }
        const p = await cobrar(base, preparado, `checkout:chk_${sessao}`, cfg);
        return resposta.code(201).send(paraCliente(p));
      }),
  );

  rotas.get(
    "/checkout/:token/payment",
    {
      config: publico,
      schema: {
        description:
          "O pagamento a decorrer (ou o último) e o estado da encomenda. O ecrã pergunta; o que conta é o aviso ou a consulta ao prestador.",
        params: ParamToken,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, () =>
        naSessao(
          base,
          pedido.params.token,
          async (trx, s) => {
            const id =
              s.estado === "concluida"
                ? await encomendaDaSessao(trx, s.id)
                : null;
            if (id === null) {
              throw new ErroPagamentos(
                "payments.not_found",
                "a encomenda ainda não foi feita",
              );
            }
            const e = await trx
              .selectFrom("encomenda")
              .select(["estado"])
              .where("id", "=", id)
              .executeTakeFirstOrThrow();
            const p = await pagamentoDaEncomenda(trx, id);
            return {
              encomenda: { id: `ord_${id}`, estado: e.estado },
              pagamento: p === undefined ? null : paraCliente(p),
            };
          },
          { soAberta: false },
        ),
      ),
  );

  // ---------------------------------------- Avisos dos prestadores (2.0)

  // Num plugin próprio: o corpo lê-se em bruto (a assinatura é sobre ele).
  void rotas.register((avisos, _o, pronto) => {
    avisos.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 65536 },
      (_pedido, corpo, feito) => {
        feito(null, corpo);
      },
    );
    avisos.withTypeProvider<TypeBoxTypeProvider>().post(
      "/webhooks/payments/:conta",
      {
        // Com o limite por IP das rotas públicas da loja (revisão do #288,
        // P2-1).
        config: { ambito: "publico" as const, loja: true },
        schema: {
          description:
            "Os avisos de um prestador para uma conta de pagamento. A assinatura confere-se antes de ler; o aviso grava-se em bruto antes de responder; o mesmo evento duas vezes não conta duas vezes; um processamento que falha responde 5xx para o prestador reenviar.",
          params: Type.Object({ conta: IdConta }),
          response: {
            200: Type.Object({ recebido: Type.Boolean() }),
            ...RESPOSTA_DE_ERRO,
          },
        },
      },
      async (pedido, resposta) =>
        emPagamentos(resposta, async () => {
          const contaId = semPrefixo(pedido.params.conta);
          const c = await comercianteDaConta(base, contaId);
          // Conta desconhecida responde como assinatura errada: não se
          // confirma se um endereço existe (revisão do #288, P2-1).
          if (c === null) {
            throw new ErroPagamentos(
              "payments.signature_invalid",
              "a assinatura do aviso não confere",
            );
          }
          const corpo = typeof pedido.body === "string" ? pedido.body : "";
          const r = await receberAviso(
            base,
            c,
            contaId,
            pedido.headers,
            corpo,
            cfg,
          );
          if (r === "assinatura_invalida") {
            throw new ErroPagamentos(
              "payments.signature_invalid",
              "a assinatura do aviso não confere",
            );
          }
          return { recebido: true };
        }),
    );
    pronto();
  });

  // ------------------------------------------ Administração: as contas

  const paraConta = (c: Awaited<ReturnType<typeof listarContas>>[number]) => ({
    id: `pac_${c.id}`,
    prestador: c.prestador,
    nome: c.nome,
    modo: c.modo,
    estado: c.estado,
    credenciais_definidas_em: iso(c.credenciais_em),
    credenciais_definidas_por: c.credenciais_por,
    testada_em: iso(c.testada_em),
    endereco_dos_avisos: `/webhooks/payments/pac_${c.id}`,
    versao: c.versao,
  });

  rotas.get(
    "/payment-accounts",
    {
      config: { ambito: "payments:read" },
      schema: {
        description:
          "As contas do comerciante nos prestadores (sem as credenciais, que nunca saem), com o endereço dos avisos de cada uma.",
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => ({
        dados: (await listarContas(base, chaveDo(pedido).comercianteId)).map(
          paraConta,
        ),
      })),
  );

  rotas.post(
    "/payment-accounts",
    {
      config: { ambito: "payments:write" },
      schema: {
        description:
          "Cria uma conta de pagamento (rascunho, modo teste). O dinheiro vai sempre para a conta do comerciante no prestador; o Eurolify nunca o recebe (ADR-0038).",
        body: Type.Object(
          {
            prestador: umDe(["eupago"] as const),
            nome: Type.String({ minLength: 1, maxLength: 100 }),
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
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emPagamentos(resposta, async () => ({
          id: `pac_${await criarConta(trx, chave.comercianteId, pedido.body)}`,
        })),
      ),
  );

  rotas.patch(
    "/payment-accounts/:id",
    {
      config: { ambito: "payments:write" },
      schema: {
        description: "Muda o nome da conta, ou arquiva-a.",
        params: Type.Object({ id: IdConta }),
        body: Type.Object(
          {
            versao: Versao,
            nome: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            arquivar: Type.Optional(Type.Literal(true)),
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
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emPagamentos(resposta, async () => ({
          versao: await mudarConta(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.versao,
            {
              ...(pedido.body.nome === undefined
                ? {}
                : { nome: pedido.body.nome }),
              ...(pedido.body.arquivar === true ? { arquivar: true } : {}),
            },
          ),
        })),
      ),
  );

  rotas.put(
    "/payment-accounts/:id/credentials",
    {
      config: { ambito: "payments:accounts" },
      schema: {
        description:
          "Define a chave da API do canal no prestador e o segredo dos avisos. Ficam cifrados e nunca se devolvem; a conta volta a rascunho até à chamada de teste. Só o dono (payments:accounts).",
        params: Type.Object({ id: IdConta }),
        body: Type.Object(
          {
            chave: Type.String({ minLength: 8, maxLength: 200 }),
            segredo_aviso: Type.String({ minLength: 16, maxLength: 200 }),
          },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emPagamentos(resposta, async () => {
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
    "/payment-accounts/:id/test",
    {
      config: { ambito: "payments:accounts" },
      schema: {
        description:
          "A chamada de teste ao prestador com as credenciais da conta: se ele as aceitar, a conta fica pronta (só então os métodos dela aparecem no checkout).",
        params: Type.Object({ id: IdConta }),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => ({
        versao: await testarConta(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
          cfg,
        ),
      })),
  );

  // ------------------------------------------ Administração: a régua

  const paraMetodo = (
    m: Awaited<ReturnType<typeof listarMetodos>>[number],
  ) => ({
    id: `pmm_${m.id}`,
    mercado: `mkt_${m.mercado_id}`,
    metodo: m.metodo,
    conta: `pac_${m.conta_id}`,
    ordem: m.ordem,
    prazo_minutos: m.prazo_minutos,
    estado: m.estado,
    versao: m.versao,
  });

  rotas.get(
    "/payment-methods",
    {
      config: { ambito: "payments:read" },
      schema: {
        description: "A régua método → conta, por mercado.",
        querystring: Type.Object(
          { mercado: Type.Optional(IdMercado) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => ({
        dados: (
          await listarMetodos(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.mercado === undefined
              ? undefined
              : semPrefixo(pedido.query.mercado),
          )
        ).map(paraMetodo),
      })),
  );

  rotas.post(
    "/payment-methods",
    {
      config: { ambito: "payments:write" },
      schema: {
        description:
          "Liga um método a uma conta num mercado (um activo por método e mercado). O prazo é o tempo do cliente para pagar (por omissão: MB WAY 10 min, Multibanco 24 h).",
        body: Type.Object(
          {
            mercado: IdMercado,
            metodo: Metodo,
            conta: IdConta,
            ordem: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
            prazo_minutos: Type.Optional(
              Type.Integer({ minimum: 5, maximum: 1440 }),
            ),
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
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emPagamentos(resposta, async () => ({
          id: `pmm_${await criarMetodo(trx, chave.comercianteId, {
            mercado: semPrefixo(pedido.body.mercado),
            metodo: pedido.body.metodo,
            conta: semPrefixo(pedido.body.conta),
            ...(pedido.body.ordem === undefined
              ? {}
              : { ordem: pedido.body.ordem }),
            ...(pedido.body.prazo_minutos === undefined
              ? {}
              : { prazo_minutos: pedido.body.prazo_minutos }),
          })}`,
        })),
      ),
  );

  rotas.patch(
    "/payment-methods/:id",
    {
      config: { ambito: "payments:write" },
      schema: {
        description:
          "Muda a conta, a ordem ou o prazo de um método, ou arquiva-o.",
        params: Type.Object({ id: IdMetodo }),
        body: Type.Object(
          {
            versao: Versao,
            conta: Type.Optional(IdConta),
            ordem: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
            prazo_minutos: Type.Optional(
              Type.Integer({ minimum: 5, maximum: 1440 }),
            ),
            arquivar: Type.Optional(Type.Literal(true)),
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
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emPagamentos(resposta, async () => ({
          versao: await mudarMetodo(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.versao,
            {
              ...(pedido.body.conta === undefined
                ? {}
                : { conta: semPrefixo(pedido.body.conta) }),
              ...(pedido.body.ordem === undefined
                ? {}
                : { ordem: pedido.body.ordem }),
              ...(pedido.body.prazo_minutos === undefined
                ? {}
                : { prazo_minutos: pedido.body.prazo_minutos }),
              ...(pedido.body.arquivar === true ? { arquivar: true } : {}),
            },
          ),
        })),
      ),
  );

  // ---------------------------------------- Administração: os pagamentos

  rotas.get(
    "/payments",
    {
      config: { ambito: "payments:read" },
      schema: {
        description: "Os pagamentos, por ordem de criação.",
        querystring: Type.Object(
          {
            encomenda: Type.Optional(IdEncomenda),
            estado: Type.Optional(umDe(ESTADOS_PAGAMENTO)),
            limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            depois: Type.Optional(IdPagamento),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            dados: Type.Array(Livre),
            seguinte: Type.Union([Type.String(), Type.Null()]),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => {
        const limite = pedido.query.limite ?? 50;
        const linhas = await listarPagamentos(
          base,
          chaveDo(pedido).comercianteId,
          {
            limite,
            ...(pedido.query.encomenda === undefined
              ? {}
              : { encomenda: semPrefixo(pedido.query.encomenda) }),
            ...(pedido.query.estado === undefined
              ? {}
              : { estado: pedido.query.estado }),
            ...(pedido.query.depois === undefined
              ? {}
              : { depois: semPrefixo(pedido.query.depois) }),
          },
        );
        const dados = linhas.slice(0, limite).map(paraAdministracao);
        return {
          dados,
          seguinte:
            linhas.length > limite
              ? (dados[dados.length - 1]?.id ?? null)
              : null,
        };
      }),
  );

  rotas.get(
    "/payments/:id",
    {
      config: { ambito: "payments:read" },
      schema: {
        description:
          "Um pagamento com as transições (de, para, origem, aviso, quem, motivo, quando).",
        params: Type.Object({ id: IdPagamento }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => {
        const r = await lerPagamento(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          ...paraAdministracao(r.pagamento),
          transicoes: r.transicoes.map((t) => ({
            de: t.de,
            para: t.para,
            origem: t.origem,
            aviso: t.aviso_id === null ? null : `pwh_${t.aviso_id}`,
            quem: t.quem,
            motivo: t.motivo,
            em: t.em.toISOString(),
          })),
        };
      }),
  );

  rotas.post(
    "/payments/:id/check",
    {
      config: { ambito: "payments:write" },
      schema: {
        description:
          "Consulta o prestador e aplica o que ele disser (um pagamento pago passa a encomenda a paga). Um estado que o prestador não diz claramente não muda nada.",
        params: Type.Object({ id: IdPagamento }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => {
        const chave = chaveDo(pedido);
        const r = await consultarPagamento(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          `chave:key_${chave.chaveId}`,
          cfg,
        );
        return {
          no_prestador: r.prestador,
          pagamento: paraAdministracao(r.pagamento),
        };
      }),
  );

  // ----------------------------------- Administração: a fila de diferenças

  rotas.get(
    "/payment-issues",
    {
      config: { ambito: "payments:read" },
      schema: {
        description:
          "A fila de diferenças (incerto, aviso sem pagamento, montante ou moeda diferentes, transição impossível, pago depois de cancelada), com a prova.",
        querystring: Type.Object(
          { estado: Type.Optional(umDe(["aberta", "resolvida"] as const)) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPagamentos(resposta, async () => ({
        dados: (
          await listarDiferencas(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.estado,
          )
        ).map((d) => ({
          id: `pdi_${d.id}`,
          pagamento: d.pagamento_id === null ? null : `pay_${d.pagamento_id}`,
          aviso: d.aviso_id === null ? null : `pwh_${d.aviso_id}`,
          motivo: d.motivo,
          prova: d.prova,
          estado: d.estado,
          resolucao: d.resolucao,
          resolvida_por: d.resolvida_por,
          resolvida_em: iso(d.resolvida_em),
          criada_em: d.criada_em.toISOString(),
        })),
      })),
  );

  rotas.post(
    "/payment-issues/:id/resolve",
    {
      config: { ambito: "payments:resolve" },
      schema: {
        description:
          "Uma pessoa resolve uma diferença, com o texto da resolução (âmbito payments:resolve, só do dono). Num pagamento incerto, pode decidir se foi pago (`capturado`) ou não (`falhado`), depois de ver a conta no prestador. O sistema nunca a resolve sozinho.",
        params: Type.Object({ id: IdDiferenca }),
        body: Type.Object(
          {
            resolucao: Type.String({ minLength: 1, maxLength: 2000 }),
            pagamento: Type.Optional(umDe(["capturado", "falhado"] as const)),
          },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emPagamentos(resposta, async () => {
          await resolverDiferenca(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            `chave:key_${chave.chaveId}`,
          );
          return null;
        }),
      ),
  );
}
