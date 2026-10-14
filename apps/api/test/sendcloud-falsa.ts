// Uma Sendcloud de ensaio, no lugar do `fetch`: responde como a documentação
// da API v3 descreve (docs/36 §16.1). Os testes dizem-lhe que serviços a
// conta tem, como responde ao anúncio e que eventos tem cada seguimento.

export const PUBLICA = "pub-123";
export const SECRETA = "sec-456-chave-secreta";

interface Envio {
  id: string;
  referencia: string;
  volume: number;
  seguimento: string;
  estado: string;
  corpo: Record<string, unknown>;
  /** Quantas caixas o anúncio pediu (docs/36 §23). */
  caixas: number;
}

const json = (estado: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  });

export function sendcloudFalsa() {
  const estado = {
    /** Como responde ao próximo anúncio. */
    anunciar: "emitir" as
      "emitir" | "recusar" | "falha_no_volume" | "erro_500" | "anunciando",
    /** A lista de serviços responde 500. */
    opcoesFalham: false,
    /** Os serviços que devolve, por país de destino. */
    servicos: new Map<string, Record<string, unknown>[]>(),
    eventos: new Map<string, Record<string, unknown>[]>(),
    anular: 200,
    /** Os pontos de recolha que a procura devolve (docs/36 §21). */
    pontos: [] as Record<string, unknown>[],
    /** As devoluções criadas (docs/36 §22), pela referência. */
    devolucoes: [] as { id: number; referencia: string; corpo: unknown }[],
    /** Como responde à próxima devolução. */
    devolver: "emitir" as "emitir" | "recusar" | "sem_etiqueta",
    /** A disponibilidade de cada ponto; sem entrada, 404. */
    disponivel: new Map<string, boolean | "erro_500">(),
    envios: [] as Envio[],
    pedidos: [] as {
      metodo: string;
      url: string;
      corpo: unknown;
      auth: string | null;
    }[],
    numero: 0,
  };
  const autorizado = (auth: string | null) =>
    auth === `Basic ${Buffer.from(`${PUBLICA}:${SECRETA}`).toString("base64")}`;
  const resposta = (e: Envio, comFicheiro: boolean) =>
    e.estado === "ANNOUNCING"
      ? // Ainda a anunciar: sem número nem ficheiro.
        {
          id: e.id,
          external_reference_id: e.referencia,
          parcels: [{ id: e.volume, status: { code: e.estado } }],
        }
      : respostaPronta(e, comFicheiro);
  // Uma caixa por volume (docs/36 §23): a 1.ª com o número de sempre.
  const respostaPronta = (e: Envio, comFicheiro: boolean) => ({
    id: e.id,
    external_reference_id: e.referencia,
    parcels: Array.from({ length: e.caixas }, (_, i) => {
      const seguimento =
        i === 0 ? e.seguimento : `${e.seguimento}-${String(i + 1)}`;
      return {
        id: e.volume + i * 100_000,
        status: {
          code: e.estado,
          message: e.estado,
        },
        tracking_number: seguimento,
        tracking_url: `https://tracking.exemplo/${seguimento}`,
        ...(comFicheiro
          ? {
              label_file: Buffer.from(
                i === 0
                  ? `%PDF-sendcloud ${e.referencia}`
                  : `%PDF-sendcloud ${e.referencia} caixa ${String(i + 1)}`,
              ).toString("base64"),
            }
          : {}),
      };
    }),
  });

  const atender = (entrada: string | URL, init?: RequestInit): Response => {
    const url = new URL(entrada);
    const metodo = init?.method ?? "GET";
    const cab = (init?.headers ?? {}) as Record<string, string>;
    const auth = cab["authorization"] ?? null;
    const corpo =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : null;
    estado.pedidos.push({
      metodo,
      url: url.pathname + url.search,
      corpo,
      auth,
    });
    if (!autorizado(auth))
      return json(401, {
        errors: [{ status: "401", code: "unauthorized", detail: "no" }],
      });
    const caminho = url.pathname.replace(/^\/api\/v3/, "");

    if (metodo === "GET" && caminho === "/user/auth/metadata") {
      return json(200, { data: { user_id: 1 } });
    }
    if (metodo === "POST" && caminho === "/shipping-options") {
      if (estado.opcoesFalham) return json(500, {});
      const destino = (corpo as { to_country_code: string }).to_country_code;
      return json(200, { data: estado.servicos.get(destino) ?? [] });
    }
    if (metodo === "POST" && caminho === "/shipments/announce") {
      const b = corpo as Record<string, unknown>;
      const ref = b["external_reference_id"] as string;
      const ja = estado.envios.find((e) => e.referencia === ref);
      if (ja !== undefined) return json(409, resposta(ja, false));
      if (estado.anunciar === "erro_500") return json(500, {});
      if (estado.anunciar === "recusar") {
        return json(400, {
          errors: [
            {
              status: "400",
              code: "invalid",
              detail: "Postal code is invalid.",
              source: { pointer: "/to_address/postal_code" },
            },
          ],
        });
      }
      estado.numero += 1;
      const e: Envio = {
        id: `shp-${String(estado.numero)}`,
        referencia: ref,
        volume: 1000 + estado.numero,
        seguimento: `SC${String(estado.numero).padStart(8, "0")}`,
        estado:
          estado.anunciar === "falha_no_volume"
            ? "ANNOUNCEMENT_FAILED"
            : estado.anunciar === "anunciando"
              ? "ANNOUNCING"
              : "READY_TO_SEND",
        corpo: b,
        caixas: Array.isArray(b["parcels"]) ? b["parcels"].length : 1,
      };
      estado.envios.push(e);
      if (estado.anunciar === "falha_no_volume") {
        return json(201, {
          data: {
            ...resposta(e, false),
            parcels: [{ id: e.volume, status: { code: e.estado } }],
            errors: [
              {
                status: "500",
                code: "parcel_announcement_error",
                detail: "carrier down",
              },
            ],
          },
        });
      }
      return json(201, { data: resposta(e, true) });
    }
    if (metodo === "GET" && caminho === "/shipments") {
      const ref = url.searchParams.get("external_reference_id");
      const seg = url.searchParams.get("tracking_number");
      const e = estado.envios.filter(
        (x) =>
          (ref !== null && x.referencia === ref) ||
          (seg !== null && x.seguimento === seg),
      );
      return json(200, { data: e.map((x) => resposta(x, false)) });
    }
    if (metodo === "POST" && caminho === "/returns/announce-synchronously") {
      const b = corpo as { external_reference?: string };
      if (
        estado.devolucoes.some((x) => x.referencia === b.external_reference)
      ) {
        return json(400, {
          error: {
            code: "invalid",
            message:
              "External reference has already been used in another return.",
          },
        });
      }
      if (estado.devolver === "recusar") {
        return json(400, {
          error: {
            code: "invalid_postal_code",
            message: "Invalid postal code.",
          },
        });
      }
      estado.numero += 1;
      const id = 7000 + estado.numero;
      estado.devolucoes.push({
        id,
        referencia: b.external_reference ?? "",
        corpo,
      });
      return json(201, { return_id: id, parcel_id: id + 1 });
    }
    const devolucao = /^\/returns\/(\d+)$/.exec(caminho);
    if (metodo === "GET" && devolucao !== null) {
      const d = estado.devolucoes.find((x) => String(x.id) === devolucao[1]);
      if (d === undefined) return json(404, {});
      return json(200, {
        data: {
          id: d.id,
          tracking_number:
            estado.devolver === "sem_etiqueta" ? null : `RT${String(d.id)}`,
          tracking_url: `https://tracking.exemplo/RT${String(d.id)}`,
          label:
            estado.devolver === "sem_etiqueta"
              ? null
              : {
                  label_printer: `https://panel.sendcloud.sc/api/v3/parcels/${String(d.id + 1)}/documents/label`,
                },
        },
      });
    }
    if (metodo === "GET" && caminho === "/service-points") {
      return json(200, { data: estado.pontos });
    }
    const disp = /^\/service-points\/([^/]+)\/check-availability$/.exec(
      caminho,
    );
    if (metodo === "POST" && disp !== null) {
      const d = estado.disponivel.get(decodeURIComponent(disp[1] ?? ""));
      if (d === undefined) return json(404, { errors: [] });
      if (d === "erro_500") return json(500, {});
      return json(200, { data: { is_available: d } });
    }
    const cancelar = /^\/shipments\/([^/]+)\/cancel$/.exec(caminho);
    if (metodo === "POST" && cancelar !== null) {
      const e = estado.envios.find((x) => x.id === cancelar[1]);
      if (e === undefined) return json(404, { errors: [] });
      if (estado.anular === 200) e.estado = "CANCELLED";
      return json(estado.anular, { data: { status: "cancelled" } });
    }
    const doc = /^\/parcels\/(\d+)\/documents\/label$/.exec(caminho);
    if (metodo === "GET" && doc !== null) {
      // A caixa n de um envio tem o id do volume + (n − 1) × 100 000 (§23).
      const n = Number(doc[1]);
      const e = estado.envios.find(
        (x) =>
          n >= x.volume &&
          (n - x.volume) % 100_000 === 0 &&
          (n - x.volume) / 100_000 < x.caixas,
      );
      const caixa = e === undefined ? 1 : (n - e.volume) / 100_000 + 1;
      const d = estado.devolucoes.find((x) => String(x.id + 1) === doc[1]);
      if (d !== undefined) {
        return new Response(Buffer.from(`%PDF-devolucao ${d.referencia}`), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      if (e === undefined) return new Response("", { status: 404 });
      return new Response(
        Buffer.from(
          caixa === 1
            ? `%PDF-sendcloud ${e.referencia}`
            : `%PDF-sendcloud ${e.referencia} caixa ${String(caixa)}`,
        ),
        {
          status: 200,
          headers: { "content-type": "application/pdf" },
        },
      );
    }
    const seg = /^\/parcels\/tracking\/(.+)$/.exec(caminho);
    if (metodo === "GET" && seg !== null) {
      const ev = estado.eventos.get(decodeURIComponent(seg[1] ?? ""));
      if (ev === undefined)
        return json(404, { detail: "Parcel does not exist" });
      return json(200, { events: ev });
    }
    return json(404, {
      errors: [{ status: "404", code: "not_found", detail: "?" }],
    });
  };
  // O adaptador só chama com o endereço em texto.
  const buscar: typeof fetch = (entrada, init) =>
    Promise.resolve(atender(entrada as string | URL, init));
  return { buscar, estado };
}

/** Um serviço como a Sendcloud o devolve em `POST /shipping-options`. */
export const opcao = (
  code: string,
  extra: {
    fields?: string[];
    servicePoint?: boolean;
    exportDocs?: boolean;
    maxKg?: string;
    multicollo?: boolean;
  } = {},
) => ({
  code,
  name: `Serviço ${code}`,
  ...(extra.multicollo === undefined
    ? {}
    : { functionalities: { multicollo: extra.multicollo } }),
  requirements: {
    fields: extra.fields ?? [],
    export_documents: extra.exportDocs ?? false,
    is_service_point_required: extra.servicePoint ?? false,
  },
  weight: {
    min: { value: "0.001", unit: "kg" },
    max: { value: extra.maxKg ?? "2.000", unit: "kg" },
  },
});
