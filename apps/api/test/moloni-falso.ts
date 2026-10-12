// Um Moloni em memória para os testes do adaptador (docs/29 §13): responde
// como a documentação oficial descreve (lida a 12/10/2026,
// `docs/eurolify/fontes-api-moloni-11out2026.md` §9) e como os testes de
// 11/10/2026 mediram (§8): token só no endereço, corpo em formulário, erros
// de dados como lista «código campo», `status` 0/1, os documentos com o
// stock e os totais. O que está **por medir** na conta trial (§13.7) segue a
// leitura do adaptador; o teste real é a conta trial, não este falso.

type Json = Record<string, unknown>;

const txt = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

/** O corpo `a[b][0][c]=v` do Moloni como objecto (listas para chaves 0, 1…). */
export function lerFormulario(corpo: string): Json {
  const raiz: Json = {};
  for (const par of corpo.split("&")) {
    if (par === "") continue;
    const [k, v = ""] = par.split("=");
    const chave = decodeURIComponent(k ?? "");
    const valor = decodeURIComponent(v);
    const partes = chave.replace(/\]/g, "").split("[");
    let o: Json = raiz;
    partes.forEach((p, i) => {
      if (i === partes.length - 1) {
        o[p] = valor;
      } else {
        o[p] ??= {};
        o = o[p] as Json;
      }
    });
  }
  const listas = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    const o = x as Json;
    const ks = Object.keys(o);
    if (ks.length > 0 && ks.every((k, i) => k === String(i))) {
      return ks.map((k) => listas(o[k]));
    }
    return Object.fromEntries(ks.map((k) => [k, listas(o[k])]));
  };
  return listas(raiz) as Json;
}

export interface Cliente {
  customer_id: number;
  vat: string;
  name: string;
  number: string;
  country_id: number;
  dados: Json;
}

export interface Artigo {
  product_id: number;
  reference: string;
  name: string;
  has_stock: number;
  dados: Json;
}

export interface DocMoloni {
  document_id: number;
  status: number;
  saft: string;
  our_reference: string;
  number: number;
  document_set_id: number;
  customer_id: number;
  date: string;
  notes: string;
  products: Json[];
}

export interface Falhas {
  /** O pedido fica feito, mas a resposta perde-se. */
  rede?: Set<string>;
  /** O pedido nem chega (nada feito). */
  recusar?: Set<string>;
  /** A renovação responde `invalid_grant`. */
  renovacaoMorta?: boolean;
  /** O próximo documento volta com este `status`. */
  statusForcado?: number;
  /** As linhas do documents/getAll sem `our_reference` (está por medir). */
  getAllSemReferencia?: boolean;
  /** O documents/getAll ignora o filtro e devolve tudo. */
  getAllIgnoraFiltro?: boolean;
  /** A renovação responde `invalid_client` (o segredo do servidor errado). */
  segredoErrado?: boolean;
  /** O PDF vem de outro sítio, ou não é PDF. */
  pdf?: "outro_anfitriao" | "html";
}

export function moloniFalso() {
  const empresa = 401965;
  const estado = {
    tokens: new Map<string, number>(), // access_token → expira (ms)
    refresh: new Set<string>(),
    /** Os códigos de autorização por trocar (um uso cada; docs/29 §17). */
    codigos: new Set<string>(),
    clientes: [] as Cliente[],
    artigos: [] as Artigo[],
    documentos: [] as DocMoloni[],
    /** tax_id → percentagem. */
    taxas: new Map<number, number>([
      [11, 23],
      [12, 6],
    ]),
    paises: [
      { country_id: 1, iso_3166_1: "pt" },
      { country_id: 70, iso_3166_1: "es" },
    ],
    numero: 0,
    /** Os endereços e os corpos pedidos, como chegaram (para conferir). */
    pedidos: [] as { url: string; metodo: string; corpo: Json }[],
    falhas: {} as Falhas,
    seq: 1000,
  };
  const novoToken = () => {
    const access = `acc-${String(++estado.seq)}`;
    const refresh = `ref-${String(++estado.seq)}`;
    estado.tokens.set(access, Date.now() + 3_600_000);
    estado.refresh.add(refresh);
    return { access, refresh };
  };
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    });

  const paraGetOne = (d: DocMoloni) => {
    const c = estado.clientes.find((x) => x.customer_id === d.customer_id);
    const produtos = d.products.map((p, i) => {
      const price = Number(p["price"]);
      const qty = Number(p["qty"]);
      const taxes = ((p["taxes"] as Json[] | undefined) ?? []).map((t) => {
        const valor = estado.taxas.get(Number(t["tax_id"])) ?? 0;
        const base = price * qty;
        return {
          tax_id: Number(t["tax_id"]),
          type: 1,
          saft_type: 1,
          value: valor,
          incidence_value: base,
          total_value: Math.round(base * valor) / 100,
          order: 0,
          cumulative: 0,
        };
      });
      return {
        product_id: Number(p["product_id"]),
        reference:
          estado.artigos.find((a) => a.product_id === Number(p["product_id"]))
            ?.reference ?? "",
        name: p["name"],
        summary: "",
        price,
        qty,
        discount: Number(p["discount"] ?? 0),
        order: Number(p["order"] ?? i),
        exemption_reason: (p["exemption_reason"] as string | undefined) ?? "",
        taxes,
      };
    });
    const gross = produtos.reduce((s, p) => s + p.price * p.qty, 0);
    const iva = produtos.reduce(
      (s, p) => s + p.taxes.reduce((x, t) => x + t.total_value, 0),
      0,
    );
    return {
      document_id: d.document_id,
      company_id: empresa,
      document_type_id: 1,
      customer_id: d.customer_id,
      document_set_id: d.document_set_id,
      number: d.number,
      date: `${d.date}T00:00:00+0100`,
      expiration_date: `${d.date}T00:00:00+0100`,
      our_reference: d.our_reference,
      your_reference: "",
      entity_vat: c?.vat ?? "",
      entity_name: c?.name ?? "",
      entity_country: "Portugal",
      notes: d.notes,
      gross_value: Math.round(gross * 100) / 100,
      comercial_discount_value: 0,
      financial_discount_value: 0,
      taxes_value: Math.round(iva * 100) / 100,
      net_value: Math.round((gross + iva) * 100) / 100,
      status: d.status,
      rsa_hash: d.status === 1 ? "assinatura" : "",
      document_type: { document_type_id: 1, saft_code: d.saft },
      document_set: { document_set_id: d.document_set_id, name: "LOJA" },
      products: produtos,
    };
  };

  const metodos: Record<string, (c: Json) => unknown> = {
    "companies/getAll": () => [{ company_id: empresa, name: "Empresa trial" }],
    "countries/getAll": () => estado.paises,
    "customers/getByVat": (c) =>
      estado.clientes
        .filter((x) => x.vat.includes(String(c["vat"])))
        .map((x) => ({ customer_id: x.customer_id, vat: x.vat, name: x.name })),
    "customers/getOne": (c) => {
      const x = estado.clientes.find(
        (y) => y.customer_id === Number(c["customer_id"]),
      );
      const p = estado.paises.find((y) => y.country_id === x?.country_id);
      return x === undefined
        ? {}
        : {
            customer_id: x.customer_id,
            vat: x.vat,
            name: x.name,
            country: { country_id: x.country_id, iso_3166_1: p?.iso_3166_1 },
          };
    },
    "customers/insert": (c) => {
      const falta = [
        "vat",
        "number",
        "name",
        "language_id",
        "address",
        "city",
        "country_id",
        "maturity_date_id",
        "payment_method_id",
      ].filter((k) => c[k] === undefined || c[k] === "");
      if (falta.length > 0) return falta.map((k) => `1 ${k}`);
      const x: Cliente = {
        customer_id: ++estado.seq,
        vat: String(c["vat"]),
        name: String(c["name"]),
        number: String(c["number"]),
        country_id: Number(c["country_id"]),
        dados: c,
      };
      estado.clientes.push(x);
      return { valid: 1, customer_id: x.customer_id };
    },
    "products/getByReference": (c) =>
      estado.artigos
        .filter((a) =>
          c["exact"] === "1"
            ? a.reference === c["reference"]
            : a.reference.includes(String(c["reference"])),
        )
        .map((a) => ({
          product_id: a.product_id,
          reference: a.reference,
          name: a.name,
        })),
    "products/insert": (c) => {
      if (estado.artigos.some((a) => a.reference === c["reference"])) {
        return ["4 reference"];
      }
      const a: Artigo = {
        product_id: ++estado.seq,
        reference: String(c["reference"]),
        name: String(c["name"]),
        has_stock: Number(c["has_stock"]),
        dados: c,
      };
      estado.artigos.push(a);
      return { valid: 1, product_id: a.product_id };
    },
    "invoices/insert": (c) => {
      const produtos = (c["products"] as Json[] | undefined) ?? [];
      if (
        produtos.length === 0 ||
        produtos.some(
          (p) =>
            !estado.artigos.some(
              (a) => a.product_id === Number(p["product_id"]),
            ),
        )
      ) {
        return ["2 products"];
      }
      if (
        !estado.clientes.some((x) => x.customer_id === Number(c["customer_id"]))
      ) {
        return ["2 customer_id 1 0"];
      }
      const d: DocMoloni = {
        document_id: ++estado.seq,
        status: Number(c["status"] ?? 0),
        saft: "FT",
        our_reference: txt(c["our_reference"]),
        number: 0,
        document_set_id: Number(c["document_set_id"]),
        customer_id: Number(c["customer_id"]),
        date: String(c["date"]),
        notes: txt(c["notes"]),
        products: produtos,
      };
      estado.documentos.push(d);
      return { valid: 1, document_id: d.document_id };
    },
    "invoices/getOne": (c) => {
      const d = estado.documentos.find(
        (x) => x.document_id === Number(c["document_id"]),
      );
      return d === undefined ? {} : paraGetOne(d);
    },
    "invoices/update": (c) => {
      const d = estado.documentos.find(
        (x) => x.document_id === Number(c["document_id"]),
      );
      if (d === undefined) return ["2 document_id 1 0"];
      if (d.status !== 0) return ["9 status"];
      const obrig = [
        "date",
        "expiration_date",
        "document_set_id",
        "customer_id",
        "products",
      ].filter((k) => c[k] === undefined || c[k] === "");
      if (obrig.length > 0) return obrig.map((k) => `1 ${k}`);
      d.products = c["products"] as Json[];
      d.date = txt(c["date"]);
      d.notes = txt(c["notes"]);
      if (Number(c["status"]) === 1) {
        d.status = estado.falhas.statusForcado ?? 1;
        d.number = ++estado.numero;
      }
      return { valid: 1 };
    },
    "invoices/delete": (c) => {
      const i = estado.documentos.findIndex(
        (x) => x.document_id === Number(c["document_id"]),
      );
      if (i < 0) return ["2 document_id 1 0"];
      if (estado.documentos[i]?.status !== 0) return ["9 status"];
      estado.documentos.splice(i, 1);
      return { valid: 1 };
    },
    "documents/getAll": (c) =>
      estado.documentos
        .filter(
          (d) =>
            estado.falhas.getAllIgnoraFiltro === true ||
            c["our_reference"] === undefined ||
            d.our_reference.includes(txt(c["our_reference"])),
        )
        .map((d) => ({
          document_id: d.document_id,
          ...(estado.falhas.getAllSemReferencia === true
            ? {}
            : { our_reference: d.our_reference }),
          status: d.status,
        })),
    "documents/getOne": (c) => {
      const d = estado.documentos.find(
        (x) => x.document_id === Number(c["document_id"]),
      );
      return d === undefined ? {} : paraGetOne(d);
    },
    "documents/getPDFLink": (c) => {
      const d = estado.documentos.find(
        (x) => x.document_id === Number(c["document_id"]),
      );
      if (d === undefined || d.status === 0) return ["2 document_id 1 0"];
      return {
        url:
          estado.falhas.pdf === "outro_anfitriao"
            ? `https://moloni.pt.exemplo.com/${String(d.document_id)}.pdf`
            : `https://www.moloni.pt/downloads/${String(d.document_id)}.pdf`,
      };
    },
  };

  const fetchFalso = (
    entrada: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(entrada instanceof Request ? entrada.url : entrada);
    const corpo =
      typeof init?.body === "string" ? lerFormulario(init.body) : {};
    const metodo = url.pathname.replace(/^\/v1\//, "").replace(/\/$/, "");
    estado.pedidos.push({ url: url.toString(), metodo, corpo });
    if (estado.falhas.recusar?.has(metodo)) {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (url.hostname === "www.moloni.pt") {
      return Promise.resolve(
        new Response(
          Buffer.from(
            estado.falhas.pdf === "html"
              ? "<html>erro</html>"
              : `%PDF-1.4\n% moloni ${url.pathname}\n`,
          ),
          { status: 200 },
        ),
      );
    }
    if (
      metodo === "grant" &&
      url.searchParams.get("grant_type") === "authorization_code"
    ) {
      const c = url.searchParams.get("code") ?? "";
      if (
        !estado.codigos.has(c) ||
        (url.searchParams.get("redirect_uri") ?? "") === ""
      ) {
        return Promise.resolve(
          json(
            {
              error: "invalid_grant",
              error_description: "Invalid authorization code",
            },
            400,
          ),
        );
      }
      estado.codigos.delete(c);
      const t = novoToken();
      return Promise.resolve(
        json({
          access_token: t.access,
          expires_in: 3600,
          token_type: "bearer",
          scope: null,
          refresh_token: t.refresh,
        }),
      );
    }
    if (metodo === "grant") {
      const r = url.searchParams.get("refresh_token") ?? "";
      if (estado.falhas.segredoErrado === true) {
        return Promise.resolve(
          json(
            {
              error: "invalid_client",
              error_description: "The client credentials are invalid",
            },
            400,
          ),
        );
      }
      if (estado.falhas.renovacaoMorta || !estado.refresh.has(r)) {
        return Promise.resolve(
          json(
            {
              error: "invalid_grant",
              error_description: "Invalid refresh token",
            },
            400,
          ),
        );
      }
      // Cada renovação devolve um par novo e o antigo deixa de servir.
      estado.refresh.delete(r);
      const t = novoToken();
      return Promise.resolve(
        json({
          access_token: t.access,
          expires_in: 3600,
          token_type: "bearer",
          scope: null,
          refresh_token: t.refresh,
        }),
      );
    }
    const token = url.searchParams.get("access_token") ?? "";
    const expira = estado.tokens.get(token);
    if (expira === undefined || expira < Date.now()) {
      return Promise.resolve(
        json(
          {
            error: "invalid_request",
            error_description: "Invalid access token",
          },
          401,
        ),
      );
    }
    const f = metodos[metodo];
    if (f === undefined) return Promise.resolve(json({}, 404));
    const r = f(corpo);
    if (estado.falhas.rede?.has(metodo)) {
      return Promise.reject(new TypeError("fetch failed"));
    }
    return Promise.resolve(json(r));
  };

  /** Credenciais como as que o dono deixaria ao ligar (§13.4). */
  const credenciais = () => {
    const t = novoToken();
    return {
      company_id: String(empresa),
      access_token: t.access,
      refresh_token: t.refresh,
      access_expira: new Date(Date.now() + 3_600_000).toISOString(),
      refresh_em: new Date().toISOString(),
    };
  };

  /** Um artigo que já existe no Moloni. */
  const artigo = (reference: string, name = reference) => {
    const a: Artigo = {
      product_id: ++estado.seq,
      reference,
      name,
      has_stock: 1,
      dados: {},
    };
    estado.artigos.push(a);
    return a;
  };

  /** Um cliente que já existe no Moloni. */
  const cliente = (vat: string, name: string, country_id = 1) => {
    const x: Cliente = {
      customer_id: ++estado.seq,
      vat,
      name,
      number: vat,
      country_id,
      dados: {},
    };
    estado.clientes.push(x);
    return x;
  };

  /** Um código de autorização novo, como o Moloni o daria ao dono. */
  const codigoAutorizacao = () => {
    const c = `cod-${String(estado.codigos.size + 1)}-${String(Date.now())}`;
    estado.codigos.add(c);
    return c;
  };
  return {
    estado,
    fetch: fetchFalso,
    codigoAutorizacao,
    credenciais,
    artigo,
    cliente,
    empresa,
  };
}
