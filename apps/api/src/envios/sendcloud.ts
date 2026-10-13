import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ErroDeRede,
  type AdaptadorTransportadora,
  type CredenciaisTransportadora,
  type EtiquetaEmitida,
  type EventoSeguimento,
  type MoradaEtiqueta,
  type PontoRecolha,
  type ResultadoEtiqueta,
  type ServicoTransportadora,
} from "./adaptador.js";

// O adaptador da Sendcloud (docs/36 §16; Diogo, 12/10/2026: «ainda não;
// avança com a parte C»). Escrito pela documentação da API v3
// (sendcloud.dev, lida a 12/10/2026, **W**); nada foi corrido contra uma
// conta real.
// - Basic com a chave pública e a chave secreta da integração.
// - Etiqueta: POST /shipments/announce, síncrono; `external_reference_id` é
//   único por conta e repeti-lo dá 409 com o envio que já existe (R2).
// - Consultar: GET /shipments?external_reference_id= / ?tracking_number=.
// - Anular: POST /shipments/{id}/cancel (200 anulada, 202 em fila, 409 não).
// - Seguimento: GET /parcels/tracking/{número}; os eventos não têm
//   identificador (D5).
// - Avisos: HMAC-SHA256 do corpo em bruto, em hexadecimal, no cabeçalho
//   `Sendcloud-Signature`. O conteúdo não está descrito na v3: o aviso é só
//   um sinal para consultar (D4).
// - Serviços: POST /shipping-options, por origem e destino (D1, D3).
// - Pontos de recolha (docs/36 §21, lida a 13/10/2026, **W**): GET
//   /service-points (país, código postal, transportadora) e POST
//   /service-points/{id}/check-availability antes de criar o envio; na
//   etiqueta, `to_service_point.id`.

const BASE = "https://panel.sendcloud.sc/api/v3";

/**
 * O tempo de uma chamada à Sendcloud (proposta). O anúncio e o ficheiro são
 * duas chamadas: juntas cabem nos 30 s do núcleo (revisão do #406, P3-4).
 */
export const TEMPO_DA_CHAMADA_MS = 12_000;

/** O serviço sem custo para as etiquetas de teste (D2). */
export const SERVICO_DE_TESTE = "sendcloud:letter";

type Buscar = typeof fetch;

interface Resposta {
  estado: number;
  json: unknown;
}

const objecto = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
const texto = (v: unknown) =>
  typeof v === "string" && v !== ""
    ? v
    : typeof v === "number"
      ? String(v)
      : null;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function autorizacao(c: CredenciaisTransportadora) {
  const publica = c["chave_publica"];
  const secreta = c["chave_secreta"];
  if (!publica || !secreta) {
    // Sem as duas chaves, nada chega à Sendcloud: é uma recusa, não a rede.
    throw new Error("faltam a chave pública e a chave secreta");
  }
  return `Basic ${Buffer.from(`${publica}:${secreta}`).toString("base64")}`;
}

/** Um pedido JSON; 5xx, 429 e sem resposta são `ErroDeRede` (D8). */
async function chamar(
  buscar: Buscar,
  c: CredenciaisTransportadora,
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: unknown,
): Promise<Resposta> {
  const auth = autorizacao(c);
  let r: Response;
  try {
    r = await buscar(`${BASE}${caminho}`, {
      method: metodo,
      headers: {
        accept: "application/json",
        authorization: auth,
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(TEMPO_DA_CHAMADA_MS),
    });
  } catch (erro) {
    throw new ErroDeRede("a Sendcloud não respondeu", { cause: erro });
  }
  if (r.status >= 500 || r.status === 429 || r.status === 408) {
    throw new ErroDeRede(`a Sendcloud respondeu ${String(r.status)}`);
  }
  let json: unknown = null;
  const bruto = await r.text().catch((erro: unknown) => {
    throw new ErroDeRede("a resposta da Sendcloud não se lê", { cause: erro });
  });
  if (bruto !== "") {
    try {
      json = JSON.parse(bruto);
    } catch (erro) {
      throw new ErroDeRede("a resposta da Sendcloud não é JSON", {
        cause: erro,
      });
    }
  }
  return { estado: r.status, json };
}

/** O ficheiro da etiqueta de um volume (PDF). */
async function ficheiroDoVolume(
  buscar: Buscar,
  c: CredenciaisTransportadora,
  volume: string,
): Promise<Buffer> {
  let r: Response;
  try {
    r = await buscar(
      `${BASE}/parcels/${encodeURIComponent(volume)}/documents/label`,
      {
        method: "GET",
        headers: { accept: "application/pdf", authorization: autorizacao(c) },
        signal: AbortSignal.timeout(TEMPO_DA_CHAMADA_MS),
      },
    );
  } catch (erro) {
    throw new ErroDeRede("a Sendcloud não respondeu", { cause: erro });
  }
  if (r.status !== 200) {
    throw new ErroDeRede(
      `o ficheiro da etiqueta não veio (${String(r.status)})`,
    );
  }
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length === 0) throw new ErroDeRede("o ficheiro da etiqueta veio vazio");
  return b;
}

/** O primeiro motivo de uma lista de erros JSON:API, sem mais nada. */
function motivoDe(json: unknown, porOmissao: string): string {
  const erros = lista(objecto(json)?.["errors"]);
  const primeiro = objecto(erros[0]);
  const detalhe = texto(primeiro?.["detail"]);
  const onde = texto(objecto(primeiro?.["source"])?.["pointer"]);
  const m =
    detalhe === null ? porOmissao : onde ? `${onde}: ${detalhe}` : detalhe;
  return m.slice(0, 500);
}

const morada = (m: MoradaEtiqueta) => ({
  name: m.nome,
  address_line_1: m.linha1,
  ...(m.linha2 ? { address_line_2: m.linha2 } : {}),
  postal_code: m.codigo_postal,
  city: m.localidade,
  country_code: m.pais,
  ...(m.telefone ? { phone_number: m.telefone } : {}),
  ...(m.email ? { email: m.email } : {}),
});

/** O volume único de um envio, com o seguimento (ou `null`). */
function volumeDe(envio: Record<string, unknown> | null) {
  const v = objecto(lista(envio?.["parcels"])[0]);
  if (v === null) return null;
  const estado = objecto(v["status"]);
  const url = texto(v["tracking_url"]);
  return {
    id: texto(v["id"]),
    seguimento: texto(v["tracking_number"]),
    url:
      url !== null && url.startsWith("https://") && url.length <= 500
        ? url
        : null,
    codigo: texto(estado?.["code"])?.toUpperCase() ?? "",
    ficheiro: texto(v["label_file"]),
  };
}

/**
 * O envio já existe na Sendcloud. Três respostas (revisão do #406, P1-1):
 * a etiqueta; «sem etiqueta», só quando se sabe (o anúncio falhou ou foi
 * anulado); ou `ErroDeRede` quando o envio existe mas ainda não está pronto
 * (a anunciar, sem número): fica incerta e consulta-se, nunca se pede outra.
 */
async function etiquetaDoEnvio(
  buscar: Buscar,
  c: CredenciaisTransportadora,
  envio: Record<string, unknown> | null,
): Promise<EtiquetaEmitida | "sem_etiqueta"> {
  const v = volumeDe(envio);
  if (v === null) {
    throw new ErroDeRede("a resposta da Sendcloud não traz o volume");
  }
  if (v.codigo.includes("CANCEL") || v.codigo.includes("FAILED")) {
    return "sem_etiqueta";
  }
  if (v.seguimento === null || v.id === null) {
    throw new ErroDeRede(
      `o envio existe mas ainda não tem etiqueta (${v.codigo || "sem estado"})`,
    );
  }
  const conteudo =
    v.ficheiro !== null
      ? Buffer.from(v.ficheiro, "base64")
      : await ficheiroDoVolume(buscar, c, v.id);
  if (!conteudo.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new ErroDeRede("o ficheiro da etiqueta não é um PDF");
  }
  return {
    seguimento: v.seguimento.slice(0, 200),
    urlSeguimento: v.url,
    ficheiro: { formato: "pdf", conteudo },
  };
}

/** O estado da Sendcloud no estado do Eurolify (D6). */
export function normalizar(
  phase: string | null,
  exception: string | null,
  subStatus: string | null = null,
): EventoSeguimento["estadoNormalizado"] {
  switch (phase) {
    case "dropped":
    case "accepted":
      return "recolhida";
    case "sorted":
    case "in_transit":
    case "customs":
    case "in_delivery":
      return "em_transito";
    case "attempted":
      return "tentativa_falhada";
    case "pup":
      return "disponivel_para_levantar";
    case "delivered":
      // Só a entrega sem pormenor conta (revisão do #406, P2-6): «entregue
      // ao vizinho» ou «na caixa do correio» pode não ser a posse que conta
      // para a livre resolução (L6, C). Uma pessoa vê-a no histórico.
      return subStatus === null || subStatus === "none" ? "entregue" : "outro";
    default:
      // `delivery_forced` (sem confirmação da transportadora), `missing`
      // (pode ser temporário) e `returned_sender` («vai ser devolvida»,
      // ainda não foi: revisão do #406, P2-5) ficam só no histórico (D6).
      return "outro";
  }
}

/** Os eventos de um seguimento, com o identificador composto (D5). */
export function eventosDe(json: unknown): EventoSeguimento[] {
  const eventos: EventoSeguimento[] = [];
  for (const e of lista(objecto(json)?.["events"])) {
    const o = objecto(e);
    const em = texto(o?.["event_at"]);
    if (o === null || em === null || Number.isNaN(Date.parse(em))) continue;
    const phase = texto(o["phase"]);
    const exception = texto(o["exception"]);
    const sub = texto(o["sub_status"]);
    const estado = [phase, exception, sub]
      .filter((x) => x !== null && x !== "none")
      .join("/");
    eventos.push({
      idExterno: createHash("sha256")
        .update(`${em}|${phase ?? ""}|${exception ?? ""}|${sub ?? ""}`)
        .digest("hex"),
      estadoTransportadora: (estado || "desconhecido").slice(0, 100),
      estadoNormalizado: normalizar(phase, exception, sub),
      em: new Date(em),
    });
  }
  return eventos;
}

/** Um serviço da Sendcloud no contrato do Eurolify, ou `null` se fica de fora (D3). */
export function servicoDe(
  o: Record<string, unknown>,
  destino: string,
): ServicoTransportadora | null {
  const codigo = texto(o["code"]);
  // O que a base aceita (0080); o resto fica de fora (revisão do #406, P3-3).
  if (codigo === null || !/^[0-9A-Za-z_.:/-]{1,100}$/.test(codigo)) return null;
  const req = objecto(o["requirements"]);
  const campos = lista(req?.["fields"]).map(texto);
  // Na dúvida, não se vende (R4; revisão do #406, P3-2). Um serviço que
  // exige ponto de recolha só serve um método `ponto` (docs/36 §21).
  const ponto = req?.["is_service_point_required"];
  if (
    req === null ||
    typeof ponto !== "boolean" ||
    req["export_documents"] !== false ||
    campos.some((c) => c === "length" || c === "width" || c === "height")
  ) {
    return null;
  }
  const max = objecto(objecto(objecto(o["weight"])?.["max"]));
  const valor = Number(texto(max?.["value"]));
  const unidade = texto(max?.["unit"]);
  const fator = unidade === "kg" ? 1000 : unidade === "g" ? 1 : null;
  if (fator === null || !Number.isFinite(valor) || valor <= 0) return null;
  const pesoMaxG = Math.floor(valor * fator);
  return {
    codigo,
    nome: { pt: (texto(o["name"]) ?? codigo).slice(0, 200) },
    paises: [destino],
    pesoMaxG,
    pedeTelefone: campos.includes("to_telephone"),
    pedeEmail: campos.includes("to_email"),
    // A Sendcloud só diz «sim ou não» aos perigosos, sem números ONU (D3).
    aceitaOnu: [],
    ...(ponto ? { ponto: true } : {}),
  };
}

/** Um ponto de recolha da Sendcloud, ou `null` se falta a morada (docs/36 §21). */
export function pontoDe(o: Record<string, unknown>): PontoRecolha | null {
  const id = texto(o["id"]);
  const m = objecto(o["address"]);
  const rua = [texto(m?.["street"]), texto(m?.["house_number"])]
    .filter((x) => x !== null)
    .join(" ")
    .trim();
  const cp = texto(m?.["postal_code"]);
  const localidade = texto(m?.["city"]);
  const pais = texto(m?.["country_code"])?.toUpperCase() ?? null;
  // Um ponto expirado, ou sem morada inteira, não se oferece.
  if (
    o["is_expired"] === true ||
    id === null ||
    !/^[0-9A-Za-z_-]{1,100}$/.test(id) ||
    rua === "" ||
    cp === null ||
    localidade === null ||
    pais === null ||
    !/^[A-Z]{2}$/.test(pais)
  ) {
    return null;
  }
  const d = Number(o["distance"]);
  return {
    id,
    nome: (texto(o["name"]) ?? id).slice(0, 200),
    linha1: rua.slice(0, 200),
    codigo_postal: cp.slice(0, 20),
    localidade: localidade.slice(0, 100),
    pais,
    distanciaM: Number.isFinite(d) && d >= 0 ? Math.round(d) : null,
  };
}

/** O id do ponto como a Sendcloud o deu: um número, se for só algarismos. */
const idDoPonto = (id: string) => (/^[0-9]{1,15}$/.test(id) ? Number(id) : id);

export function adaptadorSendcloud(
  buscar: Buscar = fetch,
): AdaptadorTransportadora {
  return {
    transportadora: "sendcloud",
    camposCredenciais: [
      { campo: "chave_publica", segredo: false },
      { campo: "chave_secreta", segredo: true },
    ],
    // Os serviços são os da conta (D1): `servicosDaConta`.
    servicos: () => [],

    async testar(c) {
      const r = await chamar(buscar, c, "GET", "/user/auth/metadata");
      if (r.estado !== 200) {
        throw new Error(
          `a Sendcloud recusou as credenciais (${String(r.estado)})`,
        );
      }
    },

    async servicosDaConta(c, { origem, destinos }) {
      const porCodigo = new Map<string, ServicoTransportadora>();
      for (const destino of destinos) {
        const r = await chamar(buscar, c, "POST", "/shipping-options", {
          from_country_code: origem,
          to_country_code: destino,
          calculate_quotes: false,
        });
        if (r.estado !== 200) {
          throw new Error(
            `a Sendcloud recusou a lista de serviços (${String(r.estado)})`,
          );
        }
        for (const x of lista(objecto(r.json)?.["data"])) {
          const o = objecto(x);
          const s = o === null ? null : servicoDe(o, destino);
          if (s === null) continue;
          // Só há modo teste (0074): só o serviço que não é cobrado (D2).
          // O modo real é uma migração com decisão escrita.
          if (s.codigo !== SERVICO_DE_TESTE) continue;
          const ja = porCodigo.get(s.codigo);
          // O mesmo código com e sem ponto de recolha noutro país: esse país
          // fica de fora (na dúvida, não vende; docs/36 §21).
          if (ja !== undefined && (ja.ponto === true) !== (s.ponto === true)) {
            continue;
          }
          if (ja === undefined) {
            porCodigo.set(s.codigo, s);
          } else {
            porCodigo.set(s.codigo, {
              ...ja,
              paises: [...new Set([...ja.paises, destino])],
              pesoMaxG:
                ja.pesoMaxG === null || s.pesoMaxG === null
                  ? null
                  : Math.min(ja.pesoMaxG, s.pesoMaxG),
              pedeTelefone: ja.pedeTelefone || s.pedeTelefone,
              pedeEmail: ja.pedeEmail || s.pedeEmail,
            });
          }
        }
      }
      return [...porCodigo.values()].sort((a, b) =>
        a.codigo.localeCompare(b.codigo),
      );
    },

    async procurarPontos(c, { servico, pais, codigoPostal, limite }) {
      // A transportadora do serviço: a parte antes de «:» no código do
      // serviço (ex.: `postnl:standard`). Só o país e o código postal saem.
      const transportadora = servico.split(":")[0] ?? "";
      const q = new URLSearchParams({
        country_code: pais,
        address_postal_code: codigoPostal,
        carrier_code: transportadora,
        limit: String(limite),
      });
      const r = await chamar(
        buscar,
        c,
        "GET",
        `/service-points?${q.toString()}`,
      );
      if (r.estado !== 200) {
        throw new ErroDeRede(
          `a procura de pontos respondeu ${String(r.estado)}`,
        );
      }
      const j = r.json;
      const dados = Array.isArray(j) ? j : lista(objecto(j)?.["data"]);
      const pontos: PontoRecolha[] = [];
      for (const x of dados) {
        const o = objecto(x);
        const p = o === null ? null : pontoDe(o);
        if (p !== null && p.pais === pais) pontos.push(p);
      }
      return pontos.slice(0, limite);
    },

    async pontoDisponivel(c, ponto) {
      const r = await chamar(
        buscar,
        c,
        "POST",
        `/service-points/${encodeURIComponent(ponto)}/check-availability`,
      );
      if (r.estado === 404) return false;
      if (r.estado !== 200) {
        throw new ErroDeRede(`a disponibilidade respondeu ${String(r.estado)}`);
      }
      const j = objecto(r.json);
      const v = objecto(j?.["data"])?.["is_available"] ?? j?.["is_available"];
      // Só um «sim» claro conta (na dúvida, não vende).
      return v === true;
    },

    async pedirEtiqueta(c, p): Promise<ResultadoEtiqueta> {
      // Só há modo teste (0074): nenhum outro serviço chega à Sendcloud,
      // mesmo que a fotografia o tivesse (revisão do #406, P3-5).
      if (p.servico !== SERVICO_DE_TESTE) {
        return {
          estado: "recusada",
          motivo: `em modo teste só se pede o serviço ${SERVICO_DE_TESTE}`,
        };
      }
      // Só o que a entrega precisa (D9): sem linhas, preços nem encomenda.
      const r = await chamar(buscar, c, "POST", "/shipments/announce", {
        label_details: { mime_type: "application/pdf", dpi: 72 },
        external_reference_id: p.chaveIdempotencia,
        reference: p.referencia,
        ship_with: {
          type: "shipping_option_code",
          properties: { shipping_option_code: p.servico },
        },
        from_address: morada(p.remetente),
        to_address: morada(p.destinatario),
        ...(p.ponto === undefined
          ? {}
          : { to_service_point: { id: idDoPonto(p.ponto) } }),
        parcels: [
          { weight: { value: (p.pesoG / 1000).toFixed(3), unit: "kg" } },
        ],
      });
      if (r.estado === 201 || r.estado === 200 || r.estado === 409) {
        // 409: a mesma referência já tinha um envio, e vem ele (R2).
        const envio = objecto(objecto(r.json)?.["data"]) ?? objecto(r.json);
        const e = await etiquetaDoEnvio(buscar, c, envio);
        if (e !== "sem_etiqueta") return { estado: "emitida", ...e };
        return {
          estado: "recusada",
          motivo: motivoDe(envio, "a transportadora não aceitou o envio"),
        };
      }
      return {
        estado: "recusada",
        motivo: motivoDe(r.json, `a Sendcloud recusou (${String(r.estado)})`),
      };
    },

    async consultarEtiqueta(c, referencia) {
      const r = await chamar(
        buscar,
        c,
        "GET",
        `/shipments?external_reference_id=${encodeURIComponent(referencia)}`,
      );
      // Uma lista não dá 404: não se sabe, e «não existe» deixaria pedir
      // outra (revisão do #406, P3-1).
      if (r.estado !== 200) {
        throw new ErroDeRede(`a consulta respondeu ${String(r.estado)}`);
      }
      const envios = lista(objecto(r.json)?.["data"]);
      if (envios.length === 0) return null;
      const e = await etiquetaDoEnvio(buscar, c, objecto(envios[0]));
      return e === "sem_etiqueta" ? null : e;
    },

    async anularEtiqueta(c, seguimento) {
      const r = await chamar(
        buscar,
        c,
        "GET",
        `/shipments?tracking_number=${encodeURIComponent(seguimento)}`,
      );
      if (r.estado !== 200) {
        throw new ErroDeRede(`a consulta respondeu ${String(r.estado)}`);
      }
      const id = texto(objecto(lista(objecto(r.json)?.["data"])[0])?.["id"]);
      if (id === null) return "nao_permitido";
      const a = await chamar(
        buscar,
        c,
        "POST",
        `/shipments/${encodeURIComponent(id)}/cancel`,
      );
      if (a.estado === 200) return "anulada";
      // 202 (em fila: a Sendcloud só anula se o envio não andar em 14 dias)
      // não é anulada: a etiqueta continua viva e não se pede outra
      // (revisão do #406, P2-4; D7).
      if (a.estado === 202 || a.estado === 409 || a.estado === 404) {
        return "nao_permitido";
      }
      throw new ErroDeRede(`a anulação respondeu ${String(a.estado)}`);
    },

    async consultarSeguimento(c, seguimento) {
      const r = await chamar(
        buscar,
        c,
        "GET",
        `/parcels/tracking/${encodeURIComponent(seguimento)}`,
      );
      if (r.estado === 404) return [];
      if (r.estado !== 200) {
        throw new ErroDeRede(`o seguimento respondeu ${String(r.estado)}`);
      }
      return eventosDe(r.json);
    },

    lerAviso(cabecalhos, corpo, segredo) {
      const dada = cabecalhos["sendcloud-signature"];
      const esperada = createHmac("sha256", segredo)
        .update(corpo, "utf8")
        .digest("hex");
      const recebida = Buffer.from(typeof dada === "string" ? dada : "");
      const devida = Buffer.from(esperada);
      if (
        recebida.length !== devida.length ||
        !timingSafeEqual(recebida, devida)
      ) {
        return { valido: false };
      }
      // O conteúdo não está descrito na v3 (D4): lê-se só o que identifica
      // o volume, e os eventos vêm da consulta.
      const j = ((): Record<string, unknown> | null => {
        try {
          return objecto(JSON.parse(corpo));
        } catch {
          return null;
        }
      })();
      const volume =
        objecto(j?.["parcel"]) ?? objecto(objecto(j?.["data"])?.["parcel"]);
      const fonte = volume ?? j;
      const referencia =
        texto(fonte?.["external_reference_id"]) ??
        texto(fonte?.["external_reference"]);
      return {
        valido: true,
        referencia,
        seguimento: texto(fonte?.["tracking_number"]),
        eventos: [],
      };
    },
  };
}
