import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type, type Static } from "typebox";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  ENTIDADES_DO_RASTO_CLIENTE,
  ESTADOS_VIES,
  type BaseDados,
} from "../base/esquema.js";
import {
  ConsultaPagina,
  escrever,
  idCom,
  Instante,
  Lista,
  semPrefixo,
  umDe,
} from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { CabecalhoIdempotencia } from "../identidade/rotas.js";
import { ErroClientes, type CodigoErroClientes } from "./erros.js";
import type { ConsultaVies } from "./vies.js";
import {
  alterarCliente,
  alterarEtiqueta,
  alterarPerfil,
  criarCliente,
  criarEtiqueta,
  criarPerfil,
  linhaDoTempo,
  listarIsencoes,
  listarValidacoes,
  obterIsencao,
  obterValidacao,
  pedidoViesDoPerfil,
  porIsencao,
  registarVies,
  retirarIsencao,
  listarClientes,
  listarEtiquetas,
  listarPerfis,
  mudarEstadoPerfil,
  obterCliente,
  obterEtiqueta,
  obterPerfil,
  porEtiqueta,
  tirarEtiqueta,
  tornarPrincipal,
  traduzir,
} from "./repositorio.js";

// A API de Administração de Clientes, parte 1 (docs/23 §7.1; issue #233;
// Diogo, 09/10/2026: «sim, aprovo; avança com o código da fatia 5»): fichas,
// perfis de faturação, etiquetas e a linha do tempo. Âmbitos
// `customers:read` e `customers:write`. As escritas passam pelo `escrever`
// do Catálogo (Idempotency-Key e `eurolify.quem` na mesma transacção).

const ESTADO_DO_CODIGO: Record<CodigoErroClientes, number> = {
  "customers.not_found": 404,
  "customers.invalid_field": 400,
  "customers.retry": 503,
  "customers.version_conflict": 409,
  "customers.invalid_transition": 409,
  "customers.profile_used": 409,
  "customers.primary_profile": 409,
  "customers.tag_duplicate": 409,
  "customers.tag_in_use": 409,
  "customers.tag_archived": 409,
  "customers.immutable_identity": 422,
  "customers.name_required": 422,
  "customers.email_invalid": 422,
  "customers.phone_invalid": 422,
  "customers.language_invalid": 422,
  "customers.country_invalid": 422,
  "customers.nif_invalid": 422,
  "customers.nif_country_required": 422,
  "customers.company_requires_nif": 422,
  "customers.address_incomplete": 422,
  "customers.change_without_who": 500,
  "customers.vies_not_applicable": 409,
  "customers.vies_disabled": 503,
  "customers.exemption_active": 409,
  "customers.exemption_immutable": 409,
  "customers.exemption_by_person": 422,
};

function paraApi(erro: unknown, resposta: FastifyReply): unknown {
  const e = traduzir(erro);
  if (!(e instanceof ErroClientes)) return e;
  if (e.codigo === "customers.retry") void resposta.header("Retry-After", "1");
  const mensagens =
    e.codigo === "customers.not_found"
      ? { pt: "Não encontrado", en: "Not found" }
      : e.codigo === "customers.retry"
        ? {
            pt: "Outra operação tinha o registo tomado; tente outra vez",
            en: "Another operation held the record; try again",
          }
        : {
            pt: "Pedido recusado por Clientes",
            en: "Rejected by customers",
          };
  // O texto do PostgreSQL não sai (docs/18 §2), salvo as mensagens que os
  // gatilhos escrevem para fora (começam pelo código). Nunca leva o NIF, o
  // e-mail nem o telefone (R12): as mensagens da 0037 não os repetem.
  const daBase =
    typeof (e.cause as { code?: unknown } | undefined)?.code === "string" &&
    !e.message.startsWith(`${e.codigo}:`);
  const detalhe = daBase ? "um valor do pedido não é aceite" : e.message;
  return new ErroApi(e.codigo, ESTADO_DO_CODIGO[e.codigo], mensagens, detalhe);
}

async function emClientes<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    throw paraApi(erro, resposta);
  }
}

// ---------------------------------------------------------- Os esquemas

const IdCliente = idCom("cus", "cus_…");
const IdPerfil = idCom("bpf", "bpf_…");
const IdEtiqueta = idCom("ctg", "ctg_…");
const Pais = Type.String({ pattern: "^[A-Z]{2}$" });
const Lingua = Type.String({ pattern: "^[a-z]{2,3}(-[A-Z]{2})?$" });
const Versao = { versao: Type.Integer({ minimum: 1 }) };
const PedidoVersao = Type.Object(Versao, { additionalProperties: false });

const Cliente = Type.Object({
  id: Type.String({ description: "cus_…" }),
  nome: Type.String(),
  emails: Type.Array(Type.String(), {
    description: "O primeiro é o de contacto",
  }),
  telefones: Type.Array(Type.String(), { description: "Em E.164" }),
  lingua: Type.Union([Type.String(), Type.Null()]),
  pais: Type.Union([Type.String(), Type.Null()], {
    description: "Residência declarada; não é o país do contribuinte",
  }),
  estado: Type.String(),
  limitado: Type.Boolean(),
  etiquetas: Type.Array(Type.String({ description: "ctg_…" })),
  versao: Type.Integer(),
  criado_em: Instante,
  actualizado_em: Instante,
});
type LinhaCliente = Awaited<ReturnType<typeof obterCliente>>;
const paraCliente = (c: LinhaCliente): Static<typeof Cliente> => ({
  id: `cus_${c.id}`,
  nome: c.nome,
  emails: c.emails,
  telefones: c.telefones,
  lingua: c.lingua,
  pais: c.pais,
  estado: c.estado,
  limitado: c.limitado,
  etiquetas: c.etiquetas.map((e) => `ctg_${e}`),
  versao: c.versao,
  criado_em: c.criado_em.toISOString(),
  actualizado_em: c.actualizado_em.toISOString(),
});

const Nome = Type.String({ minLength: 1, maxLength: 200 });
const Emails = Type.Array(Type.String({ minLength: 3, maxLength: 254 }), {
  maxItems: 10,
});
const Telefones = Type.Array(
  Type.String({ pattern: "^\\+[1-9][0-9]{6,14}$" }),
  { maxItems: 10 },
);
const PedidoCliente = Type.Object(
  {
    nome: Nome,
    emails: Type.Optional(Emails),
    telefones: Type.Optional(Telefones),
    lingua: Type.Optional(Type.Union([Lingua, Type.Null()])),
    pais: Type.Optional(Type.Union([Pais, Type.Null()])),
  },
  { additionalProperties: false },
);
const PedidoAlterarCliente = Type.Object(
  {
    ...Versao,
    nome: Type.Optional(Nome),
    emails: Type.Optional(Emails),
    telefones: Type.Optional(Telefones),
    lingua: Type.Optional(Type.Union([Lingua, Type.Null()])),
    pais: Type.Optional(Type.Union([Pais, Type.Null()])),
  },
  { additionalProperties: false },
);

const MoradaEsquema = Type.Object(
  {
    linha1: Type.String({ minLength: 1, maxLength: 200 }),
    linha2: Type.Optional(
      Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    ),
    codigo_postal: Type.String({
      minLength: 1,
      maxLength: 20,
      description:
        "Decide os territórios especiais no Motor de IVA (nunca a localidade)",
    }),
    localidade: Type.String({ minLength: 1, maxLength: 100 }),
    pais: Pais,
  },
  { additionalProperties: false },
);
const MoradaResposta = Type.Union([
  Type.Object({
    linha1: Type.String(),
    linha2: Type.Union([Type.String(), Type.Null()]),
    codigo_postal: Type.String(),
    localidade: Type.String(),
    pais: Type.String(),
  }),
  Type.Null(),
]);
const TipoPerfil = Type.Union([
  Type.Literal("particular"),
  Type.Literal("empresa"),
]);

const Perfil = Type.Object({
  id: Type.String({ description: "bpf_…" }),
  cliente: Type.String({ description: "cus_…" }),
  tipo: TipoPerfil,
  nome_documento: Type.String({
    description: "O nome que sai no documento fiscal",
  }),
  nif: Type.Union([Type.String(), Type.Null()], {
    description:
      "O NIF pela régua: com o prefixo fiscal, excepto no país do comerciante (docs/23 §3.3)",
  }),
  nif_escrito: Type.Union([Type.String(), Type.Null()], {
    description: "Exactamente como foi escrito",
  }),
  pais_contribuinte: Type.Union([Type.String(), Type.Null()]),
  morada: MoradaResposta,
  principal: Type.Boolean(),
  estado_vies: umDe(ESTADOS_VIES),
  validado_em: Type.Union([Instante, Type.Null()], {
    description:
      "A data da última resposta do VIES (válido ou inválido); sem resposta, a anterior fica (Q6)",
  }),
  isencao_em_vigor: Type.Boolean({
    description: "Se tem uma isenção manual em vigor (§13.5)",
  }),
  estado: Type.String(),
  usado_em_documento: Type.Boolean({
    description:
      "Depois de usado num documento, o NIF, o tipo e o país não mudam (R4): cria-se outro perfil",
  }),
  versao: Type.Integer(),
  criado_em: Instante,
  actualizado_em: Instante,
});
type LinhaPerfil = Awaited<ReturnType<typeof obterPerfil>>;
const paraPerfil = (p: LinhaPerfil): Static<typeof Perfil> => ({
  id: `bpf_${p.id}`,
  cliente: `cus_${p.cliente_id}`,
  tipo: p.tipo,
  nome_documento: p.nome_documento,
  nif: p.nif,
  nif_escrito: p.nif_escrito,
  pais_contribuinte: p.pais_contribuinte,
  morada:
    p.morada_linha1 === null
      ? null
      : {
          linha1: p.morada_linha1,
          linha2: p.morada_linha2,
          codigo_postal: p.morada_codigo_postal ?? "",
          localidade: p.morada_localidade ?? "",
          pais: p.morada_pais ?? "",
        },
  principal: p.principal,
  estado_vies: p.estado_vies,
  validado_em: p.validado_em === null ? null : p.validado_em.toISOString(),
  isencao_em_vigor: p.isencao_em_vigor,
  estado: p.estado,
  usado_em_documento: p.usado_em_documento,
  versao: p.versao,
  criado_em: p.criado_em.toISOString(),
  actualizado_em: p.actualizado_em.toISOString(),
});

const Nif = Type.String({
  minLength: 1,
  maxLength: 40,
  description:
    "Como a pessoa o escreveu (com ou sem prefixo, com pontuação); a régua tira o país e o número",
});
const PedidoPerfil = Type.Object(
  {
    tipo: TipoPerfil,
    nome_documento: Type.String({ minLength: 1, maxLength: 200 }),
    nif: Type.Optional(Type.Union([Nif, Type.Null()])),
    pais_contribuinte: Type.Optional(Type.Union([Pais, Type.Null()])),
    morada: Type.Optional(Type.Union([MoradaEsquema, Type.Null()])),
  },
  { additionalProperties: false },
);
const PedidoAlterarPerfil = Type.Object(
  {
    ...Versao,
    tipo: Type.Optional(TipoPerfil),
    nome_documento: Type.Optional(
      Type.String({ minLength: 1, maxLength: 200 }),
    ),
    nif: Type.Optional(Type.Union([Nif, Type.Null()])),
    pais_contribuinte: Type.Optional(Type.Union([Pais, Type.Null()])),
    morada: Type.Optional(Type.Union([MoradaEsquema, Type.Null()])),
  },
  { additionalProperties: false },
);

const Etiqueta = Type.Object({
  id: Type.String({ description: "ctg_…" }),
  nome: Type.String(),
  estado: Type.String(),
  versao: Type.Integer(),
  criado_em: Instante,
});
type LinhaEtiqueta = Awaited<ReturnType<typeof obterEtiqueta>>;
const paraEtiqueta = (e: LinhaEtiqueta): Static<typeof Etiqueta> => ({
  id: `ctg_${e.id}`,
  nome: e.nome,
  estado: e.estado,
  versao: e.versao,
  criado_em: e.criado_em.toISOString(),
});
const NomeEtiqueta = Type.String({ minLength: 1, maxLength: 100 });
const PedidoEtiqueta = Type.Object(
  { nome: NomeEtiqueta },
  { additionalProperties: false },
);
const PedidoAlterarEtiqueta = Type.Object(
  { ...Versao, nome: Type.Optional(NomeEtiqueta) },
  { additionalProperties: false },
);

/** O prefixo público de cada entidade do rasto. */
const PREFIXO: Record<string, string | undefined> = {
  cliente: "cus",
  perfil_faturacao: "bpf",
  etiqueta_cliente: "ctg",
};
const Alteracao = Type.Object({
  id: Type.String({ description: "chg_…" }),
  em: Instante,
  quem: Type.String({
    description:
      "chave:key_…, pessoa:per_… ou sistema:<tarefa>; um identificador, nunca o nome",
  }),
  origem: Type.Union([Type.String(), Type.Null()]),
  transacao: Type.String({
    description: "As entradas com a mesma transacção são uma só alteração",
  }),
  entidade: umDe(ENTIDADES_DO_RASTO_CLIENTE),
  entidade_id: Type.Union([Type.String(), Type.Null()]),
  operacao: Type.Union([
    Type.Literal("criado"),
    Type.Literal("alterado"),
    Type.Literal("apagado"),
  ]),
  campos: Type.Record(
    Type.String(),
    Type.Object({ antes: Type.Unknown(), depois: Type.Unknown() }),
  ),
});

// A procura vai no corpo de um POST, nunca no endereço: o endereço fica nos
// registos da aplicação e do proxy, e um e-mail, um telefone ou um NIF não
// podem lá ficar (R12; revisão do #234, P1-1).
const PedidoProcura = Type.Object(
  {
    procura: Type.String({
      minLength: 2,
      maxLength: 254,
      description:
        "Um e-mail (com @), um telefone (começa por +; espaços e hífenes não contam) ou um NIF (compara-se só o número); nunca o nome",
    }),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: ConsultaPagina.properties.cursor,
  },
  { additionalProperties: false },
);

const Validacao = Type.Object({
  id: Type.String({ description: "vvc_…" }),
  perfil: Type.String({ description: "bpf_…" }),
  pais_consultado: Type.String(),
  numero_consultado: Type.String(),
  requerente: Type.Union([Type.String(), Type.Null()], {
    description: "O NIF do comerciante enviado como requerente (Q7)",
  }),
  consultado_em: Instante,
  data_vies: Type.Union([Instante, Type.Null()]),
  resultado: Type.Union([
    Type.Literal("valido"),
    Type.Literal("invalido"),
    Type.Literal("indisponivel"),
  ]),
  codigo_erro: Type.Union([Type.String(), Type.Null()]),
  identificador_consulta: Type.Union([Type.String(), Type.Null()], {
    description: "O número de consulta do VIES; só vem com requerente",
  }),
  nome_devolvido: Type.Union([Type.String(), Type.Null()]),
  morada_devolvida: Type.Union([Type.String(), Type.Null()]),
  motivo: Type.String(),
  quem: Type.String(),
});
type LinhaValidacao = Awaited<ReturnType<typeof obterValidacao>>;
const paraValidacao = (v: LinhaValidacao): Static<typeof Validacao> => ({
  id: `vvc_${v.id}`,
  perfil: `bpf_${v.perfil_id}`,
  pais_consultado: v.pais_consultado,
  numero_consultado: v.numero_consultado,
  requerente:
    v.requerente_pais === null || v.requerente_numero === null
      ? null
      : `${v.requerente_pais}${v.requerente_numero}`,
  consultado_em: v.consultado_em.toISOString(),
  data_vies: v.data_vies === null ? null : v.data_vies.toISOString(),
  resultado: v.resultado,
  codigo_erro: v.codigo_erro,
  identificador_consulta: v.identificador_consulta,
  nome_devolvido: v.nome_devolvido,
  morada_devolvida: v.morada_devolvida,
  motivo: v.motivo,
  quem: v.quem,
});

const Isencao = Type.Object({
  id: Type.String({ description: "exm_…" }),
  perfil: Type.String({ description: "bpf_…" }),
  motivo: Type.String(),
  nota: Type.Union([Type.String(), Type.Null()]),
  posta_por: Type.String(),
  posta_em: Instante,
  em_vigor: Type.Boolean(),
  motivo_retirada: Type.Union([Type.String(), Type.Null()]),
  retirada_por: Type.Union([Type.String(), Type.Null()]),
  retirada_em: Type.Union([Instante, Type.Null()]),
});
type LinhaIsencao = Awaited<ReturnType<typeof obterIsencao>>;
const paraIsencao = (i: LinhaIsencao): Static<typeof Isencao> => ({
  id: `exm_${i.id}`,
  perfil: `bpf_${i.perfil_id}`,
  motivo: i.motivo,
  nota: i.nota,
  posta_por: i.posta_por,
  posta_em: i.posta_em.toISOString(),
  em_vigor: i.retirada_em === null,
  motivo_retirada: i.motivo_retirada,
  retirada_por: i.retirada_por,
  retirada_em: i.retirada_em === null ? null : i.retirada_em.toISOString(),
});
const PedidoIsencao = Type.Object(
  {
    motivo: Type.String({
      minLength: 1,
      maxLength: 500,
      description:
        "Porquê, com a prova que existe (ex.: «transportadora própria, declaração aduaneira entregue»)",
    }),
    nota: Type.Optional(
      Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
const PedidoRetirarIsencao = Type.Object(
  { motivo_retirada: Type.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
);

const ParametroId = (id: ReturnType<typeof idCom>) => Type.Object({ id });
const ParametroEtiquetaDoCliente = Type.Object({
  id: IdCliente,
  etiqueta: IdEtiqueta,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cursorDe = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function idDoCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID.test(id)) {
    throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
  }
  return id;
}
const limiteDe = (q: { limite?: string }) =>
  q.limite === undefined ? 25 : Number(q.limite);
const comPagina = <T, U>(
  p: { dados: T[]; total: number; ultimo: string | null },
  f: (x: T) => U,
) => ({
  dados: p.dados.map(f),
  total: p.total,
  ha_mais: p.ultimo !== null,
  cursor_seguinte: p.ultimo === null ? null : cursorDe(p.ultimo),
});

// ------------------------------------------------------------ As rotas

export function rotasDosClientes(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  /** Quem consulta o VIES (docs/23 §13.2); sem ele, a consulta pedida dá 503. */
  vies?: ConsultaVies,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const ler = { ambito: "customers:read" as const };
  const escrita = { ambito: "customers:write" as const };
  // Os perfis de faturação (NIF, morada fiscal) só o dono os escreve (Diogo,
  // 09/10/2026: «sim, só o dono»; docs/06, CX).
  const faturacao = { ambito: "customers:billing" as const };
  // A isenção manual de IVA, só o dono (Q4; docs/23 §13.5).
  const isencoes = { ambito: "customers:exemptions" as const };

  // ---- Fichas

  rotas.get(
    "/customers",
    {
      config: ler,
      schema: {
        description:
          "As fichas de clientes do comerciante (docs/23 §3.1), por ordem de criação, no formato das listas. Para procurar, POST /customers/search (o valor não vai no endereço).",
        querystring: ConsultaPagina,
        response: { 200: Lista(Cliente), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emClientes(resposta, () =>
          listarClientes(
            base,
            chaveDo(pedido).comercianteId,
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraCliente,
      ),
  );

  rotas.post(
    "/customers/search",
    {
      config: ler,
      schema: {
        description:
          "Procura fichas por e-mail, telefone ou NIF (só o número, como a régua compara), nunca pelo nome, no formato das listas. Não escreve nem pede Idempotency-Key; o valor vai no corpo para não ficar nos registos.",
        body: PedidoProcura,
        response: { 200: Lista(Cliente), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emClientes(resposta, () =>
          listarClientes(
            base,
            chaveDo(pedido).comercianteId,
            pedido.body.limite ?? 25,
            idDoCursor(pedido.body.cursor),
            pedido.body.procura,
          ),
        ),
        paraCliente,
      ),
  );

  rotas.get(
    "/customers/:id",
    {
      config: ler,
      schema: {
        description: "Uma ficha, com as etiquetas.",
        params: ParametroId(IdCliente),
        response: { 200: Cliente, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      paraCliente(
        await emClientes(resposta, () =>
          obterCliente(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.post(
    "/customers",
    {
      config: escrita,
      schema: {
        description:
          "Cria uma ficha (docs/23 §3.1). O e-mail não é único: duas pessoas são duas fichas, mesmo com o mesmo e-mail.",
        headers: CabecalhoIdempotencia,
        body: PedidoCliente,
        response: { 201: Cliente, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emClientes(resposta, async () => {
          const id = await criarCliente(trx, c.comercianteId, pedido.body);
          return paraCliente(await obterCliente(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.patch(
    "/customers/:id",
    {
      config: escrita,
      schema: {
        description: "Altera uma ficha activa, na versão lida.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoAlterarCliente,
        response: { 200: Cliente, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const { versao, ...alteracao } = pedido.body;
          const id = semPrefixo(pedido.params.id);
          await alterarCliente(trx, c.comercianteId, id, versao, alteracao);
          return paraCliente(await obterCliente(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.get(
    "/customers/:id/timeline",
    {
      config: ler,
      schema: {
        description:
          "A linha do tempo da ficha (docs/23 §3.8): cada mudança na ficha, nos perfis e nas etiquetas dela, com quem, quando, o antes e o depois, da mais recente para a mais antiga.",
        params: ParametroId(IdCliente),
        querystring: ConsultaPagina,
        response: { 200: Lista(Alteracao), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emClientes(resposta, () =>
          linhaDoTempo(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        (a) => {
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
        },
      ),
  );

  // ---- Perfis de faturação

  rotas.get(
    "/customers/:id/billing-profiles",
    {
      config: ler,
      schema: {
        description:
          "Os perfis de faturação da ficha (docs/23 §3.2): o principal primeiro.",
        params: ParametroId(IdCliente),
        response: {
          200: Type.Object({ dados: Type.Array(Perfil) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => ({
      dados: (
        await emClientes(resposta, () =>
          listarPerfis(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        )
      ).map(paraPerfil),
    }),
  );

  rotas.post(
    "/customers/:id/billing-profiles",
    {
      config: faturacao,
      schema: {
        description:
          "Cria um perfil de faturação na ficha. O NIF passa pela régua (docs/23 §3.3): sem prefixo nem país, só se aceita um NIF português válido; um número impossível é recusado. O primeiro perfil activo é o principal.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoPerfil,
        response: { 201: Perfil, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emClientes(resposta, async () => {
          const id = await criarPerfil(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
          );
          return paraPerfil(await obterPerfil(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.get(
    "/billing-profiles/:id",
    {
      config: ler,
      schema: {
        description: "Um perfil de faturação.",
        params: ParametroId(IdPerfil),
        response: { 200: Perfil, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      paraPerfil(
        await emClientes(resposta, () =>
          obterPerfil(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.patch(
    "/billing-profiles/:id",
    {
      config: faturacao,
      schema: {
        description:
          "Altera um perfil, na versão lida. Um NIF novo sem país é deduzido dele. Um perfil usado num documento não muda de NIF, tipo nem país (customers.profile_used): crie outro.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPerfil),
        body: PedidoAlterarPerfil,
        response: { 200: Perfil, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const { versao, ...alteracao } = pedido.body;
          const id = semPrefixo(pedido.params.id);
          await alterarPerfil(trx, c.comercianteId, id, versao, alteracao);
          return paraPerfil(await obterPerfil(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.post(
    "/billing-profiles/:id/make-primary",
    {
      config: faturacao,
      schema: {
        description:
          "Torna o perfil (activo) o principal da ficha; o anterior deixa de o ser na mesma transacção.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPerfil),
        response: { 200: Perfil, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await tornarPrincipal(trx, c.comercianteId, id);
          return paraPerfil(await obterPerfil(trx, c.comercianteId, id));
        }),
      ),
  );

  for (const [caminho, estado, texto] of [
    [
      "archive",
      "arquivado",
      "Arquiva o perfil. O principal só se arquiva se for o único activo (customers.primary_profile)",
    ],
    [
      "restore",
      "activo",
      "Repõe o perfil; é o principal se a ficha não tiver outro",
    ],
  ] as const) {
    rotas.post(
      `/billing-profiles/:id/${caminho}`,
      {
        config: faturacao,
        schema: {
          description: `${texto}, na versão lida.`,
          headers: CabecalhoIdempotencia,
          params: ParametroId(IdPerfil),
          body: PedidoVersao,
          response: { 200: Perfil, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, (trx, c) =>
          emClientes(resposta, async () => {
            const id = semPrefixo(pedido.params.id);
            await mudarEstadoPerfil(
              trx,
              c.comercianteId,
              id,
              pedido.body.versao,
              estado,
            );
            return paraPerfil(await obterPerfil(trx, c.comercianteId, id));
          }),
        ),
    );
  }

  // ---- Etiquetas

  rotas.get(
    "/customer-tags",
    {
      config: ler,
      schema: {
        description:
          "As etiquetas de cliente (docs/23 §3.5), que as listas de preços B2B usam.",
        querystring: ConsultaPagina,
        response: { 200: Lista(Etiqueta), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emClientes(resposta, () =>
          listarEtiquetas(
            base,
            chaveDo(pedido).comercianteId,
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraEtiqueta,
      ),
  );

  rotas.get(
    "/customer-tags/:id",
    {
      config: ler,
      schema: {
        description: "Uma etiqueta.",
        params: ParametroId(IdEtiqueta),
        response: { 200: Etiqueta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      paraEtiqueta(
        await emClientes(resposta, () =>
          obterEtiqueta(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.post(
    "/customer-tags",
    {
      config: escrita,
      schema: {
        description:
          "Cria uma etiqueta; o nome não se repete no comerciante (sem contar maiúsculas).",
        headers: CabecalhoIdempotencia,
        body: PedidoEtiqueta,
        response: { 201: Etiqueta, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emClientes(resposta, async () => {
          const id = await criarEtiqueta(
            trx,
            c.comercianteId,
            pedido.body.nome,
          );
          return paraEtiqueta(await obterEtiqueta(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.patch(
    "/customer-tags/:id",
    {
      config: escrita,
      schema: {
        description: "Muda o nome de uma etiqueta, na versão lida.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdEtiqueta),
        body: PedidoAlterarEtiqueta,
        response: { 200: Etiqueta, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const { versao, ...alteracao } = pedido.body;
          const id = semPrefixo(pedido.params.id);
          await alterarEtiqueta(trx, c.comercianteId, id, versao, alteracao);
          return paraEtiqueta(await obterEtiqueta(trx, c.comercianteId, id));
        }),
      ),
  );

  for (const [caminho, estado, texto] of [
    [
      "archive",
      "arquivada",
      "Arquiva a etiqueta; numa lista de preços B2B activa, é recusado (customers.tag_in_use)",
    ],
    ["restore", "activa", "Repõe a etiqueta"],
  ] as const) {
    rotas.post(
      `/customer-tags/:id/${caminho}`,
      {
        config: escrita,
        schema: {
          description: `${texto}, na versão lida.`,
          headers: CabecalhoIdempotencia,
          params: ParametroId(IdEtiqueta),
          body: PedidoVersao,
          response: { 200: Etiqueta, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, (trx, c) =>
          emClientes(resposta, async () => {
            const id = semPrefixo(pedido.params.id);
            await alterarEtiqueta(
              trx,
              c.comercianteId,
              id,
              pedido.body.versao,
              { estado },
            );
            return paraEtiqueta(await obterEtiqueta(trx, c.comercianteId, id));
          }),
        ),
    );
  }

  rotas.put(
    "/customers/:id/tags/:etiqueta",
    {
      config: escrita,
      schema: {
        description:
          "Põe a etiqueta na ficha (activa as duas). Pôr outra vez não muda nada. A etiqueta sozinha não faz de ninguém profissional (docs/23 §3.5).",
        headers: CabecalhoIdempotencia,
        params: ParametroEtiquetaDoCliente,
        response: { 200: Cliente, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await porEtiqueta(
            trx,
            c.comercianteId,
            id,
            semPrefixo(pedido.params.etiqueta),
          );
          return paraCliente(await obterCliente(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.delete(
    "/customers/:id/tags/:etiqueta",
    {
      config: escrita,
      schema: {
        description:
          "Tira a etiqueta da ficha (fica na linha do tempo). Tirar uma que não está não muda nada.",
        headers: CabecalhoIdempotencia,
        params: ParametroEtiquetaDoCliente,
        response: { 200: Cliente, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await tirarEtiqueta(
            trx,
            c.comercianteId,
            id,
            semPrefixo(pedido.params.etiqueta),
          );
          return paraCliente(await obterCliente(trx, c.comercianteId, id));
        }),
      ),
  );

  // ---- VIES (§13.2–13.4)

  rotas.post(
    "/billing-profiles/:id/vies-checks",
    {
      config: faturacao,
      schema: {
        description:
          "Consulta o VIES agora e guarda a prova (docs/23 §13.4, passo 8). A resposta pode ser «indisponivel» (o VIES ou o serviço do país não responderam): nunca conta como válido. Só num perfil activo com NIF de outro país da UE.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPerfil),
        response: { 201: Validacao, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          const pedidoVies = await pedidoViesDoPerfil(trx, c.comercianteId, id);
          if (vies === undefined) {
            throw new ErroClientes(
              "customers.vies_disabled",
              "a consulta ao VIES está desligada neste servidor",
            );
          }
          // Corre na transacção da idempotência, que não toma o perfil (só a
          // gravação, a seguir, o toma); 10 s no máximo (§13.4).
          const consultadoEm = new Date();
          const r = await vies(pedidoVies);
          const prova = await registarVies(
            trx,
            c.comercianteId,
            id,
            pedidoVies,
            r,
            consultadoEm,
            "pedido",
          );
          return paraValidacao(
            await obterValidacao(trx, c.comercianteId, prova),
          );
        }),
      ),
  );

  rotas.get(
    "/billing-profiles/:id/vies-checks",
    {
      config: ler,
      schema: {
        description:
          "As provas das consultas ao VIES do perfil (docs/23 §13.3), da mais recente para a mais antiga, no formato das listas.",
        params: ParametroId(IdPerfil),
        querystring: ConsultaPagina,
        response: { 200: Lista(Validacao), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emClientes(resposta, () =>
          listarValidacoes(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraValidacao,
      ),
  );

  // ---- Isenção manual (§13.5)

  rotas.put(
    "/billing-profiles/:id/exemption",
    {
      config: isencoes,
      schema: {
        description:
          "Põe uma isenção manual de IVA no perfil, com o motivo (docs/23 §13.5). Só uma em vigor (customers.exemption_active); não se altera: retira-se e põe-se outra. Nenhum processo automático a retira.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPerfil),
        body: PedidoIsencao,
        response: { 201: Isencao, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emClientes(resposta, async () => {
          const id = await porIsencao(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.motivo,
            pedido.body.nota ?? null,
          );
          return paraIsencao(await obterIsencao(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.delete(
    "/billing-profiles/:id/exemption",
    {
      config: isencoes,
      schema: {
        description:
          "Retira a isenção em vigor, com o motivo; fica no histórico do perfil.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPerfil),
        body: PedidoRetirarIsencao,
        response: { 200: Isencao, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = await retirarIsencao(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.motivo_retirada,
          );
          return paraIsencao(await obterIsencao(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.get(
    "/billing-profiles/:id/exemptions",
    {
      config: ler,
      schema: {
        description:
          "As isenções manuais do perfil (a em vigor e as retiradas), as mais recentes primeiro.",
        params: ParametroId(IdPerfil),
        response: {
          200: Type.Object({ dados: Type.Array(Isencao) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => ({
      dados: (
        await emClientes(resposta, () =>
          listarIsencoes(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        )
      ).map(paraIsencao),
    }),
  );
}
