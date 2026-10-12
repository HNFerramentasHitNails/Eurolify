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
}

const json = (estado: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  });

export function sendcloudFalsa() {
  const estado = {
    /** Como responde ao próximo anúncio. */
    anunciar: "emitir" as "emitir" | "recusar" | "falha_no_volume" | "erro_500",
    /** Os serviços que devolve, por país de destino. */
    servicos: new Map<string, Record<string, unknown>[]>(),
    eventos: new Map<string, Record<string, unknown>[]>(),
    anular: 200,
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
  const resposta = (e: Envio, comFicheiro: boolean) => ({
    id: e.id,
    external_reference_id: e.referencia,
    parcels: [
      {
        id: e.volume,
        status: {
          code: e.estado,
          message: e.estado,
        },
        tracking_number: e.seguimento,
        tracking_url: `https://tracking.exemplo/${e.seguimento}`,
        ...(comFicheiro
          ? {
              label_file: Buffer.from(
                `%PDF-sendcloud ${e.referencia}`,
              ).toString("base64"),
            }
          : {}),
      },
    ],
  });

  const buscar = async (
    entrada: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(entrada));
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
            : "READY_TO_SEND",
        corpo: b,
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
    const cancelar = /^\/shipments\/([^/]+)\/cancel$/.exec(caminho);
    if (metodo === "POST" && cancelar !== null) {
      const e = estado.envios.find((x) => x.id === cancelar[1]);
      if (e === undefined) return json(404, { errors: [] });
      if (estado.anular === 200) e.estado = "CANCELLED";
      return json(estado.anular, { data: { status: "cancelled" } });
    }
    const doc = /^\/parcels\/(\d+)\/documents\/label$/.exec(caminho);
    if (metodo === "GET" && doc !== null) {
      const e = estado.envios.find((x) => String(x.volume) === doc[1]);
      if (e === undefined) return new Response("", { status: 404 });
      return new Response(Buffer.from(`%PDF-sendcloud ${e.referencia}`), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
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
  return { buscar: buscar as typeof fetch, estado };
}

/** Um serviço como a Sendcloud o devolve em `POST /shipping-options`. */
export const opcao = (
  code: string,
  extra: {
    fields?: string[];
    servicePoint?: boolean;
    exportDocs?: boolean;
    maxKg?: string;
  } = {},
) => ({
  code,
  name: `Serviço ${code}`,
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
