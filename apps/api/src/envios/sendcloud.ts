import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ErroDeRede,
  type AdaptadorTransportadora,
  type CredenciaisTransportadora,
  type EtiquetaEmitida,
  type EventoSeguimento,
  type MoradaEtiqueta,
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

const BASE = "https://panel.sendcloud.sc/api/v3";

/** O tempo de uma chamada à Sendcloud (proposta; o núcleo tem o seu). */
export const TEMPO_DA_CHAMADA_MS = 20_000;

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
  if (r.status >= 500 || r.status === 429) {
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

/** O envio já existe na Sendcloud: a etiqueta, se for válida. */
async function etiquetaDoEnvio(
  buscar: Buscar,
  c: CredenciaisTransportadora,
  envio: Record<string, unknown> | null,
): Promise<EtiquetaEmitida | null> {
  const v = volumeDe(envio);
  if (
    v === null ||
    v.seguimento === null ||
    v.id === null ||
    v.codigo.includes("CANCEL") ||
    v.codigo.includes("FAILED")
  ) {
    return null;
  }
  const conteudo =
    v.ficheiro !== null
      ? Buffer.from(v.ficheiro, "base64")
      : await ficheiroDoVolume(buscar, c, v.id);
  if (conteudo.length === 0) {
    throw new ErroDeRede("o ficheiro da etiqueta veio vazio");
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
      return "entregue";
    default:
      // `delivery_forced` (sem confirmação da transportadora) e `missing`
      // (pode ser temporário) ficam só no histórico (D6).
      return exception === "returned_sender" ? "devolvida" : "outro";
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
      estadoNormalizado: normalizar(phase, exception),
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
  if (codigo === null || codigo.length > 100) return null;
  const req = objecto(o["requirements"]);
  const campos = lista(req?.["fields"]).map(texto);
  if (
    req?.["is_service_point_required"] === true ||
    req?.["export_documents"] === true ||
    campos.some((c) => c === "length" || c === "width" || c === "height")
  ) {
    return null;
  }
  const max = objecto(objecto(objecto(o["weight"])?.["max"]));
  const valor = Number(texto(max?.["value"]));
  const unidade = texto(max?.["unit"]);
  const pesoMaxG =
    Number.isFinite(valor) && valor > 0
      ? Math.floor(valor * (unidade === "g" ? 1 : 1000))
      : null;
  return {
    codigo,
    nome: { pt: (texto(o["name"]) ?? codigo).slice(0, 200) },
    paises: [destino],
    pesoMaxG,
    pedeTelefone: campos.includes("to_telephone"),
    pedeEmail: campos.includes("to_email"),
    // A Sendcloud só diz «sim ou não» aos perigosos, sem números ONU (D3).
    aceitaOnu: [],
  };
}

export function adaptadorSendcloud(
  buscar: Buscar = fetch,
): AdaptadorTransportadora {
  return {
    transportadora: "sendcloud",
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

    async pedirEtiqueta(c, p): Promise<ResultadoEtiqueta> {
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
        parcels: [
          { weight: { value: (p.pesoG / 1000).toFixed(3), unit: "kg" } },
        ],
      });
      if (r.estado === 201 || r.estado === 200 || r.estado === 409) {
        // 409: a mesma referência já tinha um envio, e vem ele (R2).
        const envio = objecto(objecto(r.json)?.["data"]) ?? objecto(r.json);
        const e = await etiquetaDoEnvio(buscar, c, envio);
        if (e !== null) return { estado: "emitida", ...e };
        if (volumeDe(envio) === null) {
          throw new ErroDeRede("a resposta da Sendcloud não traz o volume");
        }
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
      if (r.estado === 404) return null;
      if (r.estado !== 200) {
        throw new ErroDeRede(`a consulta respondeu ${String(r.estado)}`);
      }
      const envios = lista(objecto(r.json)?.["data"]);
      if (envios.length === 0) return null;
      return etiquetaDoEnvio(buscar, c, objecto(envios[0]));
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
      // 202: em fila; a Sendcloud anula se o envio não andar (D7).
      if (a.estado === 200 || a.estado === 202) return "anulada";
      if (a.estado === 409 || a.estado === 404) return "nao_permitido";
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
      if (
        typeof dada !== "string" ||
        dada.length !== esperada.length ||
        !timingSafeEqual(Buffer.from(dada), Buffer.from(esperada))
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
