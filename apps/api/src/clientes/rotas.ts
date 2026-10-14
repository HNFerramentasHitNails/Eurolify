import { createHash } from "node:crypto";
import { CamposDoRasto, respostasDoRasto } from "../base/rasto-resposta.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type, type Static } from "typebox";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  CANAIS_CONSENTIMENTO,
  CANAIS_PEDIDO_RECEBIDO,
  ENTIDADES_DO_RASTO_CLIENTE,
  ESTADOS_PEDIDO_RECEBIDO,
  FINS_PEDIDO_RECEBIDO,
  MOTIVOS_PRORROGACAO,
  ESTADOS_DUPLICADO,
  ESTADOS_VIES,
  SINAIS_DUPLICADO,
  TIPOS_DE_ANEXO,
  TIPOS_PEDIDO_RECEBIDO,
  TIPOS_PEDIDO_TITULAR,
  type BaseDados,
  type MotivoProrrogacao,
  type TipoDeAnexo,
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
  descartarDuplicado,
  exportarCliente,
  fundirClientes,
  limitarCliente,
  listarPedidosTitular,
  listarPedidosRecebidos,
  obterPedidoRecebido,
  registarPedidoRecebido,
  prorrogarPedidoRecebido,
  fecharPedidoRecebido,
  type PedidoRecebido,
  pseudonimizarCliente,
  type FichaComOMesmoContacto,
  linhaDoTempo,
  listarConsentimentos,
  listarDuplicados,
  obterDuplicado,
  listarIsencoes,
  listarValidacoes,
  obterIsencao,
  obterValidacao,
  pedirVies,
  porIsencao,
  retirarIsencao,
  listarClientes,
  listarEtiquetas,
  listarPerfis,
  mudarEstadoPerfil,
  obterCliente,
  obterConsentimento,
  obterEtiqueta,
  obterPerfil,
  porEtiqueta,
  registarConsentimento,
  confirmarConsentimento,
  anexarIsencao,
  listarAnexosDaIsencao,
  lerAnexoDaIsencao,
  perfilGuardado,
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
  "customers.exemption_reason_code": 422,
  "customers.merge_same": 422,
  "customers.merge_by_person": 422,
  "customers.merge_too_many_contacts": 409,
  "customers.duplicate_decided": 409,
  "customers.confirmation_required": 422,
  "customers.restricted": 409,
  "customers.consent_contact_unknown": 422,
  "customers.consent_confirmation_required": 409,
  "customers.confirmation_channel": 422,
  "customers.confirmation_invalid": 422,
  "customers.confirmation_expired": 410,
  "customers.confirmation_exhausted": 409,
  "customers.confirmation_closed": 409,
  "customers.confirmation_rate_limited": 429,
  "customers.exemption_attachments_full": 409,
  "customers.exemption_attachments_quota": 409,
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
  fundido_em: Type.Union([Type.String(), Type.Null()], {
    description:
      "Numa ficha fundida, a ficha em que foi fundida (cus_…); a fundida fica só de leitura",
  }),
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
  fundido_em: c.fundido_em === null ? null : `cus_${c.fundido_em}`,
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
  nome_documento: Type.Union([Type.String(), Type.Null()], {
    description:
      "O nome que sai no documento fiscal; `null` num perfil guardado, para quem não tem customers:billing (§15.12)",
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
  copiado_de: Type.Union([Type.String(), Type.Null()], {
    description:
      "Numa cópia feita por uma fusão, o perfil da ficha absorvida de onde veio (bpf_…)",
  }),
  guardado_por_obrigacao_fiscal: Type.Boolean({
    description:
      "A ficha foi pseudonimizada por um pedido de apagamento e o perfil ficou por obrigação fiscal: o nome, o NIF e a morada só saem com customers:billing (docs/23 §15.12)",
  }),
  versao: Type.Integer(),
  criado_em: Instante,
  actualizado_em: Instante,
});
type LinhaPerfil = Awaited<ReturnType<typeof obterPerfil>>;
/**
 * Um perfil para a resposta. Num perfil guardado (§15.12), o nome, o NIF e a
 * morada só saem a quem tem customers:billing (`comDados`).
 */
const paraPerfil = (
  p: LinhaPerfil,
  comDados: boolean,
): Static<typeof Perfil> => {
  const reservado = p.guardado && !comDados;
  return {
    id: `bpf_${p.id}`,
    cliente: `cus_${p.cliente_id}`,
    tipo: p.tipo,
    nome_documento: reservado ? null : p.nome_documento,
    nif: reservado ? null : p.nif,
    nif_escrito: reservado ? null : p.nif_escrito,
    pais_contribuinte: reservado ? null : p.pais_contribuinte,
    morada:
      reservado || p.morada_linha1 === null
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
    copiado_de: p.copiado_de === null ? null : `bpf_${p.copiado_de}`,
    guardado_por_obrigacao_fiscal: p.guardado,
    versao: p.versao,
    criado_em: p.criado_em.toISOString(),
    actualizado_em: p.actualizado_em.toISOString(),
  };
};

/** Se quem chama lê os dados de um perfil guardado (§15.12): o dono. */
const veDadosGuardados = (ambitos: readonly string[]) =>
  ambitos.includes("customers:billing");

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
  consentimento: "cns",
  duplicado_cliente: "dup",
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
    {
      description:
        "O antes e o depois de cada campo que mudou. Os campos sensíveis (o nome, os e-mails e os telefones da ficha; o nome, o NIF e a morada do perfil) trazem um marcador {protegido: true, resumo} em vez do valor: diz que mudou e se dois valores eram iguais, nunca qual era (docs/28 §3.4); vazio é que não havia valor.",
    },
  ),
  ...CamposDoRasto,
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
  pais_consultado: Type.Union([Type.String(), Type.Null()], {
    description:
      "`null` num perfil guardado, para quem não tem customers:billing (§15.12), como o número, o nome e a morada",
  }),
  numero_consultado: Type.Union([Type.String(), Type.Null()]),
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
/** Uma prova do VIES; `reservado` num perfil guardado sem customers:billing. */
const paraValidacao = (
  v: LinhaValidacao,
  reservado = false,
): Static<typeof Validacao> => ({
  id: `vvc_${v.id}`,
  perfil: `bpf_${v.perfil_id}`,
  pais_consultado: reservado ? null : v.pais_consultado,
  numero_consultado: reservado ? null : v.numero_consultado,
  requerente:
    v.requerente_pais === null || v.requerente_numero === null
      ? null
      : `${v.requerente_pais}${v.requerente_numero}`,
  consultado_em: v.consultado_em.toISOString(),
  data_vies: v.data_vies === null ? null : v.data_vies.toISOString(),
  resultado: v.resultado,
  codigo_erro: v.codigo_erro,
  identificador_consulta: v.identificador_consulta,
  nome_devolvido: reservado ? null : v.nome_devolvido,
  morada_devolvida: reservado ? null : v.morada_devolvida,
  motivo: v.motivo,
  quem: v.quem,
});

/** O que sai no lugar de um texto livre de um perfil guardado (§15.12). */
const RESERVADO = "(reservado)";
const Isencao = Type.Object({
  id: Type.String({ description: "exm_…" }),
  perfil: Type.String({ description: "bpf_…" }),
  motivo: Type.String(),
  codigo_motivo: Type.Union([Type.String(), Type.Null()], {
    description:
      "O código do motivo que sai no documento (docs/24, Q4; GET /tax/reasons)",
  }),
  nota: Type.Union([Type.String(), Type.Null()]),
  posta_por: Type.String(),
  posta_em: Instante,
  em_vigor: Type.Boolean(),
  motivo_retirada: Type.Union([Type.String(), Type.Null()]),
  retirada_por: Type.Union([Type.String(), Type.Null()]),
  retirada_em: Type.Union([Instante, Type.Null()]),
});
type LinhaIsencao = Awaited<ReturnType<typeof obterIsencao>>;
/**
 * Uma isenção; `reservado` num perfil guardado sem customers:billing
 * (§15.12): a nota e os motivos são texto livre que pode falar da pessoa.
 */
const paraIsencao = (
  i: LinhaIsencao,
  reservado = false,
): Static<typeof Isencao> => ({
  id: `exm_${i.id}`,
  perfil: `bpf_${i.perfil_id}`,
  motivo: reservado ? RESERVADO : i.motivo,
  codigo_motivo: i.codigo_motivo,
  nota: reservado ? null : i.nota,
  posta_por: i.posta_por,
  posta_em: i.posta_em.toISOString(),
  em_vigor: i.retirada_em === null,
  motivo_retirada:
    reservado && i.motivo_retirada !== null ? RESERVADO : i.motivo_retirada,
  retirada_por: i.retirada_por,
  retirada_em: i.retirada_em === null ? null : i.retirada_em.toISOString(),
});
const PedidoIsencao = Type.Object(
  {
    codigo_motivo: Type.String({
      pattern: "^[A-Z0-9]{1,10}$",
      description:
        "O código do motivo de isenção do país do comerciante (ex.: M05; GET /tax/reasons)",
    }),
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

// Os consentimentos (§3.6): cada declaração é a prova, e não se altera.
const Canal = umDe(CANAIS_CONSENTIMENTO);
const Consentimento = Type.Object({
  id: Type.String({ description: "cns_…" }),
  cliente: Type.String({ description: "cus_…" }),
  canal: Canal,
  finalidade: Type.Literal("marketing"),
  declaracao: Type.Union([Type.Literal("aceitou"), Type.Literal("retirou")]),
  texto: Type.String({ description: "O texto mostrado ao cliente" }),
  versao_texto: Type.String(),
  onde: Type.String({ description: "A loja e o formulário, ou o Hub" }),
  contacto: Type.Union([Type.String(), Type.Null()], {
    description:
      "O e-mail ou o telefone a que a declaração se refere; nulo nas declarações anteriores à 0052, que valem para os contactos da ficha onde foram dadas",
  }),
  via: Type.Union(
    [Type.Literal("directa"), Type.Literal("dupla_confirmacao")],
    {
      description:
        "dupla_confirmacao: um «sim» sobre uma recusa, confirmado no próprio contacto (docs/23 §14)",
    },
  ),
  confirmacao: Type.Union([Type.String(), Type.Null()], {
    description: "O pedido de confirmação que deu esta declaração (ccf_…)",
  }),
  declarado_em: Instante,
  quem: Type.String({
    description: "Quem registou: chave:key_…, pessoa:per_… ou sistema:<tarefa>",
  }),
});
type LinhaConsentimento = Awaited<ReturnType<typeof obterConsentimento>>;
const paraConsentimento = (
  c: LinhaConsentimento,
): Static<typeof Consentimento> => ({
  id: `cns_${c.id}`,
  cliente: `cus_${c.cliente_id}`,
  canal: c.canal,
  finalidade: c.finalidade,
  declaracao: c.declaracao,
  texto: c.texto,
  versao_texto: c.versao_texto,
  onde: c.onde,
  contacto: c.contacto,
  via: c.via,
  confirmacao: c.confirmacao_id === null ? null : `ccf_${c.confirmacao_id}`,
  declarado_em: c.declarado_em.toISOString(),
  quem: c.quem,
});
const PedidoConsentimento = Type.Object(
  {
    canal: Canal,
    finalidade: Type.Optional(Type.Literal("marketing")),
    declaracao: Type.Union([Type.Literal("aceitou"), Type.Literal("retirou")], {
      description:
        "«Nunca aceitou» não se regista: é não haver declaração (eu-gdpr-privacy, regra 5)",
    }),
    contacto: Type.String({
      minLength: 3,
      maxLength: 254,
      description:
        "O e-mail (canal email) ou o telefone (sms, whatsapp) da ficha a que a declaração se refere; o estado é por contacto (docs/23 §14)",
    }),
    texto: Type.String({ minLength: 1, maxLength: 5000 }),
    versao_texto: Type.String({ minLength: 1, maxLength: 50 }),
    onde: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
// Um «sim» sobre uma recusa (0052): o pedido de dupla confirmação. O segredo
// vai só nesta resposta; o sistema do comerciante envia-o ao contacto.
const PedidoDeConfirmacao = Type.Object({
  confirmacao: Type.String({ description: "ccf_…" }),
  canal: Type.Union([Type.Literal("email"), Type.Literal("sms")]),
  contacto: Type.String(),
  segredo: Type.String({
    description:
      "Para a ligação do e-mail ou o código do SMS. Só aparece nesta resposta: repetir com a mesma Idempotency-Key dá idempotency.secret_not_repeated",
  }),
  expira_em: Instante,
});
const PedidoConfirmar = Type.Object(
  { segredo: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
const ReguaPorContacto = Type.Object(
  {
    email: Type.Array(Type.String()),
    sms: Type.Array(Type.String()),
    whatsapp: Type.Array(Type.String()),
  },
  {
    description:
      "Os contactos da ficha que podem receber marketing, por canal (0052): a pergunta exacta para quem envia",
  },
);
const ReguaMarketing = Type.Object(
  { email: Type.Boolean(), sms: Type.Boolean(), whatsapp: Type.Boolean() },
  {
    description:
      "Por canal, se algum contacto da ficha pode receber (pode_receber_marketing, migrações 0042 e 0052). O estado é por contacto: só as declarações explícitas desse contacto, no grupo de fichas, vale a mais recente, empate ⇒ não, sem nenhuma ⇒ não; ficha limitada ou não activa ⇒ não. Sobre uma recusa, um «sim» só conta depois de confirmado no contacto (docs/23 §14). Quem envia usa contactos_com_marketing",
  },
);

// Duplicados e fusões (§3.7; migração 0046).
const IdDuplicado = idCom("dup", "dup_…");
const Duplicado = Type.Object({
  id: Type.String({ description: "dup_…" }),
  clientes: Type.Array(Type.String({ description: "cus_…" }), {
    minItems: 2,
    maxItems: 2,
  }),
  sinais: Type.Array(umDe(SINAIS_DUPLICADO), {
    description:
      "O tipo do sinal, nunca o valor: o mesmo NIF em perfis particulares (forte), o mesmo e-mail ou telefone (talvez). O nome nunca é sinal",
  }),
  forte: Type.Boolean(),
  estado: umDe(ESTADOS_DUPLICADO),
  motivo: Type.Union([Type.String(), Type.Null()]),
  decidido_por: Type.Union([Type.String(), Type.Null()]),
  decidido_em: Type.Union([Instante, Type.Null()]),
  criado_em: Instante,
});
type LinhaDuplicado = Awaited<ReturnType<typeof obterDuplicado>>;
const paraDuplicado = (d: LinhaDuplicado): Static<typeof Duplicado> => ({
  id: `dup_${d.id}`,
  clientes: [`cus_${d.cliente_a}`, `cus_${d.cliente_b}`],
  sinais: d.sinais,
  forte: d.forte,
  estado: d.estado,
  motivo: d.motivo,
  decidido_por: d.decidido_por,
  decidido_em: d.decidido_em === null ? null : d.decidido_em.toISOString(),
  criado_em: d.criado_em.toISOString(),
});
const ConsultaDuplicados = Type.Object(
  {
    ...ConsultaPagina.properties,
    estado: Type.Optional(umDe(ESTADOS_DUPLICADO)),
  },
  { additionalProperties: false },
);
const PedidoDescartar = Type.Object(
  {
    motivo: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
const PedidoFundir = Type.Object(
  {
    absorver: idCom("cus", "A ficha que deixa de estar activa (cus_…)"),
    ensaio: Type.Boolean({
      description:
        "Verdadeiro: devolve o que mudaria, sem escrever. Não há desfazer: veja primeiro",
    }),
  },
  { additionalProperties: false },
);
const PlanoFusaoEsquema = Type.Object({
  ensaio: Type.Boolean(),
  fica: Type.String({ description: "cus_…" }),
  absorvida: Type.String({ description: "cus_…" }),
  emails_acrescentados: Type.Array(Type.String()),
  telefones_acrescentados: Type.Array(Type.String()),
  perfis_copiados: Type.Array(
    Type.Object({
      de: Type.String({ description: "bpf_… da ficha absorvida" }),
      para: Type.Union([Type.String(), Type.Null()], {
        description: "A cópia na ficha que fica (bpf_…); nula no ensaio",
      }),
    }),
  ),
  perfis_iguais_nao_copiados: Type.Array(Type.String()),
  isencoes_por_repor: Type.Array(Type.String(), {
    description:
      "Perfis da absorvida com isenção manual em vigor: a isenção não se copia, uma pessoa volta a pô-la na cópia",
  }),
  etiquetas_copiadas: Type.Array(Type.String()),
  etiquetas_arquivadas_nao_copiadas: Type.Array(Type.String()),
  consentimentos_da_absorvida: Type.Integer({
    description: "Não se movem: a régua da ficha que fica passa a contá-los",
  }),
  encomendas_ficam_na_absorvida: Type.Integer(),
  limitado: Type.Boolean({
    description: "A ficha que fica fica limitada se alguma das duas estava",
  }),
  marketing_antes: ReguaMarketing,
  marketing_depois: Type.Object(
    { email: Type.Boolean(), sms: Type.Boolean(), whatsapp: Type.Boolean() },
    {
      description:
        "A régua da ficha que fica depois da fusão, por contacto: cada contacto das duas fichas leva o seu estado (docs/23 §14)",
    },
  ),
});

// Os pedidos do titular (§7.1; migração 0049).
const Verificacao = Type.String({
  minLength: 1,
  maxLength: 500,
  description:
    "Como se confirmou que quem pede é o titular (ex.: «resposta do e-mail da ficha a 10/10/2026»); fica no registo do pedido",
});
const PedidoComVerificacao = Type.Object(
  { verificacao: Verificacao },
  { additionalProperties: false },
);
const PedidoPseudonimizar = Type.Object(
  {
    verificacao: Verificacao,
    confirmacao: Type.String({
      maxLength: 100,
      description:
        "Irreversível: escreva exactamente «pseudonimizar cus_…» com o id da ficha",
    }),
  },
  { additionalProperties: false },
);
const PedidoTitular = Type.Object({
  id: Type.String({ description: "dsr_…" }),
  cliente: Type.String({ description: "cus_…" }),
  tipo: umDe(TIPOS_PEDIDO_TITULAR),
  verificacao: Type.String(),
  quem: Type.String(),
  em: Instante,
  resultado: Type.Record(Type.String(), Type.Unknown()),
  encomendas_por_acabar: Type.Integer({
    description:
      "Num apagamento, as encomendas que ainda não acabaram: limpam-se sozinhas quando acabarem (docs/23 §15.3). O apagamento só está completo com zero; nos outros pedidos, zero",
  }),
});
type LinhaPedidoTitular = Awaited<
  ReturnType<typeof listarPedidosTitular>
>[number];
const paraPedidoTitular = (
  p: LinhaPedidoTitular,
): Static<typeof PedidoTitular> => ({
  id: `dsr_${p.id}`,
  cliente: `cus_${p.cliente_id}`,
  tipo: p.tipo,
  verificacao: p.verificacao,
  quem: p.quem,
  em: p.em.toISOString(),
  resultado: p.resultado,
  encomendas_por_acabar: p.encomendas_por_acabar,
});
// O pedido do titular recebido e o prazo de resposta (docs/23 §15.14; migração
// 0092; RGPD, art. 12.º, n.os 3 e 4).
const IdPedidoRecebido = idCom("prq", "prq_…");
const Dia = Type.String({ format: "date", description: "AAAA-MM-DD" });
const PedidoRegistarRecebido = Type.Object(
  {
    tipo: umDe(TIPOS_PEDIDO_RECEBIDO),
    canal: umDe(CANAIS_PEDIDO_RECEBIDO),
    recebido_em: Type.Optional(
      Type.String({
        format: "date-time",
        description:
          "Quando o pedido chegou (o prazo conta daí, não do dia em que se trata); por omissão, agora. Nunca no futuro",
      }),
    ),
  },
  { additionalProperties: false },
);
const PedidoProrrogar = Type.Object(
  {
    prorrogado_ate: Dia,
    motivo: Type.Unsafe<MotivoProrrogacao>({
      type: "string",
      enum: [...MOTIVOS_PRORROGACAO],
      description:
        "Porquê: os dois motivos do RGPD, art. 12.º, n.º 3 («a complexidade do pedido e o número de pedidos»). Lista fechada, sem texto livre",
    }),
    titular_informado_em: Type.String({
      format: "date",
      description:
        "O dia em que o titular foi informado da prorrogação e dos motivos: dentro do primeiro mês (art. 12.º, n.º 3)",
    }),
  },
  { additionalProperties: false },
);
const PedidoFechar = Type.Object(
  {
    fim: umDe(FINS_PEDIDO_RECEBIDO),
    em: Type.String({
      format: "date",
      description:
        "O dia em que se respondeu ou, na recusa, em que se informou o titular das razões e da possibilidade de reclamar à autoridade de controlo (art. 12.º, n.º 4). Nunca no futuro",
    }),
    pedido: Type.Optional(
      idCom(
        "dsr",
        "O pedido executado (dsr_…) do mesmo titular; obrigatório, e só, no fim executado",
      ),
    ),
  },
  { additionalProperties: false },
);
const PedidoRecebidoEsquema = Type.Object({
  id: Type.String({ description: "prq_…" }),
  cliente: Type.String({ description: "cus_…" }),
  tipo: umDe(TIPOS_PEDIDO_RECEBIDO),
  canal: umDe(CANAIS_PEDIDO_RECEBIDO),
  recebido_em: Instante,
  prazo_legal: Type.String({
    format: "date",
    description:
      "Um mês depois do dia em que chegou, no fuso do comerciante (art. 12.º, n.º 3); calculado pelo Eurolify",
  }),
  prorrogado_ate: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  prorrogado_motivo: Type.Union([umDe(MOTIVOS_PRORROGACAO), Type.Null()]),
  titular_informado_em: Type.Union([
    Type.String({ format: "date" }),
    Type.Null(),
  ]),
  estado: umDe(ESTADOS_PEDIDO_RECEBIDO),
  fechado_em: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  pedido: Type.Union([Type.String({ description: "dsr_…" }), Type.Null()]),
  quem: Type.String(),
  criado_em: Instante,
});
const paraPedidoRecebido = (
  p: PedidoRecebido,
): Static<typeof PedidoRecebidoEsquema> => ({
  id: `prq_${p.id}`,
  cliente: `cus_${p.cliente_id}`,
  tipo: p.tipo,
  canal: p.canal,
  recebido_em: p.recebido_em.toISOString(),
  prazo_legal: p.prazo_legal,
  prorrogado_ate: p.prorrogado_ate,
  prorrogado_motivo: p.prorrogado_motivo,
  titular_informado_em: p.titular_informado_em,
  estado: p.estado,
  fechado_em: p.fechado_em,
  pedido: p.pedido_titular_id === null ? null : `dsr_${p.pedido_titular_id}`,
  quem: p.quem,
  criado_em: p.criado_em.toISOString(),
});
const FichasComOMesmoContacto = Type.Array(
  Type.Object({
    id: Type.String(),
    estado: Type.String(),
    sinais: Type.Array(Type.String(), {
      description: "email, telefone ou os dois; nunca o contacto em si",
    }),
  }),
  {
    description:
      "Outras fichas deste comerciante, fora deste grupo, com um e-mail ou telefone igual (ex.: duas compras sem conta). O pedido não chegou a elas: decide o dono se as funde e repete o pedido — o sistema nunca as junta sozinho (docs/23 §15.5). É para o dono, não para entregar ao titular: um telefone partilhado pode apontar para outra pessoa",
  },
);
const ResultadoPseudonimizacaoEsquema = Type.Object({
  fichas: Type.Integer({ description: "A ficha e as fundidas nela" }),
  perfis_pseudonimizados: Type.Integer(),
  perfis_mantidos_por_obrigacao_fiscal: Type.Integer({
    description:
      "Usados num documento ou apontados por uma encomenda que não foi cancelada sem pagamento: ficam como estão, com as provas do VIES e as isenções, o prazo fiscal (R9; docs/23 §15, Q2)",
  }),
  consentimentos_apagados: Type.Integer(),
  etiquetas_retiradas: Type.Integer(),
  provas_vies_apagadas: Type.Integer(),
  isencoes_limpas: Type.Integer(),
  entradas_da_linha_do_tempo: Type.Integer(),
  encomendas_limpas: Type.Integer({
    description:
      "Encomendas acabadas limpas já: o contacto, a morada de entrega (fica o país), os textos livres da expedição, das transições e da pós-venda, e o aviso em bruto do prestador passa a resumo (docs/23 §15.2)",
  }),
  encomendas_com_dados_fiscais_mantidos: Type.Integer({
    description:
      "Das limpas, as que guardam a cópia de onde se emite o documento fiscal (NIF, nome e morada fiscais): pagas ou com documento — prazo fiscal (docs/23 §15.1, grupo A)",
  }),
  encomendas_por_acabar: Type.Integer({
    description:
      "Encomendas em curso: ficam numa fila e limpam-se quando acabarem (docs/23 §15.3). Com mais de zero, o apagamento ainda não está completo",
  }),
  encomendas_com_dados_por_tratar: Type.Integer({
    description:
      "Igual a encomendas_por_acabar (mantido por compatibilidade). Com mais de zero, o apagamento não está completo",
  }),
  fichas_com_o_mesmo_contacto: FichasComOMesmoContacto,
});
const Exportacao = Type.Object({
  pedido: Type.Union([Type.String(), Type.Null()], {
    description: "O registo deste pedido (dsr_…)",
  }),
  cliente: Type.String(),
  estado: Type.String(),
  gerada_em: Instante,
  fichas: Type.Array(Type.Unknown(), {
    description:
      "A ficha e as fundidas nela, cada uma com os perfis, as provas do VIES, as isenções, as etiquetas, os consentimentos, as encomendas inteiras com as linhas, os pagamentos, as expedições (com a prova de entrega e o seguimento da transportadora), o histórico de estados (sem os motivos), os documentos fiscais (tipo, número, data, totais e o comprador como está no documento; sem o PDF), a livre resolução com as linhas, as devoluções com as linhas e a decisão de higiene, os problemas e os reembolsos com as linhas (sem a prova), os candidatos a duplicado e a linha do tempo. Não saem as sessões de checkout, os avisos dos prestadores nem os eventos de saída (docs/23 §15.2)",
  }),
  pedidos_do_titular: Type.Array(Type.Unknown()),
  pedidos_recebidos: Type.Array(Type.Unknown(), {
    description:
      "Os pedidos do titular que chegaram (docs/23 §15.14): o tipo, o canal, as datas e como se fecharam",
  }),
  fichas_com_o_mesmo_contacto: FichasComOMesmoContacto,
});

const comPrefixoCus = (f: FichaComOMesmoContacto[]) =>
  f.map((x) => ({ ...x, id: `cus_${x.id}` }));

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
          "Procura fichas por e-mail, telefone ou NIF (só o número, como a régua compara), nunca pelo nome, no formato das listas. Não escreve nem pede Idempotency-Key; o valor vai no corpo para não ficar nos registos. Sem customers:billing, a procura por NIF não mostra fichas pseudonimizadas (docs/23 §15.12).",
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
            !veDadosGuardados(chaveDo(pedido).ambitos),
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
            ...respostasDoRasto(a),
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
          "Os perfis de faturação da ficha (docs/23 §3.2): o principal primeiro. Numa ficha pseudonimizada, o nome, o NIF e a morada dos perfis guardados só saem com customers:billing (§15.12).",
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
      ).map((p) => paraPerfil(p, veDadosGuardados(chaveDo(pedido).ambitos))),
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
          return paraPerfil(await obterPerfil(trx, c.comercianteId, id), true);
        }),
      ),
  );

  rotas.get(
    "/billing-profiles/:id",
    {
      config: ler,
      schema: {
        description:
          "Um perfil de faturação. Num perfil guardado por obrigação fiscal (ficha pseudonimizada), o nome, o NIF e a morada só saem com customers:billing (docs/23 §15.12).",
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
        veDadosGuardados(chaveDo(pedido).ambitos),
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
          return paraPerfil(await obterPerfil(trx, c.comercianteId, id), true);
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
          return paraPerfil(await obterPerfil(trx, c.comercianteId, id), true);
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
            return paraPerfil(
              await obterPerfil(trx, c.comercianteId, id),
              true,
            );
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
          "Pede uma consulta ao VIES: o perfil passa à frente da fila, que corre de minuto a minuto (docs/23 §13.4). A prova aparece em GET …/vies-checks; pode ser «indisponivel», que nunca conta como válido. Só num perfil activo com NIF de outro país da UE. O pedido não espera pelo VIES (revisão do #244, P1-1).",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPerfil),
        response: {
          202: Type.Object({
            perfil: Type.String({ description: "bpf_…" }),
            na_fila_desde: Instante,
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 202, (trx, c) =>
        emClientes(resposta, async () => {
          if (vies === undefined) {
            throw new ErroClientes(
              "customers.vies_disabled",
              "a consulta ao VIES está desligada neste servidor",
            );
          }
          const id = semPrefixo(pedido.params.id);
          const quando = await pedirVies(trx, c.comercianteId, id);
          return { perfil: `bpf_${id}`, na_fila_desde: quando.toISOString() };
        }),
      ),
  );

  rotas.get(
    "/billing-profiles/:id/vies-checks",
    {
      config: ler,
      schema: {
        description:
          "As provas das consultas ao VIES do perfil (docs/23 §13.3), da mais recente para a mais antiga, no formato das listas. Num perfil guardado por obrigação fiscal, o país, o número, o nome e a morada só saem com customers:billing (§15.12).",
        params: ParametroId(IdPerfil),
        querystring: ConsultaPagina,
        response: { 200: Lista(Validacao), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const r = await emClientes(resposta, () =>
        listarValidacoes(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
          limiteDe(pedido.query),
          idDoCursor(pedido.query.cursor),
        ),
      );
      // Num perfil guardado, a prova traz o NIF e o que o VIES respondeu
      // (nome e morada): só para o dono (§15.12).
      const reservado =
        r.guardado && !veDadosGuardados(chaveDo(pedido).ambitos);
      return comPagina(r, (v) => paraValidacao(v, reservado));
    },
  );

  // ---- Consentimentos (§3.6)

  rotas.get(
    "/customers/:id/consents",
    {
      config: ler,
      schema: {
        description:
          "As declarações de consentimento da ficha (as mais recentes primeiro, por páginas) e a resposta da régua única por canal. Quem envia marketing pergunta à régua; não conta declarações.",
        params: ParametroId(IdCliente),
        querystring: ConsultaPagina,
        response: {
          200: Type.Object({
            ...Lista(Consentimento).properties,
            pode_receber_marketing: ReguaMarketing,
            contactos_com_marketing: ReguaPorContacto,
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const pagina = await emClientes(resposta, () =>
        listarConsentimentos(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
          limiteDe(pedido.query),
          idDoCursor(pedido.query.cursor),
        ),
      );
      return {
        ...comPagina(pagina, paraConsentimento),
        pode_receber_marketing: pagina.regua,
        contactos_com_marketing: pagina.porContacto,
      };
    },
  );

  rotas.post(
    "/customers/:id/consents",
    {
      config: escrita,
      schema: {
        description:
          "Regista uma declaração (aceitou ou retirou) de um contacto da ficha, com o texto mostrado, a versão e onde; a hora e quem regista põe-nos o servidor. Não se altera nem se apaga: uma mudança é uma declaração nova. Só numa ficha activa. Um «aceitou» sobre uma recusa activa desse contacto não entra: responde 202 com um pedido de dupla confirmação e o segredo, que o sistema do comerciante envia ao contacto (ligação por e-mail, código por SMS) e entrega em POST /consent-confirmations/{id}/confirm (docs/23 §14).",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoConsentimento,
        response: {
          201: Consentimento,
          202: PedidoDeConfirmacao,
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        (trx, c) =>
          emClientes(resposta, async () => {
            const b = pedido.body;
            const r = await registarConsentimento(
              trx,
              c.comercianteId,
              semPrefixo(pedido.params.id),
              {
                canal: b.canal,
                declaracao: b.declaracao,
                contacto: b.contacto,
                texto: b.texto,
                versao_texto: b.versao_texto,
                onde: b.onde,
              },
            );
            if (r.tipo === "confirmacao") {
              return {
                confirmacao: `ccf_${r.id}`,
                canal: b.canal,
                contacto: r.contacto,
                segredo: r.segredo,
                expira_em: r.expira_em.toISOString(),
              };
            }
            return paraConsentimento(
              await obterConsentimento(trx, c.comercianteId, r.id),
            );
          }),
        undefined,
        undefined,
        {
          // O segredo não fica guardado na idempotência (como as chaves).
          estado: (corpo) =>
            typeof (corpo as { segredo?: unknown }).segredo === "string"
              ? 202
              : 201,
          guardar: (corpo) =>
            Object.fromEntries(
              Object.entries(corpo as Record<string, unknown>).filter(
                ([k]) => k !== "segredo",
              ),
            ),
          repetir: (guardada) => {
            if (guardada.status === 202) {
              throw erroBase(
                "idempotency.secret_not_repeated",
                "o segredo da confirmação só se mostra uma vez: repita com outra Idempotency-Key, que cria outro pedido",
              );
            }
            return guardada;
          },
        },
      ),
  );

  rotas.post(
    "/consent-confirmations/:id/confirm",
    {
      config: escrita,
      schema: {
        description:
          "Confirma um pedido de dupla confirmação com o que a pessoa trouxe (o segredo da ligação ou o código do SMS); regista o «sim» com o pedido como prova. Cinco tentativas erradas esgotam o pedido. Uma tentativa errada fica contada.",
        params: ParametroId(idCom("ccf", "ccf_…")),
        body: PedidoConfirmar,
        response: { 201: Consentimento, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const c = chaveDo(pedido);
      const id = await emClientes(resposta, () =>
        confirmarConsentimento(
          base,
          c.comercianteId,
          `chave:key_${c.chaveId}`,
          semPrefixo(pedido.params.id),
          pedido.body.segredo.trim(),
        ),
      );
      const consentimento = await emClientes(resposta, () =>
        obterConsentimento(base, c.comercianteId, id),
      );
      return resposta.code(201).send(paraConsentimento(consentimento));
    },
  );

  // ---- Duplicados e fusões (§3.7)

  // Fundir e decidir candidatos: dono e gestor (docs/23 §7).
  const fusoes = { ambito: "customers:merge" as const };

  rotas.get(
    "/customer-duplicates",
    {
      config: ler,
      schema: {
        description:
          "Os candidatos a duplicado que o servidor sinalizou (por omissão, os por decidir), os mais recentes primeiro. O servidor nunca funde sozinho.",
        querystring: ConsultaDuplicados,
        response: { 200: Lista(Duplicado), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emClientes(resposta, () =>
          listarDuplicados(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.estado ?? "por_decidir",
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraDuplicado,
      ),
  );

  rotas.post(
    "/customer-duplicates/:id/dismiss",
    {
      config: fusoes,
      schema: {
        description:
          "Descarta um candidato (não são a mesma pessoa), com o motivo; fica na linha do tempo. Um sinal novo no mesmo par volta a pô-lo por decidir.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdDuplicado),
        body: PedidoDescartar,
        response: { 200: Duplicado, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await descartarDuplicado(
            trx,
            c.comercianteId,
            id,
            pedido.body.motivo ?? null,
          );
          return paraDuplicado(await obterDuplicado(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.post(
    "/customers/:id/merge",
    {
      config: fusoes,
      schema: {
        description:
          "Funde a ficha `absorver` nesta (docs/23 §3.7), por uma pessoa: a absorvida fica fundida e só de leitura, com as encomendas dela; esta recebe os e-mails, os telefones, as etiquetas activas e uma cópia de cada perfil activo (a isenção manual não se copia). Com `ensaio`, devolve o que mudaria sem escrever. Não há desfazer.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoFundir,
        response: { 200: PlanoFusaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const p = await fundirClientes(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            semPrefixo(pedido.body.absorver),
            pedido.body.ensaio,
          );
          const bpf = (id: string) => `bpf_${id}`;
          return {
            ...p,
            fica: `cus_${p.fica}`,
            absorvida: `cus_${p.absorvida}`,
            perfis_copiados: p.perfis_copiados.map((x) => ({
              de: bpf(x.de),
              para: x.para === null ? null : bpf(x.para),
            })),
            perfis_iguais_nao_copiados: p.perfis_iguais_nao_copiados.map(bpf),
            isencoes_por_repor: p.isencoes_por_repor.map(bpf),
            etiquetas_copiadas: p.etiquetas_copiadas.map((e) => `ctg_${e}`),
            etiquetas_arquivadas_nao_copiadas:
              p.etiquetas_arquivadas_nao_copiadas.map((e) => `ctg_${e}`),
          };
        }),
      ),
  );

  // ---- Pedidos do titular (§7.1)

  // Só o dono (docs/23 §7).
  const privacidade = { ambito: "customers:privacy" as const };

  rotas.post(
    "/customers/:id/export",
    {
      config: privacidade,
      schema: {
        description:
          "Exporta tudo o que se guarda sobre o titular, na ficha e nas fundidas nela, com as encomendas e o que os outros domínios guardam delas (docs/23 §15.2; só para ler), e as outras fichas com o mesmo contacto. Regista o pedido com a verificação da identidade. Uma ficha fundida não se exporta: peça pela que ficou. A resposta não se guarda: repetir com a mesma Idempotency-Key dá idempotency.response_not_kept, com o id do pedido (dsr_…); para outra exportação, outra chave.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoComVerificacao,
        response: { 200: Exportacao, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        200,
        (trx, c) =>
          emClientes(resposta, async () => {
            const e = await exportarCliente(
              trx,
              c.comercianteId,
              semPrefixo(pedido.params.id),
              pedido.body.verificacao,
            );
            return {
              ...e,
              pedido: e.pedido === null ? null : `dsr_${e.pedido}`,
              cliente: `cus_${e.cliente}`,
              fichas_com_o_mesmo_contacto: comPrefixoCus(
                e.fichas_com_o_mesmo_contacto,
              ),
            };
          }),
        undefined,
        undefined,
        {
          // Só o id do pedido fica na idempotência, nunca o dossier.
          guardar: (corpo) => ({
            pedido: (corpo as { pedido: unknown }).pedido,
          }),
          repetir: (guardada) => {
            const id = (guardada.corpo as { pedido?: unknown } | null)?.pedido;
            throw erroBase(
              "idempotency.response_not_kept",
              `a exportação ${typeof id === "string" ? id : ""} já foi feita; para outra, use outra Idempotency-Key`,
            );
          },
        },
      ),
  );

  for (const [metodo, limitar] of [
    ["PUT", true],
    ["DELETE", false],
  ] as const) {
    rotas.route({
      method: metodo,
      url: "/customers/:id/restriction",
      config: privacidade,
      schema: {
        description: limitar
          ? "Limita a ficha a pedido do titular: a régua do marketing dá não e a API não lhe muda o nome nem os contactos, sem apagar nada."
          : "Levanta a limitação.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoComVerificacao,
        response: { 200: Cliente, ...RESPOSTA_DE_ERRO },
      },
      handler: (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, (trx, c) =>
          emClientes(resposta, async () => {
            const id = semPrefixo(pedido.params.id);
            await limitarCliente(
              trx,
              c.comercianteId,
              id,
              limitar,
              pedido.body.verificacao,
            );
            return paraCliente(await obterCliente(trx, c.comercianteId, id));
          }),
        ),
    });
  }

  rotas.post(
    "/customers/:id/pseudonymize",
    {
      config: privacidade,
      schema: {
        description:
          "Apagamento a pedido do titular, por pseudonimização (R9), da ficha e das fundidas nela. Irreversível: pede a confirmação escrita. Os perfis usados em documentos ficam o prazo fiscal; o resto dos dados pessoais sai, também da linha do tempo.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoPseudonimizar,
        response: { 200: ResultadoPseudonimizacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const r = await pseudonimizarCliente(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.confirmacao,
            pedido.body.verificacao,
          );
          return {
            ...r,
            fichas_com_o_mesmo_contacto: comPrefixoCus(
              r.fichas_com_o_mesmo_contacto,
            ),
          };
        }),
      ),
  );

  rotas.get(
    "/customers/:id/privacy-requests",
    {
      config: privacidade,
      schema: {
        description:
          "Os pedidos do titular desta ficha e das fundidas nela, os mais recentes primeiro.",
        params: ParametroId(IdCliente),
        response: {
          200: Type.Object({ dados: Type.Array(PedidoTitular) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => ({
      dados: (
        await emClientes(resposta, () =>
          listarPedidosTitular(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        )
      ).map(paraPedidoTitular),
    }),
  );

  // ---- O pedido do titular recebido e o prazo de resposta (§15.14)

  rotas.post(
    "/customers/:id/privacy-requests/received",
    {
      config: privacidade,
      schema: {
        description:
          "Regista a chegada de um pedido do titular (docs/23 §15.14, T1): o tipo, o canal e quando chegou. O Eurolify calcula o prazo legal (um mês desde que chegou, RGPD art. 12.º, n.º 3) e põe o pedido na fila «pedido_titular» das tarefas até fechar. Só numa ficha activa: um pedido de quem ainda não tem ficha fica fora até se saber quem é (Q-P2).",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCliente),
        body: PedidoRegistarRecebido,
        response: { 201: PedidoRecebidoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emClientes(resposta, async () => {
          const id = await registarPedidoRecebido(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.tipo,
            pedido.body.canal,
            pedido.body.recebido_em ?? null,
          );
          return paraPedidoRecebido(
            await obterPedidoRecebido(trx, c.comercianteId, id),
          );
        }),
      ),
  );

  rotas.get(
    "/customers/:id/privacy-requests/received",
    {
      config: privacidade,
      schema: {
        description:
          "Os pedidos do titular recebidos nesta ficha e nas fundidas nela, os mais recentes primeiro, com o prazo legal e o estado.",
        params: ParametroId(IdCliente),
        response: {
          200: Type.Object({ dados: Type.Array(PedidoRecebidoEsquema) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => ({
      dados: (
        await emClientes(resposta, () =>
          listarPedidosRecebidos(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        )
      ).map(paraPedidoRecebido),
    }),
  );

  rotas.post(
    "/privacy-requests/received/:id/extend",
    {
      config: privacidade,
      schema: {
        description:
          "Prorroga o prazo, uma vez (RGPD art. 12.º, n.º 3): até dois meses depois da chegada (leitura conservadora, por confirmar com o jurista), com o motivo (complexidade ou número de pedidos) e o dia em que o titular foi informado, que tem de ser dentro do primeiro mês (pode registar-se depois). Se o caso já tinha sido avisado de vencido, o prazo novo permite um aviso novo. Decisão de uma pessoa ou da chave dela.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPedidoRecebido),
        body: PedidoProrrogar,
        response: { 200: PedidoRecebidoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await prorrogarPedidoRecebido(
            trx,
            c.comercianteId,
            id,
            pedido.body.prorrogado_ate,
            pedido.body.motivo,
            pedido.body.titular_informado_em,
          );
          return paraPedidoRecebido(
            await obterPedidoRecebido(trx, c.comercianteId, id),
          );
        }),
      ),
  );

  rotas.post(
    "/privacy-requests/received/:id/close",
    {
      config: privacidade,
      schema: {
        description:
          "Fecha o pedido recebido, uma vez, com o dia (docs/23 §15.14, T3): executado (com o pedido executado, dsr_…, do mesmo titular, do dia da chegada ou depois e do tipo que responde: acesso e portabilidade pela exportação, apagamento pelo apagamento, limitação pela limitação ou pelo fim dela; a rectificação, a oposição e «outro» não se executam), respondido fora do Eurolify, ou recusado (o dia em que se informou o titular das razões, art. 12.º, n.º 4). Fechado, não muda nem se apaga; sai da fila das tarefas. Decisão de uma pessoa ou da chave dela.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdPedidoRecebido),
        body: PedidoFechar,
        response: { 200: PedidoRecebidoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emClientes(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await fecharPedidoRecebido(
            trx,
            c.comercianteId,
            id,
            pedido.body.fim,
            pedido.body.em,
            pedido.body.pedido === undefined
              ? null
              : semPrefixo(pedido.body.pedido),
          );
          return paraPedidoRecebido(
            await obterPedidoRecebido(trx, c.comercianteId, id),
          );
        }),
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
            pedido.body.codigo_motivo,
          );
          // Numa ficha pseudonimizada, a nota e os motivos só para o dono
          // (§15.12; revisão do #440, P2-2).
          return paraIsencao(
            await obterIsencao(trx, c.comercianteId, id),
            (await perfilGuardado(trx, semPrefixo(pedido.params.id))) &&
              !veDadosGuardados(chaveDo(pedido).ambitos),
          );
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
          // Numa ficha pseudonimizada, a nota e os motivos só para o dono
          // (§15.12; revisão do #440, P2-2).
          return paraIsencao(
            await obterIsencao(trx, c.comercianteId, id),
            (await perfilGuardado(trx, semPrefixo(pedido.params.id))) &&
              !veDadosGuardados(chaveDo(pedido).ambitos),
          );
        }),
      ),
  );

  rotas.get(
    "/billing-profiles/:id/exemptions",
    {
      config: ler,
      schema: {
        description:
          "As isenções manuais do perfil (a em vigor e as retiradas), as mais recentes primeiro. Num perfil guardado por obrigação fiscal, a nota e os motivos só saem com customers:billing (§15.12).",
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
      ).map((i) =>
        paraIsencao(
          i,
          i.guardado && !veDadosGuardados(chaveDo(pedido).ambitos),
        ),
      ),
    }),
  );

  // ---- Os anexos da isenção (§13.5; 0055), num plugin à parte: o leitor
  // dos bytes (PDF, JPEG, PNG) não se mistura com o JSON das outras rotas
  // nem com o do envio de imagens.
  void instancia.register((filho, _o, pronto) => {
    rotasDosAnexos(filho, base, isencoes, ler);
    pronto();
  });
}

const IdIsencao = idCom("exm", "exm_…");
const IdAnexo = idCom("exa", "exa_…");
/** 10 MB por anexo (proposta do §13.5). */
const TAMANHO_DO_ANEXO = 10 * 1024 * 1024;
const Anexo = Type.Object({
  id: Type.String({ description: "exa_…" }),
  isencao: Type.String({ description: "exm_…" }),
  nome: Type.Union([Type.String(), Type.Null()]),
  tipo: umDe(TIPOS_DE_ANEXO),
  tamanho: Type.Integer(),
  resumo: Type.String({ description: "sha256 dos bytes, em hexadecimal" }),
  posto_por: Type.String(),
  posto_em: Instante,
});
type LinhaAnexo = Omit<
  Awaited<ReturnType<typeof listarAnexosDaIsencao>>[number],
  "guardado"
>;
/** Um anexo; `reservado` num perfil guardado sem customers:billing (§15.12). */
const paraAnexo = (a: LinhaAnexo, reservado = false): Static<typeof Anexo> => ({
  id: `exa_${a.id}`,
  isencao: `exm_${a.isencao_id}`,
  nome: reservado && a.nome !== null ? RESERVADO : a.nome,
  tipo: a.tipo,
  tamanho: a.tamanho,
  resumo: a.resumo,
  posto_por: a.posto_por,
  posto_em: a.posto_em.toISOString(),
});

const EXTENSAO_DO_TIPO: Record<TipoDeAnexo, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

/**
 * O nome do ficheiro a descarregar: a extensão é sempre a do tipo (um
 * «x.html» que é um PDF sai «x.pdf»), o nome em ASCII para os clientes
 * antigos e o original em UTF-8 (RFC 6266 e 5987), para um «declaração –
 * €.pdf» não partir o cabeçalho (revisão do #338, P1-1 e P2-4).
 */
export function disposicaoDoAnexo(
  nome: string | null,
  tipo: TipoDeAnexo,
  resumo: string,
): string {
  const extensao = EXTENSAO_DO_TIPO[tipo];
  const base = (nome ?? `anexo-${resumo.slice(0, 12)}`).replace(/\.[^.]*$/, "");
  const ascii =
    base
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._ -]/g, "")
      .trim()
      .slice(0, 150) || `anexo-${resumo.slice(0, 12)}`;
  return `attachment; filename="${ascii}${extensao}"; filename*=UTF-8''${encodeURIComponent(base + extensao).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** Envios de anexos em curso por comerciante (cada um ocupa até 10 MB de memória). */
const ANEXOS_EM_SIMULTANEO = 2;

function rotasDosAnexos(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  isencoes: { ambito: "customers:exemptions" },
  ler: { ambito: "customers:read" },
) {
  instancia.addContentTypeParser(
    [...TIPOS_DE_ANEXO],
    { parseAs: "buffer", bodyLimit: TAMANHO_DO_ANEXO },
    (_pedido, corpo, feito) => {
      feito(null, corpo);
    },
  );
  // No máximo 2 envios em simultâneo por comerciante, contados antes de ler
  // o corpo (como as imagens; revisão do #338, P2-2).
  const emCurso = new Map<string, number>();
  const contados = new WeakMap<object, string>();
  const largar = (raw: object) => {
    const c = contados.get(raw);
    if (c === undefined) return;
    contados.delete(raw);
    const n = (emCurso.get(c) ?? 1) - 1;
    if (n <= 0) emCurso.delete(c);
    else emCurso.set(c, n);
  };
  instancia.addHook("onRequest", async (pedido, resposta) => {
    if (pedido.method !== "POST") return;
    const comercianteId = chaveDo(pedido).comercianteId;
    const n = emCurso.get(comercianteId) ?? 0;
    if (n >= ANEXOS_EM_SIMULTANEO) {
      void resposta.header("Retry-After", "1");
      throw erroBase(
        "rate_limit.exceeded",
        `no máximo ${String(ANEXOS_EM_SIMULTANEO)} envios de anexos ao mesmo tempo`,
      );
    }
    emCurso.set(comercianteId, n + 1);
    contados.set(pedido.raw, comercianteId);
    resposta.raw.once("close", () => {
      largar(pedido.raw);
    });
  });
  instancia.addHook("onResponse", (pedido, _resposta, feito) => {
    largar(pedido.raw);
    feito();
  });
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.post(
    "/exemptions/:id/attachments",
    {
      config: isencoes,
      schema: {
        description:
          "Anexa um ficheiro (PDF, JPEG ou PNG, até 10 MB; o corpo são os bytes, com o Content-Type do ficheiro) a uma isenção manual em vigor; até 5 por isenção. É a prova: não se altera nem se apaga, e os bytes ficam como chegaram. Só uma pessoa ou a chave dela (docs/23 §13.5).",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdIsencao),
        querystring: Type.Object(
          {
            nome: Type.Optional(
              Type.String({
                minLength: 1,
                maxLength: 200,
                pattern: "^[^/\\\\]+$",
                description: "O nome do ficheiro, sem caminho",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        response: { 201: Anexo, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) => {
      const tipo = (pedido.headers["content-type"] ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase() as TipoDeAnexo;
      // Só os três tipos, e só em bytes (o JSON e o texto têm leitor próprio).
      if (!TIPOS_DE_ANEXO.includes(tipo) || !Buffer.isBuffer(pedido.body)) {
        throw erroBase(
          "media_type.unsupported",
          `um anexo é ${TIPOS_DE_ANEXO.join(", ")}`,
        );
      }
      const bytes = pedido.body;
      return escrever(
        base,
        pedido,
        resposta,
        201,
        (trx, c) =>
          emClientes(resposta, async () =>
            paraAnexo(
              await anexarIsencao(
                trx,
                c.comercianteId,
                semPrefixo(pedido.params.id),
                { tipo, nome: pedido.query.nome ?? null, bytes },
              ),
            ),
          ),
        undefined,
        // A idempotência conta com o resumo dos bytes, não com eles.
        {
          resumo: createHash("sha256").update(bytes).digest("hex"),
          tipo,
          nome: pedido.query.nome ?? null,
        },
      );
    },
  );

  rotas.get(
    "/exemptions/:id/attachments",
    {
      config: ler,
      schema: {
        description:
          "Os anexos de uma isenção, sem os bytes. Num perfil guardado por obrigação fiscal, o nome do ficheiro só sai com customers:billing (§15.12).",
        params: ParametroId(IdIsencao),
        response: {
          200: Type.Object({ dados: Type.Array(Anexo) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => ({
      dados: (
        await emClientes(resposta, () =>
          listarAnexosDaIsencao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        )
      ).map((a) =>
        paraAnexo(a, a.guardado && !veDadosGuardados(chaveDo(pedido).ambitos)),
      ),
    }),
  );

  rotas.get(
    "/exemptions/:id/attachments/:anexo",
    {
      config: isencoes,
      schema: {
        description:
          "Os bytes de um anexo, com o tipo dele (só com customers:exemptions). Num perfil guardado por obrigação fiscal, só com customers:billing também (docs/23 §15.12).",
        params: Type.Object({ id: IdIsencao, anexo: IdAnexo }),
        response: {
          200: {
            description: "O ficheiro",
            content: Object.fromEntries(
              TIPOS_DE_ANEXO.map((t) => [
                t,
                { schema: { type: "string", format: "binary" } },
              ]),
            ),
          },
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const a = await emClientes(resposta, () =>
        lerAnexoDaIsencao(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
          semPrefixo(pedido.params.anexo),
        ),
      );
      // Num perfil guardado por obrigação fiscal, o documento da isenção é
      // da pessoa que pediu o apagamento: só o dono o descarrega (§15.12;
      // revisão do #440, P2-2).
      if (a.guardado && !veDadosGuardados(chaveDo(pedido).ambitos)) {
        throw new ErroApi(
          "auth.forbidden",
          403,
          {
            pt: "A chave não tem o âmbito desta operação",
            en: "The key lacks the scope for this operation",
          },
          "âmbito pedido: customers:billing (perfil guardado por obrigação fiscal)",
        );
      }
      return (
        resposta
          .header("content-type", a.tipo)
          .header("etag", `"${a.resumo}"`)
          .header("cache-control", "private, no-store")
          // O navegador não adivinha outro tipo nem corre nada (como as
          // imagens; revisão do #338, P2-4).
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header(
            "content-disposition",
            disposicaoDoAnexo(a.nome, a.tipo, a.resumo),
          )
          .send(a.bytes)
      );
    },
  );
}
