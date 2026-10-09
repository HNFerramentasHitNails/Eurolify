// Capturas e passagem pelos ecrãs do Hub contra a API verdadeira (docs/22
// §6). Só para máquinas de teste: cria uma base nova no PostgreSQL local,
// arranca a API com o Hub ligado, serve o `dist/` por HTTPS (certificado
// feito na hora) com `/hub/*` encaminhado para a API, e percorre os ecrãs no
// Chromium com uma passkey em software (o autenticador virtual do Chromium).
//
// Uso: BASE_DADOS_URL=postgres://postgres:…@127.0.0.1:5432/postgres \
//      CAPTURAS=/caminho/para/as/capturas node scripts/capturas.mjs
// Pede `pnpm run construir` na API e no Hub antes.

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import { request as pedidoHttp } from "node:http";
import { deflateSync, crc32 } from "node:zlib";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const HUB = resolve(AQUI, "..");
const API = resolve(HUB, "../api");
const URL_BASE = process.env.BASE_DADOS_URL;
const SAIDA = process.env.CAPTURAS ?? join(tmpdir(), "capturas-hub");
const CHROMIUM =
  process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORTA_HUB = 5443;
const PORTA_API = 8181;
const ORIGEM = `https://localhost:${String(PORTA_HUB)}`;
const SENHA = "so-para-testes";

if (URL_BASE === undefined) {
  console.error("falta BASE_DADOS_URL (superutilizador da base de testes)");
  process.exit(1);
}
mkdirSync(SAIDA, { recursive: true });

const nomeBase = `hub_capturas_${randomBytes(4).toString("hex")}`;
const urlDe = (nome, utilizador, senha) => {
  const u = new URL(URL_BASE);
  u.pathname = `/${nome}`;
  if (utilizador !== undefined) {
    u.username = utilizador;
    u.password = senha;
  }
  return u.toString();
};
const psql = (sqlTexto, base = nomeBase) =>
  execFileSync(
    "psql",
    [urlDe(base), "-v", "ON_ERROR_STOP=1", "-qAtc", sqlTexto],
    {
      encoding: "utf8",
    },
  ).trim();
const resumo = (s) => createHash("sha256").update(s).digest("hex");

// 1. A base, as migrações e um comerciante com um convite do operador.
psql(`create database ${nomeBase}`, "postgres");
// A limpeza corre sempre ao sair, também se algo falhar a meio (revisão do
// #158, P3-9): a base de teste apaga-se e o eurolify_api fica sem senha.
let processoApi;
let arrumado = false;
process.on("exit", () => {
  if (arrumado) return;
  arrumado = true;
  processoApi?.kill();
  try {
    psql(`drop database if exists ${nomeBase} with (force)`, "postgres");
    psql(`alter role eurolify_api password null`, "postgres");
  } catch (erro) {
    console.error(`limpeza: ${String(erro)}`);
  }
});
execFileSync("node", [join(API, "dist/migrar.js")], {
  env: { ...process.env, BASE_DADOS_URL_MIGRACAO: urlDe(nomeBase) },
  stdio: "inherit",
});
psql(`alter role eurolify_api login password '${SENHA}'`);
const { abrirBase } = await import(join(API, "dist/base/ligacao.js"));
const { publicar } = await import(join(API, "dist/catalogo/publicacao.js"));
const { classificarArtigo, mudarEstadoArtigo, obterArtigo } = await import(
  join(API, "dist/catalogo/repositorio.js")
);
const {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  anunciarReducao,
  definirPreco,
  mudarEstadoMercado,
} = await import(join(API, "dist/precos/repositorio.js"));
const { comComerciante, criarEntidadeLegal, criarLoja } = await import(
  join(API, "dist/comerciante/repositorio.js")
);
const { registarComerciante } = await import(
  join(API, "dist/comerciante/repositorio.js")
);
const { criarArtigo, criarOpcao, definirValoresDaVariante } = await import(
  join(API, "dist/catalogo/repositorio.js")
);
const { registarFicheiro, criarMedia } = await import(
  join(API, "dist/catalogo/media.js")
);
const { ArmazenamentoEmDisco } = await import(
  join(API, "dist/catalogo/armazenamento.js")
);
// As imagens dos artigos (docs/22 §12): uma pasta temporária, como a da VPS.
const PASTA_MEDIA = join(
  tmpdir(),
  `hub-media-${randomBytes(4).toString("hex")}`,
);
mkdirSync(PASTA_MEDIA);
const base = abrirBase(urlDe(nomeBase, "eurolify_api", SENHA));
const comerciante = await registarComerciante(base, {
  nome: "Loja de Ensaio",
  lingua: "pt",
  fuso: "Europe/Lisbon",
});
await base.destroy();
const convidar = (email, papel) => {
  const segredo = `euc_${randomBytes(32).toString("base64url")}`;
  psql(
    `select convite_criar_pelo_operador('${comerciante}'::uuid, '${email}', '${papel}', '${resumo(segredo)}', 'operador:github:1001')`,
  );
  return segredo;
};
const conviteDona = convidar("ana@exemplo.test", "dono");
// O convite do Rui fica na lista da equipa (cancela-se na passagem).
convidar("rui@exemplo.test", "gestor");
const conviteGestor = convidar("gil@exemplo.test", "gestor");
const conviteApoio = convidar("ivo@exemplo.test", "apoio");
// Só para as capturas finais: fica em aberto até ao fim.
const conviteDasCapturas = convidar("teo@exemplo.test", "armazem");

// 2. A API com o Hub ligado, atrás do «proxy» de confiança (127.0.0.1).
const api = spawn("node", [join(API, "dist/servidor.js")], {
  env: {
    ...process.env,
    ANFITRIAO: "127.0.0.1",
    PORTA: String(PORTA_API),
    BASE_DADOS_URL: urlDe(nomeBase, "eurolify_api", SENHA),
    HUB_ORIGEM: ORIGEM,
    PROXY_CONFIAVEL: "127.0.0.1",
    // A palavra-passe com o TOTP ligada (docs/22 §9.2), com uma chave nova.
    TOTP_CHAVE: randomBytes(32).toString("base64"),
    MEDIA_PASTA: PASTA_MEDIA,
  },
  stdio: ["ignore", "ignore", "inherit"],
});
processoApi = api;

// 3. O «nginx»: estáticos do Hub e /hub/* para a API, por HTTPS.
const chaves = join(tmpdir(), `hub-cert-${randomBytes(4).toString("hex")}`);
mkdirSync(chaves);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    join(chaves, "chave.pem"),
    "-out",
    join(chaves, "cert.pem"),
  ],
  { stdio: "ignore" },
);
// A mesma política de segurança que o nginx do ensaio dá aos ecrãs, lida do
// próprio ficheiro: uma imagem, um estilo ou um pedido que ela bloqueie no
// ensaio também falha aqui (revisão do #206).
const POLITICA = /add_header Content-Security-Policy "([^"]+)"/.exec(
  readFileSync(
    resolve(HUB, "..", "..", "infra", "vps", "ficheiros", "nginx-hub.conf"),
    "utf8",
  ),
)?.[1];
if (POLITICA === undefined) {
  throw new Error("nginx-hub.conf sem a Content-Security-Policy");
}
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
};
const servidor = createServer(
  {
    key: readFileSync(join(chaves, "chave.pem")),
    cert: readFileSync(join(chaves, "cert.pem")),
  },
  (pedido, resposta) => {
    const url = new URL(pedido.url ?? "/", ORIGEM);
    if (url.pathname.startsWith("/hub/")) {
      const encaminhado = pedidoHttp(
        {
          host: "127.0.0.1",
          port: PORTA_API,
          path: pedido.url,
          method: pedido.method,
          // Cada navegador da passagem é uma pessoa diferente, com o seu
          // endereço (x-ip-de-teste): com todos no mesmo, o limite de 20
          // pedidos por minuto das rotas públicas apanhava-os juntos.
          headers: (() => {
            const { "x-ip-de-teste": ipDeTeste, ...resto } = pedido.headers;
            return {
              ...resto,
              "x-forwarded-for":
                typeof ipDeTeste === "string"
                  ? ipDeTeste
                  : (pedido.socket.remoteAddress ?? ""),
            };
          })(),
        },
        (r) => {
          resposta.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(resposta);
        },
      );
      pedido.pipe(encaminhado);
      return;
    }
    let ficheiro = join(HUB, "dist", url.pathname);
    if (
      !ficheiro.startsWith(join(HUB, "dist")) ||
      !existsSync(ficheiro) ||
      url.pathname === "/"
    ) {
      ficheiro = join(HUB, "dist", "index.html");
    }
    try {
      const corpo = readFileSync(ficheiro);
      resposta.writeHead(200, {
        "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream",
        "content-security-policy": POLITICA,
      });
      resposta.end(corpo);
    } catch {
      resposta.writeHead(200, {
        "content-type": TIPOS[".html"],
        "content-security-policy": POLITICA,
      });
      resposta.end(readFileSync(join(HUB, "dist", "index.html")));
    }
  },
);
await new Promise((r) => servidor.listen(PORTA_HUB, "127.0.0.1", r));
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${String(PORTA_API)}/health`);
    if (r.ok) break;
  } catch {
    // ainda a arrancar
  }
  await new Promise((r) => setTimeout(r, 200));
}

/** Um PNG de uma cor só (64 × 64), feito aqui: nenhuma imagem de fora. */
function pngDeUmaCor([r, g, b]) {
  const pedaco = (tipo, dados) => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc32(corpo));
    return Buffer.concat([tamanho, corpo, soma]);
  };
  const lado = 64;
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(lado, 0);
  cabecalho.writeUInt32BE(lado, 4);
  cabecalho.writeUInt8(8, 8); // 8 bits por canal
  cabecalho.writeUInt8(2, 9); // RGB
  const linha = Buffer.alloc(1 + lado * 3);
  for (let x = 0; x < lado; x++) linha.set([r, g, b], 1 + x * 3);
  const pixeis = Buffer.concat(Array.from({ length: lado }, () => linha));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco("IHDR", cabecalho),
    pedaco("IDAT", deflateSync(pixeis)),
    pedaco("IEND", Buffer.alloc(0)),
  ]);
}

// 30 artigos fictícios (mais do que uma página de 25; docs/22 §11), pela
// mesma função do POST /products, sem chave (uma chave aparecia na lista das
// chaves). O 30 vem do sistema de gestão do comerciante. O 1 tem a ficha
// completa (docs/22 §12.3): duas variantes, uma descrição e duas imagens,
// uma com texto alternativo e outra sem.
let artigoDaFicha = "";
// O 2 edita-se na passagem (docs/22 §13), com duas imagens sem texto; o 30
// vem do sistema de gestão (P5).
let artigoEditavel = "";
let artigoExterno = "";
// O 3 tem o histórico com mais de uma página (docs/22 §16).
let artigoDoHistorico = "";
let canalDaFicha;
let mercadoDaFicha;
{
  const CORES = ["Azul", "Rosa", "Verde", "Lilás", "Coral", "Areia"];
  // A linha do tempo do catálogo (docs/14 §3.12, migração 0033) recusa uma
  // escrita sem «quem». A preparação escreve pelas funções do repositório,
  // sem pedido: o «quem» vai só nas ligações dela (revisão do #217, P3-1); a
  // API e o Hub põem o seu em cada escrita.
  const urlDaPreparacao = new URL(urlDe(nomeBase, "eurolify_api", SENHA));
  urlDaPreparacao.searchParams.set(
    "options",
    "-c eurolify.quem=passagem:preparar",
  );
  const baseArtigos = abrirBase(urlDaPreparacao.toString());
  for (let i = 0; i < 30; i++) {
    const id = await criarArtigo(
      baseArtigos,
      comerciante,
      {
        tipo: "fisico",
        nome: `Verniz ${CORES[i % CORES.length] ?? ""} ${String(i + 1)}`,
        marca: "Marca de Ensaio",
        categoria_fiscal: "normal",
        ...(i === 29 ? { origem_ref: "GESTAO-030" } : {}),
        ...(i === 0
          ? {
              descricao:
                "Verniz de secagem rápida.\nAplicar duas camadas finas.",
            }
          : {}),
      },
      [
        {
          sku: `ENS-${String(i + 1).padStart(3, "0")}`,
          unidade_de_venda: "unidade",
          ...(i === 0
            ? { conteudo_quantidade: 15, conteudo_unidade: "ml", peso_g: 60 }
            : {}),
        },
        ...(i === 0
          ? [{ sku: "ENS-001-B", unidade_de_venda: "caixa", peso_g: 720 }]
          : []),
      ],
    );
    if (i === 0) artigoDaFicha = id;
    if (i === 1) artigoEditavel = id;
    if (i === 2) artigoDoHistorico = id;
    if (i === 29) artigoExterno = id;
  }
  const armazenamento = new ArmazenamentoEmDisco(PASTA_MEDIA);
  for (const [cor, texto, principal, artigoId] of [
    [[37, 99, 235], "Frasco de verniz azul, de frente", true, artigoDaFicha],
    [[219, 39, 119], null, false, artigoDaFicha],
    [[22, 163, 74], null, true, artigoEditavel],
    [[234, 88, 12], null, false, artigoEditavel],
  ]) {
    const bytes = pngDeUmaCor(cor);
    const resumo = createHash("sha256").update(bytes).digest("hex");
    await armazenamento.guardar(comerciante, resumo, bytes);
    await registarFicheiro(
      baseArtigos,
      comerciante,
      { resumo, tipo: "image/png", bytes: bytes.length },
      armazenamento.quotaPorComerciante,
    );
    await criarMedia(baseArtigos, comerciante, {
      artigoId,
      varianteId: null,
      resumo,
      textoAlternativo: texto,
      principal,
    });
  }
  // As opções do artigo 1 (docs/22 §20), ainda em rascunho: «Tamanho» com
  // um valor por variante e um que nenhuma usa («30 ml»), e «Acabamento»
  // com um só valor, nas duas.
  {
    const doArtigo1 = await comComerciante(baseArtigos, comerciante, (trx) =>
      trx
        .selectFrom("variante")
        .select(["id", "sku"])
        .where("artigo_id", "=", artigoDaFicha)
        .execute(),
    );
    const idDe = (sku) => doArtigo1.find((v) => v.sku === sku)?.id ?? "";
    const tamanho = await criarOpcao(
      baseArtigos,
      comerciante,
      artigoDaFicha,
      "Tamanho",
      ["15 ml", "30 ml", "Caixa de 12"],
    );
    const acabamento = await criarOpcao(
      baseArtigos,
      comerciante,
      artigoDaFicha,
      "Acabamento",
      ["Brilhante"],
    );
    const valor = (o, texto) => o.valores.find((v) => v.valor === texto)?.id;
    await definirValoresDaVariante(baseArtigos, comerciante, idDe("ENS-001"), [
      valor(tamanho, "15 ml"),
      valor(acabamento, "Brilhante"),
    ]);
    await definirValoresDaVariante(
      baseArtigos,
      comerciante,
      idDe("ENS-001-B"),
      [valor(tamanho, "Caixa de 12"), valor(acabamento, "Brilhante")],
    );
  }
  // Uma publicação real do artigo 1 (revisão do #206, P2-3): fica em
  // rascunho, porque a segunda imagem não tem texto alternativo.
  const quem = "pessoa:passagem";
  const versao = async () =>
    (await obterArtigo(baseArtigos, comerciante, artigoDaFicha)).versao;
  await classificarArtigo(
    baseArtigos,
    comerciante,
    artigoDaFicha,
    await versao(),
    { familias: ["retalho_geral"], natureza_consumidor: "bem" },
    quem,
  );
  await mudarEstadoArtigo(
    baseArtigos,
    comerciante,
    artigoDaFicha,
    await versao(),
    "activo",
  );
  const entidade = await criarEntidadeLegal(baseArtigos, comerciante, {
    denominacao: "Loja de Ensaio, Lda.",
    forma_juridica: "sociedade por quotas",
    pais: "PT",
    numero_fiscal: "123456789",
    morada_linha: "Rua de Ensaio, 1",
    morada_codigo_postal: "1000-001",
    morada_localidade: "Lisboa",
  });
  const loja = await criarLoja(baseArtigos, comerciante, {
    entidade_legal_id: entidade,
    nome: "Loja online",
  });
  const mercado = await criarMercado(baseArtigos, comerciante, {
    loja_id: loja,
    nome: "Portugal",
    paises: ["PT"],
    moeda: "EUR",
    linguas: ["pt"],
    lingua_principal: "pt",
  });
  const lista = await criarLista(baseArtigos, comerciante, {
    mercado_id: mercado,
    nome: "Base PT",
    tipo: "base",
  });
  await mudarEstadoMercado(baseArtigos, comerciante, mercado, 1, "activo");
  const canal = await criarCanal(baseArtigos, comerciante, {
    loja_id: loja,
    nome: "Loja online",
  });
  await definirMercadosDoCanal(baseArtigos, comerciante, canal, [mercado]);
  const variantes = await comComerciante(baseArtigos, comerciante, (trx) =>
    trx
      .selectFrom("variante")
      .select(["id", "sku"])
      .where("artigo_id", "=", artigoDaFicha)
      .execute(),
  );
  for (const v of variantes) {
    await definirPreco(baseArtigos, comerciante, quem, lista, v.id, {
      montante: 990,
    });
  }
  // Os preços do artigo (docs/22 §17): a ENS-001 com 40 dias a 9,90 € e
  // uma redução para 7,90 € com fim; um segundo mercado (Espanha, preços
  // sem IVA, em rascunho) em que só a ENS-001-B tem preço, gratuito.
  const ens001 = variantes.find((v) => v.sku === "ENS-001")?.id ?? "";
  const ens001b = variantes.find((v) => v.sku === "ENS-001-B")?.id ?? "";
  psql(`insert into historico_preco (comerciante_id, lista_id, variante_id, montante,
          gratuito, saiu, moeda, preco_inclui_iva, em_vigor_desde, definido_por)
        values ('${comerciante}', '${lista}', '${ens001}', 990, false, false, 'EUR',
          true, now() - interval '960 hours', 'passagem:antes')`);
  await anunciarReducao(baseArtigos, comerciante, quem, lista, ens001, {
    montante: 790,
    fim: new Date(Date.now() + 21 * 24 * 3600 * 1000),
  });
  const espanha = await criarMercado(baseArtigos, comerciante, {
    loja_id: loja,
    nome: "Espanha",
    paises: ["ES"],
    moeda: "EUR",
    linguas: ["es"],
    lingua_principal: "es",
    preco_inclui_iva: false,
  });
  const listaEspanha = await criarLista(baseArtigos, comerciante, {
    mercado_id: espanha,
    nome: "Base ES",
    tipo: "base",
  });
  await definirPreco(baseArtigos, comerciante, quem, listaEspanha, ens001b, {
    montante: 0,
    gratuito: true,
  });
  // Uma lista B2B em Portugal (revisão do #252, P3-3): a ENS-001 a 9,00 €,
  // em caixas de 6 (mínimo e múltiplo), sem redução.
  const etiqueta = psql(`begin;
    select set_config('eurolify.quem', 'passagem:etiqueta', true);
    insert into etiqueta_cliente (comerciante_id, nome)
      values ('${comerciante}', 'Profissionais') returning id;
    commit;`)
    .split("\n")
    .filter((l) => /^[0-9a-f-]{36}$/.test(l))
    .at(-1);
  const listaB2b = await criarLista(baseArtigos, comerciante, {
    mercado_id: mercado,
    nome: "Profissionais PT",
    tipo: "b2b",
    etiqueta_id: etiqueta,
    prioridade: 10,
  });
  await definirPreco(baseArtigos, comerciante, quem, listaB2b, ens001, {
    montante: 900,
    quantidade_minima: 6,
    multiplo: 6,
  });
  const publicacao = await publicar(baseArtigos, comerciante, quem, {
    artigo_id: artigoDaFicha,
    canal_id: canal,
    mercado_id: mercado,
  });
  if (publicacao.publicada) {
    throw new Error("a publicação do artigo 1 devia ficar em rascunho");
  }
  canalDaFicha = canal;
  mercadoDaFicha = mercado;
  await baseArtigos.destroy();
}

// 4. O navegador, com uma passkey em software.
const navegador = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
});
const falhas = [];
const passos = [];
/**
 * Confere, na árvore de acessibilidade do Chromium (CDP), que cada table,
 * tr, th e td tem o papel de tabela e que o nome de cada célula só com
 * texto acaba nesse texto (nos cartões, o rótulo visível vem antes: «Papel
 * Armazém»). Devolve as diferenças, ou null se o ecrã não tem tabelas.
 */
async function papeisDasTabelas(contexto, pagina) {
  const esperado = {
    TABLE: "table",
    TR: "row",
    TH: "columnheader",
    TD: "cell",
  };
  const cdp = await contexto.newCDPSession(pagina);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "table, tr, th, td",
    });
    if (nodeIds.length === 0) return null;
    const falhas = [];
    for (const nodeId of nodeIds) {
      const { node } = await cdp.send("DOM.describeNode", { nodeId });
      const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
        backendNodeId: node.backendNodeId,
        fetchRelatives: false,
      });
      const ax = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
      const papel = String(ax?.role?.value ?? "nenhum").toLowerCase();
      const etiqueta = node.nodeName.toUpperCase();
      if (papel !== esperado[etiqueta]) {
        falhas.push(`${etiqueta.toLowerCase()} com o papel ${papel}`);
        continue;
      }
      if (etiqueta === "TD") {
        const { object } = await cdp.send("DOM.resolveNode", { nodeId });
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration:
            "function () { return this.children.length === 0 && this.hasAttribute('data-rotulo') ? (this.textContent || '').replace(/\\s+/g, ' ').trim() : null; }",
          returnByValue: true,
        });
        const texto = result.value;
        const nomeAx = String(ax?.name?.value ?? "")
          .replace(/\s+/g, " ")
          .trim();
        if (
          typeof texto === "string" &&
          texto !== "" &&
          !nomeAx.endsWith(texto)
        ) {
          falhas.push(`célula «${texto}» com o nome «${nomeAx}»`);
        }
      }
    }
    return falhas;
  } finally {
    await cdp.detach();
  }
}

const confere = (condicao, texto) => {
  passos.push(`${condicao ? "ok " : "FALHOU"} ${texto}`);
  if (!condicao) falhas.push(texto);
};

let proximoIp = 0;
try {
  /** Um navegador novo com uma passkey em software. */
  async function comPasskey() {
    proximoIp += 1;
    const c = await navegador.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { "x-ip-de-teste": `10.9.0.${String(proximoIp)}` },
    });
    const p = await c.newPage();
    const cdp = await c.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      },
    );
    return { contexto: c, pagina: p, cdp, autenticador: authenticatorId };
  }

  /**
   * Um endereço novo para a página. O limite do Hub (300 pedidos por minuto
   * por endereço, apps/api/src/base/limite.ts) contava a passagem da Ana
   * toda junta: perto de 300 pedidos em 20 s, e um pedido a mais dava 429 no
   * passo seguinte, a um passo diferente de cada vez (issue #253, medido a
   * 09/10/2026). Cada parte longa começa com o seu endereço, como uma
   * pessoa que volta mais tarde.
   */
  async function enderecoNovo(pagina) {
    proximoIp += 1;
    await pagina.setExtraHTTPHeaders({
      "x-ip-de-teste": `10.9.0.${String(proximoIp)}`,
    });
  }

  /** Aceita um convite numa conta nova e fica nos comerciantes. */
  async function aceitar(p, segredo, nome) {
    await p.goto(`${ORIGEM}/convite#${segredo}`);
    await p.getByLabel("O seu nome").fill(nome);
    await p
      .getByRole("button", { name: "Criar a conta com uma passkey" })
      .click();
    await p.getByRole("button", { name: "Já os guardei" }).click();
    await p.getByRole("heading", { name: "Início", exact: true }).waitFor();
  }

  const { contexto, pagina, cdp, autenticador } = await comPasskey();
  const pedidosVistos = [];
  pagina.on("request", (p) => {
    pedidosVistos.push(p.url());
  });

  // Aceitar o convite: o segredo sai da barra de endereço.
  await pagina.goto(`${ORIGEM}/convite#${conviteDona}`);
  await pagina.getByLabel("O seu nome").waitFor();
  confere(!pagina.url().includes("#"), "o segredo saiu da barra de endereço");
  // Antes de aceitar, o que o convite é (issue #194).
  confere(
    (await pagina
      .getByText(
        "Foi convidado para a equipa de Loja de Ensaio, com o papel Dono.",
      )
      .count()) === 1 &&
      (await pagina
        .getByText("O convite é para ana@exemplo.test e expira a", {
          exact: false,
        })
        .count()) === 1,
    "convite: diz o comerciante, o papel, o e-mail e quando expira",
  );
  await pagina.screenshot({
    path: join(SAIDA, "convite-resumo-claro.png"),
    fullPage: true,
  });
  await pagina.getByLabel("O seu nome").fill("Ana Teste");
  await pagina
    .getByRole("button", { name: "Criar a conta com uma passkey" })
    .click();
  await pagina
    .getByRole("heading", { name: "Os seus códigos de recuperação" })
    .waitFor();
  const codigos = await pagina.locator(".codigos li").count();
  const codigosDaAna = await pagina.locator(".codigos li").allTextContents();
  confere(codigos === 10, `10 códigos de recuperação (vi ${String(codigos)})`);
  await pagina.setViewportSize({ width: 375, height: 800 });
  await pagina.screenshot({
    path: join(SAIDA, "codigos-375-claro.png"),
    fullPage: true,
  });
  await pagina.getByRole("button", { name: "Já os guardei" }).click();

  // Os comerciantes e a equipa.
  await pagina.getByRole("heading", { name: "Início", exact: true }).waitFor();
  await pagina.getByText("Loja de Ensaio").waitFor();
  await pagina.getByRole("link", { name: "Equipa", exact: true }).click();
  await pagina.getByRole("heading", { name: /Equipa/ }).waitFor();
  confere(
    await pagina
      .getByText("rui@exemplo.test")
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      ),
    "a equipa mostra o convite em aberto do Rui",
  );

  // Convidar pede autenticação recente? Acabou de criar a conta: não.
  await pagina.getByLabel("E-mail do convidado").fill("eva@exemplo.test");
  await pagina.getByLabel("Papel", { exact: true }).selectOption("apoio");
  await pagina.getByRole("button", { name: "Criar o convite" }).click();
  await pagina.getByText("Ligação do convite").waitFor();
  const ligacao = await pagina.locator(".segredo").textContent();
  confere(
    (ligacao ?? "").startsWith(`${ORIGEM}/convite#euc_`),
    "a ligação do convite leva o segredo depois do #",
  );
  await pagina.screenshot({
    path: join(SAIDA, "convidar-ligacao-375-claro.png"),
    fullPage: true,
  });

  // Sair e entrar outra vez com a mesma passkey.
  await pagina.getByRole("button", { name: "Sair", exact: true }).click();
  await pagina.getByRole("heading", { name: "Entrar no Hub" }).waitFor();
  await pagina.getByRole("button", { name: "Entrar com passkey" }).click();
  await pagina.getByRole("heading", { name: "Início", exact: true }).waitFor();
  confere(
    new URL(pagina.url()).pathname === "/",
    "sair e entrar outra vez com a passkey",
  );
  // «Voltar atrás» depois de entrar não regressa a /entrar (P3-3).
  await pagina.goBack();
  await pagina.waitForTimeout(300);
  confere(
    new URL(pagina.url()).pathname !== "/entrar",
    "voltar atrás depois de entrar não volta ao ecrã de entrar",
  );

  const equipa = `${ORIGEM}/equipa?comerciante=mer_${comerciante}`;

  // Autenticação recente: com a sessão autenticada há uma hora, convidar
  // pede a passkey outra vez e repete (revisão do #158, P2-4).
  psql(
    "update sessao set autenticada_em = now() - interval '1 hour' where revogada_em is null",
  );
  const antes = pedidosVistos.length;
  await pagina.goto(equipa);
  await pagina.getByLabel("E-mail do convidado").fill("ze@exemplo.test");
  await pagina.getByLabel("Papel", { exact: true }).selectOption("armazem");
  await pagina.getByRole("button", { name: "Criar o convite" }).click();
  await pagina.getByText("Ligação do convite").waitFor();
  confere(
    pedidosVistos
      .slice(antes)
      .some((u) => u.endsWith("/hub/session/reauthenticate")),
    "convidar com a sessão antiga pede a passkey outra vez e repete",
  );

  // Passkey recusada na reautenticação (sem verificação do utilizador): fica
  // neutro, não vermelho, e diz o que fazer (revisão do #177, P2-1).
  psql(
    "update sessao set autenticada_em = now() - interval '1 hour' where revogada_em is null",
  );
  await cdp.send("WebAuthn.setUserVerified", {
    authenticatorId: autenticador,
    isUserVerified: false,
  });
  await pagina.goto(equipa);
  await pagina.getByLabel("E-mail do convidado").fill("lia@exemplo.test");
  await pagina.getByLabel("Papel", { exact: true }).selectOption("apoio");
  await pagina.getByRole("button", { name: "Criar o convite" }).click();
  await pagina.waitForTimeout(1500);
  const vermelho = await pagina.locator(".erro").count();
  const textoNeutro = await pagina
    .getByText("Saia e volte a entrar", { exact: false })
    .count();
  confere(
    vermelho === 0 && textoNeutro === 1,
    `passkey recusada na reautenticação: aviso neutro que diz o que fazer, sem caixa vermelha (vermelho ${String(vermelho)}, neutro ${String(textoNeutro)})`,
  );
  await cdp.send("WebAuthn.setUserVerified", {
    authenticatorId: autenticador,
    isUserVerified: true,
  });

  // Cancelar um convite; o mesmo noutro separador já não vale e a lista
  // volta a ler-se (P2-3).
  const outroSeparador = await contexto.newPage();
  await outroSeparador.goto(equipa);
  await outroSeparador.getByText("rui@exemplo.test").waitFor();
  await pagina.goto(equipa);
  pagina.once("dialog", (d) => void d.accept());
  await pagina
    .getByRole("button", { name: "Cancelar: rui@exemplo.test" })
    .click();
  await pagina.getByText("O convite foi cancelado.").waitFor();
  confere(
    (await pagina.getByText("rui@exemplo.test").count()) === 0,
    "cancelar tira o convite da lista",
  );
  outroSeparador.once("dialog", (d) => void d.accept());
  await outroSeparador
    .getByRole("button", { name: "Cancelar: rui@exemplo.test" })
    .click();
  await outroSeparador
    .getByText("Este convite já foi aceite ou cancelado.")
    .waitFor();
  await outroSeparador.waitForTimeout(500);
  confere(
    (await outroSeparador
      .getByRole("button", { name: "Cancelar: rui@exemplo.test" })
      .count()) === 0,
    "cancelar outra vez noutro separador avisa e volta a ler a lista",
  );
  await outroSeparador.close();

  // Sem rede: a mensagem própria.
  await pagina.route("**/hub/members", (r) => r.abort());
  await pagina.goto(equipa);
  await pagina.getByText("Sem ligação ao servidor", { exact: false }).waitFor();
  confere(
    (await pagina
      .getByText("Sem ligação ao servidor", { exact: false })
      .count()) === 1,
    "sem rede: a mensagem «Sem ligação ao servidor»",
  );
  await pagina.unroute("**/hub/members");

  // Uma ligação de convite estragada não deixa a página em branco (P3-1).
  await pagina.goto(`${ORIGEM}/convite#%E0`);
  await pagina
    .getByText("Esta ligação não tem convite", { exact: false })
    .waitFor();
  confere(
    !pagina.url().includes("#"),
    "ligação estragada: aviso e barra limpa",
  );
  // Um convite já aceite mostra só a recusa, sem formulário (issue #194).
  // Primeiro outra página: só mudar o fragmento não volta a carregar.
  await pagina.goto(`${ORIGEM}/conta`);
  await pagina.goto(`${ORIGEM}/convite#${conviteDona}`);
  await pagina.getByText("Este convite não vale", { exact: false }).waitFor();
  confere(
    (await pagina.getByLabel("O seu nome").count()) === 0 &&
      (await pagina
        .getByRole("button", { name: "Aceitar com esta conta" })
        .count()) === 0,
    "convite já aceite: só a recusa, nada para aceitar",
  );

  // O gestor só oferece armazém e apoio; o apoio não convida (P2-2).
  const gestor = await comPasskey();
  await aceitar(gestor.pagina, conviteGestor, "Gil Teste");
  await gestor.pagina.goto(equipa);
  // Espera pelo formulário: ler as opções antes dele dava uma lista vazia.
  await gestor.pagina.getByRole("option", { name: "Apoio" }).waitFor({
    state: "attached",
  });
  const opcoes = await gestor.pagina
    .getByLabel("Papel", { exact: true })
    .locator("option")
    .allTextContents();
  confere(
    opcoes.join(",") === "Armazém,Apoio",
    `o gestor só vê Armazém e Apoio (vi ${opcoes.join(",")})`,
  );
  await gestor.pagina
    .getByLabel("E-mail do convidado")
    .fill("rita@exemplo.test");
  await gestor.pagina.getByRole("button", { name: "Criar o convite" }).click();
  await gestor.pagina.getByText("Ligação do convite").waitFor();
  confere(
    ((await gestor.pagina.locator(".segredo").textContent()) ?? "").includes(
      "#euc_",
    ),
    "o gestor convida com o papel por omissão (Armazém)",
  );
  // As chaves de API são só do dono (docs/22 §9.3): o gestor não vê a
  // ligação, e a página diz que não tem permissão (a API recusa, 403).
  await gestor.pagina.goto(`${ORIGEM}/`);
  await gestor.pagina.getByText("Loja de Ensaio").waitFor();
  confere(
    (await gestor.pagina
      .getByRole("link", { name: "Chaves de API" })
      .count()) === 0,
    "chaves: o gestor não vê a ligação",
  );
  await gestor.pagina.goto(`${ORIGEM}/chaves?comerciante=mer_${comerciante}`);
  await gestor.pagina.getByText("Não tem permissão para isto.").waitFor();
  confere(true, "chaves: o gestor que abre a página recebe a recusa da API");
  // A passkey do Gil guarda-se: mais à frente aceita outro convite com a
  // conta que já tem (docs/22 §10).
  const { credentials: credenciaisDoGil } = await gestor.cdp.send(
    "WebAuthn.getCredentials",
    { authenticatorId: gestor.autenticador },
  );
  await gestor.contexto.close();
  const apoio = await comPasskey();
  await aceitar(apoio.pagina, conviteApoio, "Ivo Teste");
  await apoio.pagina.goto(equipa);
  await apoio.pagina.getByRole("heading", { name: /Equipa/ }).waitFor();
  await apoio.pagina.getByText("Ana Teste").waitFor();
  confere(
    (await apoio.pagina.getByRole("heading", { name: "Convidar" }).count()) ===
      0 &&
      (await apoio.pagina
        .getByRole("heading", { name: "Convites em aberto" })
        .count()) === 0,
    "o apoio não vê o formulário nem os convites",
  );
  // O apoio lê a ficha mas não a edita (docs/22 §13.2: os âmbitos vêm do
  // /hub/me; o servidor recusa na mesma).
  await apoio.pagina.goto(
    `${ORIGEM}/artigos/prd_${artigoEditavel}?comerciante=mer_${comerciante}`,
  );
  await apoio.pagina
    .getByRole("heading", { name: /Verniz Rosa 2/, level: 1 })
    .waitFor();
  await apoio.pagina
    .getByText("Ainda não está publicado", { exact: false })
    .waitFor();
  confere(
    (await apoio.pagina
      .getByRole("link", { name: "Editar", exact: true })
      .count()) === 0 &&
      (await apoio.pagina
        .getByRole("button", {
          name: /Activar|Arquivar|Editar texto|Acrescentar imagem|Tirar a imagem/,
        })
        .count()) === 0,
    "edição: o apoio vê a ficha sem «Editar» nem acções (nem acrescentar ou tirar imagens)",
  );
  // O apoio não vê o histórico (docs/22 §16.2): sem a ligação, e o
  // endereço directo diz porquê (a API recusa com 403).
  confere(
    (await apoio.pagina.getByRole("link", { name: "Histórico" }).count()) === 0,
    "histórico: o apoio não vê a ligação «Histórico» na ficha",
  );
  await apoio.pagina.goto(
    `${ORIGEM}/artigos/prd_${artigoEditavel}/historico?comerciante=mer_${comerciante}`,
  );
  await apoio.pagina
    .getByText("O seu papel não vê o histórico deste artigo.")
    .waitFor();
  confere(true, "histórico: pelo endereço, o apoio recebe a recusa da API");
  // O apoio não cria (docs/22 §14.4): sem o botão na lista, e o endereço
  // directo diz que não pode.
  await apoio.pagina.goto(`${ORIGEM}/artigos?comerciante=mer_${comerciante}`);
  await apoio.pagina.getByText("30 artigos", { exact: true }).waitFor();
  const semCriarNaLista =
    (await apoio.pagina.getByRole("link", { name: "Criar artigo" }).count()) ===
    0;
  await apoio.pagina.goto(
    `${ORIGEM}/artigos/novo?comerciante=mer_${comerciante}`,
  );
  await apoio.pagina.getByText("Não tem permissão para isto.").waitFor();
  confere(
    semCriarNaLista &&
      (await apoio.pagina.getByLabel("Nome", { exact: true }).count()) === 0,
    "criar: o apoio não vê «Criar artigo» nem o formulário",
  );
  await apoio.contexto.close();

  // O segredo do convite nunca foi num pedido (caminho ou consulta).
  confere(
    !pedidosVistos.some((u) => u.includes("euc_")),
    "nenhum pedido levou o segredo do convite no endereço",
  );

  // Teclado: o primeiro Tab vai ao «Saltar para o conteúdo», e há foco visível.
  await pagina.goto(`${ORIGEM}/entrar`);
  // O React desenha depois do «load»: um Tab antes disso não tem onde ir.
  await pagina.getByRole("heading", { name: "Entrar no Hub" }).waitFor();
  await pagina.keyboard.press("Tab");
  const primeiro = await pagina.evaluate(
    () => document.activeElement?.textContent,
  );
  confere(
    primeiro === "Saltar para o conteúdo",
    `o primeiro Tab é o salto (foi a «${String(primeiro)}»)`,
  );
  await pagina.keyboard.press("Tab");
  await pagina.keyboard.press("Tab");
  await pagina.screenshot({
    path: join(SAIDA, "entrar-teclado-375-claro.png"),
  });

  // B3a — a minha conta (docs/22 §9.1).
  await pagina.goto(`${ORIGEM}/`);
  await pagina.getByRole("link", { name: "Conta", exact: true }).click();
  await pagina.getByRole("heading", { name: "A minha conta" }).waitFor();
  await pagina.getByText("1 passkey", { exact: true }).waitFor();
  confere(
    (await pagina.getByText("Tem só uma passkey", { exact: false }).count()) ===
      1,
    "conta: com uma passkey, o conselho de registar a segunda",
  );

  // A mesma passkey outra vez neste dispositivo: o navegador recusa. Com a
  // sessão antiga, primeiro pede a passkey outra vez (revisão do #174,
  // P2-4).
  psql(
    "update sessao set autenticada_em = now() - interval '1 hour' where revogada_em is null",
  );
  const antesDaConta = pedidosVistos.length;
  await pagina.getByLabel("Nome desta passkey", { exact: false }).fill("Outra");
  await pagina.getByRole("button", { name: "Acrescentar passkey" }).click();
  await pagina
    .getByText("Este dispositivo já tem uma passkey desta conta.")
    .waitFor();
  confere(true, "conta: a passkey já registada neste dispositivo é explicada");
  confere(
    pedidosVistos
      .slice(antesDaConta)
      .some((u) => u.endsWith("/hub/session/reauthenticate")),
    "conta: com a sessão antiga, acrescentar pede a passkey outra vez",
  );

  // Uma passkey nova noutro «dispositivo» (outro autenticador em software).
  // A credencial da primeira guarda-se para entrar noutro navegador.
  const { credentials: daPrimeira } = await cdp.send(
    "WebAuthn.getCredentials",
    { authenticatorId: autenticador },
  );
  await cdp.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: autenticador,
  });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await pagina
    .getByLabel("Nome desta passkey", { exact: false })
    .fill("Telemóvel");
  await pagina.getByRole("button", { name: "Acrescentar passkey" }).click();
  await pagina.getByText("A passkey foi acrescentada.").waitFor();
  confere(
    (await pagina.getByText("2 passkeys", { exact: true }).count()) === 1,
    "conta: acrescentar uma passkey (ficam 2)",
  );

  // Uma recusa 401 com a sessão aberta (passkey de outra conta, desafio fora
  // de prazo) mostra-se e não tira a pessoa da conta (revisão do #174, P1-1).
  await pagina.route("**/hub/passkeys/options", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "auth.unauthenticated" }),
    }),
  );
  await pagina.getByLabel("Nome desta passkey", { exact: false }).fill("Teste");
  await pagina.getByRole("button", { name: "Acrescentar passkey" }).click();
  await pagina
    .getByText("A passkey não foi aceite", { exact: false })
    .waitFor();
  confere(
    new URL(pagina.url()).pathname === "/conta",
    "conta: um 401 com a sessão aberta mostra a recusa e fica na conta",
  );
  await pagina.unroute("**/hub/passkeys/options");

  // Outra sessão da Ana noutro navegador, com a primeira passkey.
  const outro = await comPasskey();
  for (const credencial of daPrimeira) {
    await outro.cdp.send("WebAuthn.addCredential", {
      authenticatorId: outro.autenticador,
      credential: credencial,
    });
  }
  await outro.pagina.goto(`${ORIGEM}/entrar`);
  await outro.pagina
    .getByRole("button", { name: "Entrar com passkey" })
    .click();
  await outro.pagina
    .getByRole("heading", { name: "Início", exact: true })
    .waitFor();
  await pagina.reload();
  await pagina.getByText("2 sessões abertas").waitFor();
  confere(
    (await pagina.locator("td strong", { hasText: "Esta sessão" }).count()) ===
      1,
    "conta: duas sessões, esta marcada",
  );
  await pagina.screenshot({
    path: join(SAIDA, "conta-duas-sessoes-375-claro.png"),
    fullPage: true,
  });
  pagina.once("dialog", (d) => void d.accept());
  await pagina
    .getByRole("button", { name: "Terminar todas as outras" })
    .click();
  await pagina.getByText("As outras sessões terminaram.").waitFor();
  await pagina.getByText("1 sessão aberta").waitFor();
  confere(
    (await pagina
      .getByRole("button", { name: "Terminar todas as outras" })
      .count()) === 0,
    "conta: terminar as outras sessões; fica só esta, sem o botão",
  );
  await outro.pagina.goto(`${ORIGEM}/conta`);
  await outro.pagina.getByRole("heading", { name: "Entrar no Hub" }).waitFor();
  confere(true, "conta: a outra sessão terminou (vai para Entrar)");
  await outro.contexto.close();

  // Retirar a primeira passkey (já não está neste navegador); depois a
  // última é recusada.
  const retirarPrimeira = pagina.locator(
    "button[aria-label^='Retirar: ']:not([aria-label='Retirar: Telemóvel'])",
  );
  pagina.once("dialog", (d) => void d.accept());
  await retirarPrimeira.first().click();
  await pagina.getByText("A passkey foi retirada.", { exact: false }).waitFor();
  await pagina.getByText("1 passkey", { exact: true }).waitFor();
  confere(true, "conta: retirar uma passkey (fica 1)");
  pagina.once("dialog", (d) => void d.accept());
  await pagina.getByRole("button", { name: "Retirar: Telemóvel" }).click();
  await pagina
    .getByText("É a última forma de entrar", { exact: false })
    .waitFor();
  confere(true, "conta: a última passkey não se retira, e o ecrã explica");

  // Códigos novos: 10, uma vez; os da conta nova deixam de valer.
  pagina.once("dialog", (d) => void d.accept());
  await pagina.getByRole("button", { name: "Gerar códigos novos" }).click();
  await pagina.locator(".codigos li").first().waitFor();
  const codigosNovos = await pagina.locator(".codigos li").allTextContents();
  confere(codigosNovos.length === 10, "conta: 10 códigos novos");
  await pagina.screenshot({
    path: join(SAIDA, "conta-codigos-375-claro.png"),
    fullPage: true,
  });
  await pagina.getByRole("button", { name: "Já os guardei" }).click();
  confere(
    (await pagina.locator(".codigos li").count()) === 0,
    "conta: «Já os guardei» esconde os códigos",
  );

  // Recuperar a conta noutro navegador, sem passkey da Ana.
  const recuperado = await comPasskey();
  const rp = recuperado.pagina;
  const pedidosRecuperar = [];
  rp.on("request", (p) => {
    pedidosRecuperar.push(p.url());
  });
  await rp.goto(`${ORIGEM}/entrar`);
  await rp.getByRole("link", { name: "Perdeu a passkey?" }).click();
  await rp.getByRole("heading", { name: "Recuperar a conta" }).waitFor();
  await rp.getByLabel("E-mail da conta").fill("ana@exemplo.test");
  await rp
    .getByLabel("Código de recuperação", { exact: true })
    .fill(codigosDaAna[0] ?? "");
  await rp
    .getByRole("button", { name: "Recuperar com uma passkey nova" })
    .click();
  await rp
    .getByText("O e-mail ou o código não estão certos", { exact: false })
    .waitFor();
  confere(true, "recuperar: um código antigo (já anulado) é recusado");
  // Um código novo escrito em minúsculas e sem hífenes: a API normaliza.
  await rp
    .getByLabel("Código de recuperação", { exact: true })
    .fill((codigosNovos[0] ?? "").toLowerCase().replaceAll("-", ""));
  await rp
    .getByLabel("Nome da passkey nova", { exact: false })
    .fill("Portátil");
  await rp
    .getByRole("button", { name: "Recuperar com uma passkey nova" })
    .click();
  await rp.getByRole("heading", { name: "A minha conta" }).waitFor();
  await rp.getByText("A conta foi recuperada").waitFor();
  // A linha das chaves espera por saber se é dono (o aviso não; P2-2).
  confere(
    await rp
      .getByText("rever as chaves de API", { exact: false })
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      ),
    "recuperar: entra na conta com o aviso, com as chaves (é dona)",
  );
  await rp.getByText("2 passkeys", { exact: true }).waitFor();
  await rp.screenshot({
    path: join(SAIDA, "recuperada-375-claro.png"),
    fullPage: true,
  });
  await rp.goto(`${ORIGEM}/conta`);
  await rp.getByRole("heading", { name: "A minha conta" }).waitFor();
  confere(
    (await rp.getByText("A conta foi recuperada").count()) === 1,
    "recuperar: o aviso fica depois de recarregar",
  );
  await rp.getByRole("button", { name: "Fechar o aviso" }).click();
  await rp.reload();
  await rp.getByRole("heading", { name: "A minha conta" }).waitFor();
  await rp.getByText("2 passkeys", { exact: true }).waitFor();
  confere(
    (await rp.getByText("A conta foi recuperada").count()) === 0,
    "recuperar: fechado, o aviso não volta",
  );
  await pagina.goto(`${ORIGEM}/conta`);
  await pagina.getByRole("heading", { name: "Entrar no Hub" }).waitFor();
  confere(true, "recuperar: a sessão antiga terminou");
  // Os códigos, com e sem hífenes, nos pedidos dos dois navegadores e no
  // que o navegador da recuperação guardou (P2-4).
  const formas = [...codigosDaAna, ...codigosNovos].flatMap((c) => [
    c,
    c.replaceAll("-", ""),
  ]);
  confere(
    pedidosRecuperar.length > 0 &&
      ![...pedidosVistos, ...pedidosRecuperar].some((u) =>
        formas.some((c) => decodeURIComponent(u).toUpperCase().includes(c)),
      ),
    "nenhum pedido levou um código de recuperação no endereço",
  );

  // B3b — a palavra-passe com o autenticador (docs/22 §9.2), no navegador
  // da recuperação (a Ana, com a sessão acabada de abrir).
  const { generate } = await import(
    join(API, "node_modules/otplib/dist/index.js")
  );
  const pedidosPalavraPasse = [];
  rp.on("request", (p) => {
    pedidosPalavraPasse.push(p.url());
  });
  const palavraDaAna = "uma frase bem comprida da Ana";
  await rp.goto(`${ORIGEM}/conta`);
  await rp
    .getByRole("heading", { name: "Palavra-passe e autenticador" })
    .waitFor();
  await rp.getByText("Estado: não activada.").waitFor();
  confere(true, "palavra-passe: o bloco aparece com a API a tê-la ligada");
  await rp
    .getByRole("button", { name: "Activar palavra-passe e autenticador" })
    .click();
  await rp.getByLabel("Palavra-passe (12 caracteres ou mais)").fill("curta");
  await rp.getByLabel("Repita a palavra-passe").fill("curta");
  await rp.getByRole("button", { name: "Continuar" }).click();
  await rp.getByText("entre 12 e 256 caracteres", { exact: false }).waitFor();
  await rp.getByLabel("Repita a palavra-passe").fill(`${palavraDaAna}!`);
  await rp
    .getByLabel("Palavra-passe (12 caracteres ou mais)")
    .fill(palavraDaAna);
  await rp.getByRole("button", { name: "Continuar" }).click();
  await rp.getByText("não são iguais", { exact: false }).waitFor();
  confere(
    true,
    "palavra-passe: curta ou diferente, o ecrã recusa antes da API",
  );
  await rp.getByLabel("Repita a palavra-passe").fill(palavraDaAna);
  const respostaSetup = rp
    .waitForResponse((r) => r.url().endsWith("/hub/password/setup"))
    .then((r) => r.json());
  await rp.getByRole("button", { name: "Continuar" }).click();
  await rp
    .getByRole("img", { name: "Código QR para a aplicação de autenticação" })
    .waitFor();
  confere(
    await rp.evaluate(() =>
      (document.activeElement?.textContent ?? "").startsWith(
        "Leia este código QR",
      ),
    ),
    "palavra-passe: depois de «Continuar», o foco vai para as instruções do código QR",
  );
  const segredoTotp = (
    (await rp.locator(".segredo").textContent()) ?? ""
  ).replaceAll(" ", "");
  // O código QR desenhado é exactamente o do URI que a API enviou, e o URI
  // leva o mesmo segredo do texto (revisão do #177, P2-3). Que o uqr gera um
  // código QR legível provou-se à parte, a descodificar a captura (OpenCV).
  const uriTotp = (await respostaSetup).uri;
  const { encode } = await import(join(HUB, "node_modules/uqr/dist/index.mjs"));
  const esperado = encode(uriTotp, { ecc: "M", border: 4 });
  const desenhado = new Set(
    [
      ...((await rp.locator("svg.qr path").getAttribute("d")) ?? "").matchAll(
        /M(\d+) (\d+)h1v1h-1z/g,
      ),
    ].map((m) => `${m[1]},${m[2]}`),
  );
  const escuros = esperado.data.flatMap((linha, y) =>
    linha.flatMap((escuro, x) => (escuro ? [`${String(x)},${String(y)}`] : [])),
  );
  confere(
    uriTotp.startsWith("otpauth://totp/") &&
      new URL(uriTotp).searchParams.get("secret") === segredoTotp &&
      escuros.length === desenhado.size &&
      escuros.every((m) => desenhado.has(m)) &&
      (await rp.locator("svg.qr").getAttribute("viewBox")) ===
        `0 0 ${String(esperado.size)} ${String(esperado.size)}`,
    "palavra-passe: o código QR desenhado é o do URI otpauth:// com o mesmo segredo",
  );
  confere(
    /^[A-Z2-7]{16,}$/.test(segredoTotp),
    "palavra-passe: o código QR e o segredo aparecem",
  );
  await rp.setViewportSize({ width: 375, height: 800 });
  await rp.screenshot({
    path: join(SAIDA, "palavra-passe-qr-375-claro.png"),
    fullPage: true,
  });
  await rp.emulateMedia({ colorScheme: "dark" });
  await rp.locator("svg.qr").screenshot({
    path: join(SAIDA, "palavra-passe-qr-escuro.png"),
  });
  await rp.emulateMedia({ colorScheme: "light" });
  await rp.getByLabel("Código de 6 dígitos da aplicação").fill("000000");
  await rp.getByRole("button", { name: "Confirmar e activar" }).click();
  await rp.getByText("O código não está certo", { exact: false }).waitFor();
  confere(true, "palavra-passe: um código errado é explicado");
  const agoraS = Math.floor(Date.now() / 1000);
  await rp
    .getByLabel("Código de 6 dígitos da aplicação")
    .fill(await generate({ secret: segredoTotp, epoch: agoraS }));
  await rp.getByRole("button", { name: "Confirmar e activar" }).click();
  await rp.getByText("ficaram activos", { exact: false }).waitFor();
  await rp.getByText("Estado: activa.").waitFor();
  confere(
    (await rp.locator(".segredo").count()) === 0 &&
      (await rp.getByRole("img", { name: /Código QR/ }).count()) === 0,
    "palavra-passe: activa; o código QR e o segredo saem do ecrã",
  );

  // Sair e entrar com e-mail, palavra-passe e o código seguinte.
  await rp.getByRole("button", { name: "Sair", exact: true }).click();
  await rp.getByRole("heading", { name: "Entrar no Hub" }).waitFor();
  await rp.getByRole("link", { name: "Entrar com palavra-passe" }).click();
  await rp.getByLabel("E-mail").fill("ana@exemplo.test");
  await rp
    .getByLabel("Palavra-passe", { exact: true })
    .fill("errada mas comprida");
  await rp
    .getByLabel("Código de 6 dígitos do autenticador")
    .fill(await generate({ secret: segredoTotp, epoch: agoraS + 30 }));
  await rp.getByRole("button", { name: "Entrar", exact: true }).click();
  await rp
    .getByText("O e-mail, a palavra-passe ou o código não estão certos.")
    .waitFor();
  confere(true, "entrar com palavra-passe: a errada é recusada");
  await rp.screenshot({
    path: join(SAIDA, "entrar-palavra-passe-375-claro.png"),
    fullPage: true,
  });
  await rp.getByLabel("Palavra-passe", { exact: true }).fill(palavraDaAna);
  await rp
    .getByLabel("Código de 6 dígitos do autenticador")
    .fill(await generate({ secret: segredoTotp, epoch: agoraS + 30 }));
  await rp.getByRole("button", { name: "Entrar", exact: true }).click();
  await rp.getByRole("heading", { name: "Início", exact: true }).waitFor();
  confere(true, "entrar com e-mail, palavra-passe e código");

  // Retirar: a Ana tem passkeys, por isso pode.
  await rp.goto(`${ORIGEM}/conta`);
  await rp.getByText("Estado: activa.").waitFor();
  rp.once("dialog", (d) => void d.accept());
  await rp.getByRole("button", { name: "Retirar a palavra-passe" }).click();
  await rp
    .getByText("A palavra-passe foi retirada.", { exact: false })
    .waitFor();
  await rp.getByText("Estado: não activada.").waitFor();
  confere(true, "palavra-passe: retirar");
  confere(
    !pedidosPalavraPasse.some(
      (u) =>
        u.includes(segredoTotp) || u.includes(encodeURIComponent(palavraDaAna)),
    ),
    "nenhum pedido levou o segredo do autenticador nem a palavra-passe no endereço",
  );

  // A gestão da equipa (docs/22 §10), com a Ana (dona).
  await rp.goto(equipa);
  // Procura-se a linha (papel ARIA row) pelo nome do membro.
  await rp.getByRole("row", { name: /Gil Teste/ }).waitFor();
  confere(
    (await rp.getByLabel("Papel de Ana Teste").count()) === 0 &&
      (await rp.getByRole("button", { name: "Sair desta equipa" }).count()) ===
        1,
    "equipa: a dona não muda o próprio papel; tem «Sair desta equipa»",
  );
  await rp.getByLabel("Papel de Ivo Teste").selectOption("armazem");
  rp.once("dialog", (d) => void d.accept());
  await rp.getByRole("button", { name: "Mudar: Ivo Teste" }).click();
  await rp.getByText("O papel de Ivo Teste passou a Armazém.").waitFor();
  confere(
    (await rp.getByLabel("Papel de Ivo Teste").inputValue()) === "armazem",
    "equipa: mudar o papel de um membro",
  );
  // A última dona não sai: o botão está desligado e o ecrã diz porquê
  // (revisão do #188, P3-4).
  confere(
    (await rp
      .getByRole("button", { name: "Sair desta equipa" })
      .isDisabled()) &&
      (await rp.getByText("É o último dono", { exact: false }).count()) === 1,
    "equipa: a última dona não sai, e o ecrã explica",
  );
  confere(
    (await rp.getByText("rita@exemplo.test").count()) === 1,
    "equipa: o convite que o Gil criou está em aberto antes de ele sair",
  );
  rp.once("dialog", (d) => void d.accept());
  await rp.getByRole("button", { name: "Tirar da equipa: Gil Teste" }).click();
  await rp.getByText("Gil Teste foi tirado da equipa.").waitFor();
  confere(
    (await rp.getByRole("row", { name: /Gil Teste/ }).count()) === 0,
    "equipa: tirar um membro da equipa",
  );
  // O que o texto de confirmação promete: o convite em aberto que o Gil
  // criou fica cancelado (revisão do #188, P2-5).
  confere(
    (await rp.getByText("rita@exemplo.test").count()) === 0,
    "equipa: ao tirar o Gil, o convite em aberto que ele criou é cancelado",
  );
  await rp.screenshot({
    path: join(SAIDA, "equipa-gestao-375-claro.png"),
    fullPage: true,
  });

  // O Gil, que já tem conta, aceita um convite novo com ela.
  const conviteDoGil = convidar("gil@exemplo.test", "apoio");
  const conviteDeOutro = convidar("eva2@exemplo.test", "apoio");
  const gil = await comPasskey();
  for (const credencial of credenciaisDoGil) {
    await gil.cdp.send("WebAuthn.addCredential", {
      authenticatorId: gil.autenticador,
      credential: credencial,
    });
  }
  await gil.pagina.goto(`${ORIGEM}/convite#${conviteDoGil}`);
  await gil.pagina.getByLabel("O seu nome").fill("Gil Teste");
  await gil.pagina
    .getByRole("button", { name: "Criar a conta com uma passkey" })
    .click();
  await gil.pagina
    .getByText("Este e-mail já tem conta.", { exact: false })
    .waitFor();
  await gil.pagina
    .getByRole("button", { name: "Entrar com passkey e aceitar" })
    .click();
  await gil.pagina
    .getByRole("heading", { name: "Início", exact: true })
    .waitFor();
  await gil.pagina.getByText("Loja de Ensaio").waitFor();
  confere(
    (await gil.pagina.getByText("Apoio", { exact: true }).count()) === 1,
    "convite: quem já tem conta entra e aceita (volta como Apoio)",
  );
  // Com a sessão do Gil, um convite para outro e-mail: recusa e sair ali.
  await gil.pagina.goto(`${ORIGEM}/convite#${conviteDeOutro}`);
  await gil.pagina
    .getByText("Entrou como Gil Teste", { exact: false })
    .waitFor();
  // O ecrã já sabe para que e-mail é e avisa (issue #194); aceitar fica
  // activo e quem recusa é a base (revisão do #196, P2-1).
  await gil.pagina
    .getByText(
      "Este convite é para eva2@exemplo.test e entrou como gil@exemplo.test.",
      { exact: false },
    )
    .waitFor();
  await gil.pagina
    .getByRole("button", { name: "Aceitar com esta conta" })
    .click();
  await gil.pagina
    .getByText("Este convite é para outro e-mail.", { exact: false })
    .waitFor();
  confere(true, "convite: para outro e-mail, o aviso antes e a recusa da base");
  await gil.pagina.getByRole("button", { name: "Sair", exact: true }).click();
  await gil.pagina.getByLabel("O seu nome").waitFor();
  confere(
    true,
    "convite: com a sessão de outra pessoa, recusa e sair ali mesmo",
  );
  await gil.contexto.close();

  // O catálogo no Hub (docs/22 §11): a lista de artigos, com a Ana.
  const pedidosArtigos = [];
  rp.on("request", (p) => {
    pedidosArtigos.push(p.url());
  });
  await rp.goto(`${ORIGEM}/`);
  await rp.getByRole("link", { name: "Artigos", exact: true }).click();
  await rp.getByText("30 artigos", { exact: true }).waitFor();
  confere(
    (await rp
      .getByRole("heading", { name: "Artigos — Loja de Ensaio" })
      .count()) === 1 && (await rp.getByRole("row").count()) === 26,
    "artigos: a contagem (30) e a primeira página (25 linhas)",
  );
  await rp.getByRole("button", { name: "Mostrar mais" }).click();
  await rp.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 30,
  );
  confere(
    (await rp.getByRole("button", { name: "Mostrar mais" }).count()) === 0,
    "artigos: «Mostrar mais» traz os 5 que faltavam e desaparece",
  );
  await rp.getByLabel("Nome", { exact: true }).fill("Azul");
  await rp.getByRole("button", { name: "Procurar" }).click();
  await rp.getByText("5 de 30 artigos", { exact: true }).waitFor();
  confere(true, "artigos: filtrar pelo nome diz «5 de 30 artigos»");
  await rp.getByLabel("Nome", { exact: true }).fill("");
  await rp.getByLabel("SKU", { exact: true }).fill("ens-007");
  await rp.getByRole("button", { name: "Procurar" }).click();
  await rp.getByText("1 de 30 artigos", { exact: true }).waitFor();
  confere(
    (await rp.getByRole("row", { name: /Verniz Azul 7\b/ }).count()) === 1,
    "artigos: o SKU de uma variante encontra o artigo (sem distinguir maiúsculas)",
  );
  await rp.getByLabel("SKU", { exact: true }).fill("");
  await rp.getByLabel("Estado", { exact: true }).selectOption("arquivado");
  await rp.getByRole("button", { name: "Procurar" }).click();
  await rp.getByText("Nenhum artigo com este filtro.").waitFor();
  await rp.screenshot({
    path: join(SAIDA, "artigos-sem-resultados-375-claro.png"),
    fullPage: true,
  });
  await rp.getByRole("button", { name: "Limpar o filtro" }).click();
  await rp.getByText("30 artigos", { exact: true }).waitFor();
  confere(true, "artigos: sem resultados, «Limpar o filtro» volta aos 30");
  // «Mostrar mais» que falha deixa as 25 linhas à vista (revisão do #201,
  // P3-4); «Tentar outra vez» traz as que faltavam.
  await rp.route("**/hub/products?*cursor=*", (r) =>
    r.fulfill({
      status: 429,
      contentType: "application/problem+json",
      headers: { "retry-after": "7" },
      body: JSON.stringify({ codigo: "rate_limit.exceeded", status: 429 }),
    }),
  );
  await rp.getByRole("button", { name: "Mostrar mais" }).click();
  await rp.getByText("Pedidos a mais", { exact: false }).waitFor();
  confere(
    (await rp.locator("tbody tr").count()) === 25,
    "artigos: «Mostrar mais» que falha não apaga as 25 linhas",
  );
  await rp.unroute("**/hub/products?*cursor=*");
  await rp.getByRole("button", { name: "Tentar outra vez" }).click();
  await rp.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 30,
  );
  confere(
    await rp.evaluate(
      () => document.activeElement?.getAttribute("role") === "status",
    ),
    "artigos: na última página, o foco vai para a contagem",
  );
  // As 30 linhas já estão à vista (o «Tentar outra vez» de cima).
  await rp
    .getByRole("row", { name: /Verniz Areia 30 \(vem do sistema de gestão\)/ })
    .waitFor();
  confere(true, "artigos: o que vem do sistema de gestão diz-o");
  // O estado vazio e o 403, com respostas fingidas da API (revisão do #201,
  // P3-10).
  await rp.route("**/hub/products?*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dados: [],
        total: 0,
        ha_mais: false,
        cursor_seguinte: null,
      }),
    }),
  );
  await rp.reload();
  await rp.getByText("Ainda não há artigos.", { exact: false }).waitFor();
  confere(
    (await rp.getByText("0 artigos", { exact: true }).count()) === 1 &&
      (await rp.locator("table").count()) === 0,
    "artigos: sem artigos, diz como entram e não mostra a tabela",
  );
  await rp.unroute("**/hub/products?*");
  await rp.route("**/hub/products?*", (r) =>
    r.fulfill({
      status: 403,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "auth.forbidden", status: 403 }),
    }),
  );
  await rp.reload();
  await rp.getByText("Não pode ver este comerciante.").waitFor();
  confere(
    (await rp.getByRole("button", { name: "Tentar outra vez" }).count()) === 0,
    "artigos: 403 diz «Não pode ver este comerciante», sem «Tentar outra vez»",
  );
  await rp.unroute("**/hub/products?*");
  confere(
    pedidosArtigos.some((u) => u.includes("/hub/products?")) &&
      !pedidosArtigos.some(
        (u) => /\/products\?/.test(u) && !u.includes("/hub/"),
      ),
    "artigos: o Hub pede pelo caminho /hub/products",
  );

  // A ficha do artigo (docs/22 §12), a partir da lista filtrada.
  const pedidosFicha = [];
  rp.on("request", (p) => {
    pedidosFicha.push(p.url());
  });
  await rp.reload();
  await rp.getByText("30 artigos", { exact: true }).waitFor();
  await rp.getByLabel("Nome", { exact: true }).fill("Azul");
  await rp.getByRole("button", { name: "Procurar" }).click();
  await rp.getByText("5 de 30 artigos", { exact: true }).waitFor();
  await rp.getByRole("link", { name: "Verniz Azul 1", exact: true }).click();
  await rp.getByRole("heading", { name: "Verniz Azul 1", level: 1 }).waitFor();
  // Os nomes do canal e do mercado, não os identificadores (docs/22 §18.2).
  await rp
    .getByRole("row", { name: /Loja online.*Portugal.*Rascunho/ })
    .waitFor();
  confere(
    (await rp.getByText(`chn_${canalDaFicha}`).count()) === 0 &&
      (await rp.getByText(`mkt_${mercadoDaFicha}`).count()) === 0,
    "ficha: as publicações mostram o nome do canal e do mercado, sem o identificador",
  );
  await rp.waitForFunction(
    () =>
      document.querySelectorAll(".imagens-artigo img").length === 2 &&
      [...document.querySelectorAll(".imagens-artigo img")].every(
        (i) => i.complete && i.naturalWidth === 64,
      ),
  );
  confere(
    new URL(rp.url()).searchParams.get("texto") === "Azul" &&
      (await rp
        .getByText("Verniz de secagem rápida.", { exact: false })
        .count()) === 1,
    "ficha: abre pelo nome na lista, com a descrição e os filtros no endereço",
  );
  confere(
    (await rp
      .getByRole("row", { name: /ENS-001\b.*Unidade.*15 ml.*60 g/ })
      .count()) === 1 &&
      (await rp
        .getByRole("row", { name: /ENS-001-B.*Caixa.*720 g/ })
        .count()) === 1,
    "ficha: as duas variantes, com a unidade, o conteúdo e o peso",
  );
  // As opções (docs/22 §20.2): uma coluna por opção, entre o SKU e o estado,
  // e a linha por cima com os valores todos, também o que nenhuma usa.
  await rp.getByText("Opções: Tamanho", { exact: false }).waitFor();
  const cabecalhoVariantes = await rp
    .locator(".variantes-artigo thead th")
    .allTextContents();
  confere(
    cabecalhoVariantes.slice(0, 4).join("|") ===
      "SKU|Tamanho|Acabamento|Estado" &&
      (await rp
        .getByText(
          "Opções: Tamanho (15 ml, 30 ml, Caixa de 12) · Acabamento (Brilhante)",
          { exact: true },
        )
        .count()) === 1 &&
      (await rp
        .getByRole("row", { name: /ENS-001\b.*15 ml.*Brilhante.*Activa/ })
        .count()) === 1 &&
      (await rp
        .getByRole("row", { name: /ENS-001-B.*Caixa de 12.*Brilhante.*Activa/ })
        .count()) === 1,
    "ficha: uma coluna por opção, com o valor de cada variante, e a linha com as opções e os valores todos",
  );
  // Os preços (docs/22 §17.3): uma caixa por lista, com o que o servidor deu.
  await rp.getByRole("heading", { name: "Base ES", level: 3 }).waitFor();
  const caixaPt = rp.locator(".lista-precos").nth(0);
  const caixaEs = rp.locator(".lista-precos").nth(1);
  const caixaB2b = rp.locator(".lista-precos").nth(2);
  const textoPt = (await caixaPt.textContent()) ?? "";
  const textoEs = (await caixaEs.textContent()) ?? "";
  const textoB2b = (await caixaB2b.textContent()) ?? "";
  confere(
    textoPt.includes("lista base · Portugal · EUR · preços com IVA") &&
      (await caixaPt
        .getByRole("row", {
          name: /ENS-001(?!-).*7,90\s€.*antes 9,90\s€ — o mais baixo dos 30 dias antes da redução · termina a .*\d{2}:\d{2}.*526,6667\s€\/l, com quatro casas/,
        })
        .count()) === 1 &&
      (await caixaPt
        .getByRole("row", { name: /ENS-001-B.*9,90\s€.*—/ })
        .count()) === 1,
    "preços: a lista base de Portugal com IVA, a redução com o preço de antes e o fim (com a hora), e o preço por unidade com quatro casas",
  );
  confere(
    textoEs.includes(
      "lista base · Espanha (mercado em rascunho) · EUR · preços sem IVA",
    ) &&
      (await caixaEs
        .getByRole("row", { name: /ENS-001(?!-).*Sem preço nesta lista/ })
        .count()) === 1 &&
      (await caixaEs
        .getByRole("row", { name: /ENS-001-B.*Gratuito/ })
        .count()) === 1,
    "preços: o mercado em rascunho sem IVA, a variante sem preço e a gratuita",
  );
  confere(
    textoB2b.includes("lista B2B · Portugal · EUR · preços com IVA") &&
      (await caixaB2b
        .getByRole("row", {
          name: /ENS-001(?!-).*9,00\s€.*mínimo 6 · múltiplos de 6/,
        })
        .count()) === 1 &&
      !textoB2b.includes("antes"),
    "preços: a lista B2B, com o mínimo e o múltiplo e sem a redução da lista base",
  );
  // «Mostrar mais listas» (respostas fingidas: a primeira página diz que há
  // mais; a segunda traz uma lista), com o foco no título da lista nova.
  await rp.route("**/hub/products/*/prices*", async (pedido) => {
    if (pedido.request().url().includes("cursor=")) {
      await pedido.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dados: [
            {
              lista: {
                id: "prl_00000000-0000-7000-8000-0000000000aa",
                mercado: "mkt_00000000-0000-7000-8000-0000000000bb",
                nome: "Lista seguinte",
                tipo: "base",
                etiqueta: null,
                prioridade: null,
                estado: "activa",
                versao: 1,
                criado_em: "2026-10-09T10:00:00Z",
              },
              mercado: {
                id: "mkt_00000000-0000-7000-8000-0000000000bb",
                nome: "França",
                estado: "activo",
                moeda: "EUR",
                preco_inclui_iva: true,
              },
              precos: [],
            },
          ],
          total: 4,
          ha_mais: false,
          cursor_seguinte: null,
        }),
      });
      return;
    }
    const real = await pedido.fetch();
    const corpo = await real.json();
    await pedido.fulfill({
      response: real,
      body: JSON.stringify({ ...corpo, ha_mais: true, cursor_seguinte: "eA" }),
    });
  });
  await rp.reload();
  await rp.getByRole("button", { name: "Mostrar mais listas" }).focus();
  await rp.keyboard.press("Enter");
  await rp.getByRole("heading", { name: "Lista seguinte", level: 3 }).waitFor();
  confere(
    (await rp.evaluate(() => document.activeElement?.id)) ===
      "precos-prl_00000000-0000-7000-8000-0000000000aa" &&
      (await rp.locator(".lista-precos").count()) === 4 &&
      (await rp
        .getByRole("button", { name: "Mostrar mais listas" })
        .count()) === 0,
    "preços: «Mostrar mais listas» traz a seguinte, com o foco no título dela",
  );
  await rp.unroute("**/hub/products/*/prices*");
  await rp.reload();
  await rp
    .getByRole("heading", { name: "Profissionais PT", level: 3 })
    .waitFor();
  for (const [largura, tema] of [
    [375, "light"],
    [768, "light"],
    [1280, "dark"],
  ]) {
    await rp.setViewportSize({ width: largura, height: 900 });
    await rp.emulateMedia({ colorScheme: tema });
    confere(
      !(await rp.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )),
      `preços: a ${String(largura)} px (${tema}) sem deslocação horizontal`,
    );
    await rp.locator(".precos-artigo").screenshot({
      path: join(
        SAIDA,
        `artigo-precos-${String(largura)}-${tema === "light" ? "claro" : "escuro"}.png`,
      ),
    });
  }
  await rp.setViewportSize({ width: 375, height: 800 });
  await rp.emulateMedia({ colorScheme: "light" });
  const imagensDaFicha = await rp.evaluate(() =>
    [...document.querySelectorAll(".imagens-artigo img")].map((i) => ({
      blob: i.src.startsWith("blob:"),
      alt: i.alt,
    })),
  );
  confere(
    imagensDaFicha.every((i) => i.blob) &&
      imagensDaFicha[0]?.alt === "Frasco de verniz azul, de frente" &&
      imagensDaFicha[1]?.alt === "" &&
      (await rp.getByText("Principal", { exact: true }).count()) === 1 &&
      (await rp
        .getByText("Sem texto alternativo — impede a publicação.")
        .count()) === 1,
    "ficha: as imagens por blob:, a principal marcada e a que não tem texto avisa",
  );
  confere(
    pedidosFicha.some((u) => /\/hub\/media\/med_[^/]+\/file$/.test(u)) &&
      !pedidosFicha.some(
        (u) => /\/(products|media)\//.test(u) && !u.includes("/hub/"),
      ),
    "ficha: o Hub pede tudo pelos caminhos /hub/",
  );
  await rp.screenshot({
    path: join(SAIDA, "artigo-ficha-375-claro.png"),
    fullPage: true,
  });
  // Cada parte falha sozinha: as imagens dão erro, as variantes ficam.
  await rp.route("**/hub/products/*/media?*", (r) =>
    r.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "internal", status: 500 }),
    }),
  );
  await rp.route("**/hub/products/*/publications", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dados: [
          {
            id: "pub_00000000-0000-4000-8000-000000000001",
            artigo: `prd_${artigoDaFicha}`,
            canal: "chn_00000000-0000-4000-8000-000000000002",
            mercado: "mkt_00000000-0000-4000-8000-000000000003",
            // Sem os nomes (não devia acontecer): fica o identificador.
            canal_nome: null,
            mercado_nome: null,
            loja_nome: null,
            estado: "arquivado",
            variantes_fora: [],
            ultima_verificacao: null,
            verificado_em: "2026-10-01T09:00:00Z",
            publicado_em: "2026-10-02T09:00:00Z",
            arquivado_em: "2026-10-05T09:00:00Z",
            motivo_arquivo: "verificacao_falhou",
            versao: 3,
          },
        ],
      }),
    }),
  );
  await rp.reload();
  await rp.getByRole("button", { name: "Tentar outra vez" }).waitFor();
  await rp
    .getByRole("row", { name: /Arquivado.*Deixou de cumprir as regras/ })
    .waitFor();
  confere(
    (await rp.getByRole("row", { name: /ENS-001-B.*Caixa/ }).count()) === 1 &&
      (await rp.locator(".imagens-artigo").count()) === 0 &&
      (await rp
        .getByText("chn_00000000-0000-4000-8000-000000000002")
        .count()) === 1,
    "ficha: as imagens falham sozinhas; a publicação arquivada diz o motivo e, sem o nome, o identificador do canal",
  );
  await rp.unroute("**/hub/products/*/media?*");
  await rp.unroute("**/hub/products/*/publications");
  await rp.getByRole("button", { name: "Tentar outra vez" }).click();
  await rp.waitForFunction(
    () => document.querySelectorAll(".imagens-artigo img").length === 2,
  );
  confere(true, "ficha: «Tentar outra vez» traz as imagens");
  // As opções falham sozinhas (docs/22 §20.2): a tabela fica como sem
  // elas, com o aviso e «Tentar outra vez» por cima. Com o seu endereço.
  await enderecoNovo(rp);
  await rp.route("**/hub/products/*/options?*", (r) =>
    r.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "internal", status: 500 }),
    }),
  );
  await rp.reload();
  await rp.getByText("Não foi possível ler as opções.").waitFor();
  confere(
    (await rp.locator(".variantes-artigo thead th").allTextContents())
      .slice(0, 2)
      .join("|") === "SKU|Estado" &&
      (await rp.getByText("Opções:", { exact: false }).count()) === 0 &&
      (await rp.getByRole("row", { name: /ENS-001-B.*Caixa/ }).count()) === 1 &&
      (await rp.getByRole("button", { name: "Tentar outra vez" }).count()) ===
        1,
    "ficha: as opções falham sozinhas: a tabela fica sem as colunas, com o aviso e «Tentar outra vez»",
  );
  await rp.unroute("**/hub/products/*/options?*");
  await rp.getByRole("button", { name: "Tentar outra vez" }).click();
  await rp.getByText("Opções: Tamanho", { exact: false }).waitFor();
  confere(
    (await rp.getByText("Não foi possível ler as opções.").count()) === 0 &&
      (await rp
        .getByRole("row", { name: /ENS-001-B.*Caixa de 12/ })
        .count()) === 1,
    "ficha: «Tentar outra vez» traz as opções",
  );
  // As capturas da tabela com as opções, para a página de aprovação.
  for (const [largura, tema] of [
    [375, "light"],
    [1280, "dark"],
  ]) {
    await rp.setViewportSize({ width: largura, height: 900 });
    await rp.emulateMedia({ colorScheme: tema });
    confere(
      !(await rp.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )),
      `opções: a ${String(largura)} px (${tema}) sem deslocação horizontal`,
    );
    const linha = await rp
      .getByText("Opções: Tamanho", { exact: false })
      .boundingBox();
    const tabela = await rp.locator(".variantes-artigo").boundingBox();
    if (linha !== null && tabela !== null) {
      const x = Math.min(linha.x, tabela.x);
      const y = linha.y;
      await rp.screenshot({
        path: join(
          SAIDA,
          `artigo-opcoes-${String(largura)}-${tema === "light" ? "claro" : "escuro"}.png`,
        ),
        fullPage: true,
        clip: {
          x,
          y,
          width: Math.max(linha.x + linha.width, tabela.x + tabela.width) - x,
          height: tabela.y + tabela.height - y,
        },
      });
    }
  }
  await rp.setViewportSize({ width: 375, height: 800 });
  await rp.emulateMedia({ colorScheme: "light" });
  // Com o seu endereço: estes recarregamentos somavam-se aos pedidos da
  // ficha no mesmo minuto (limite do Hub, issue #253; revisão do #275, P3-1).
  await enderecoNovo(rp);
  // Dois canais com o mesmo nome em lojas diferentes (docs/22 §19.2): a
  // loja por baixo do canal; os mercados, com nomes diferentes, só com o
  // nome (respostas fingidas da API).
  const publicacaoFingida = (n, mercado, loja) => ({
    id: `pub_00000000-0000-4000-8000-00000000001${n}`,
    artigo: `prd_${artigoDaFicha}`,
    canal: `chn_00000000-0000-4000-8000-00000000002${n}`,
    mercado: `mkt_00000000-0000-4000-8000-00000000003${n}`,
    canal_nome: "Loja online",
    mercado_nome: mercado,
    loja_nome: loja,
    estado: "publicado",
    variantes_fora: [],
    ultima_verificacao: null,
    verificado_em: "2026-10-01T09:00:00Z",
    publicado_em: "2026-10-02T09:00:00Z",
    arquivado_em: null,
    motivo_arquivo: null,
    versao: 2,
  });
  await rp.route("**/hub/products/*/publications", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dados: [
          publicacaoFingida(1, "Portugal", "Loja Norte"),
          publicacaoFingida(2, "Espanha", "Loja Sul"),
        ],
      }),
    }),
  );
  await rp.reload();
  await rp.getByRole("row", { name: /Loja Sul/ }).waitFor();
  const tabelaPublicacoes = rp.locator("table", {
    has: rp.getByRole("columnheader", { name: "Mercado" }),
  });
  confere(
    (await rp
      .getByRole("row", {
        name: /Loja online.*Loja Norte.*Portugal.*Publicado/,
      })
      .count()) === 1 &&
      (await rp
        .getByRole("row", { name: /Loja online.*Loja Sul.*Espanha.*Publicado/ })
        .count()) === 1 &&
      (await tabelaPublicacoes.getByText(/^(chn|mkt)_/).count()) === 0 &&
      (await tabelaPublicacoes
        .locator(".so-leitores", { hasText: "Loja:" })
        .count()) === 2,
    "ficha: dois canais com o mesmo nome mostram a loja por baixo (com «Loja:» para os leitores de ecrã); os mercados, diferentes, só o nome",
  );
  await tabelaPublicacoes.screenshot({
    path: join(SAIDA, "artigo-publicacoes-lojas-375-claro.png"),
  });
  await rp.unroute("**/hub/products/*/publications");
  await rp.reload();
  await rp
    .getByRole("row", { name: /Loja online.*Portugal.*Rascunho/ })
    .waitFor();
  // Os preços falham sozinhos (docs/22 §17.3): o erro na secção, o resto fica.
  await rp.route("**/hub/products/*/prices*", (r) =>
    r.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "internal", status: 500 }),
    }),
  );
  await rp.reload();
  const precosDaFicha = rp.locator(".precos-artigo");
  await precosDaFicha
    .getByRole("button", { name: "Tentar outra vez" })
    .waitFor();
  await rp.waitForFunction(
    () => document.querySelectorAll(".imagens-artigo img").length === 2,
  );
  confere(
    (await rp.getByRole("row", { name: /ENS-001-B.*Caixa/ }).count()) === 1 &&
      (await precosDaFicha.locator(".lista-precos").count()) === 0,
    "preços: falham sozinhos, com «Tentar outra vez»; as variantes e as imagens ficam",
  );
  await rp.unroute("**/hub/products/*/prices*");
  await precosDaFicha.getByRole("button", { name: "Tentar outra vez" }).focus();
  await rp.keyboard.press("Enter");
  await rp.getByRole("heading", { name: "Base PT", level: 3 }).waitFor();
  confere(true, "preços: «Tentar outra vez», com o teclado, traz as listas");
  // Uma imagem que falha sozinha tem o seu «Tentar outra vez» (revisão do
  // #206, P2-1).
  let falhar = true;
  await rp.route("**/hub/media/*/file", (r) =>
    falhar
      ? r.fulfill({
          status: 429,
          contentType: "application/problem+json",
          headers: { "retry-after": "5" },
          body: JSON.stringify({ codigo: "rate_limit.exceeded", status: 429 }),
        })
      : r.continue(),
  );
  await rp.reload();
  await rp.locator(".falha-imagem").nth(1).waitFor();
  confere(
    (await rp.locator(".falha-imagem").count()) === 2 &&
      (await rp
        .locator(".falha-imagem", { hasText: "Pedidos a mais" })
        .count()) === 2,
    "ficha: uma imagem que falha diz porquê, na moldura dela",
  );
  falhar = false;
  await rp
    .locator(".falha-imagem")
    .first()
    .getByRole("button", { name: "Tentar outra vez" })
    .click();
  await rp.waitForFunction(
    () => document.querySelectorAll(".imagens-artigo img").length === 1,
  );
  confere(
    (await rp.locator(".falha-imagem").count()) === 1,
    "ficha: «Tentar outra vez» numa imagem só traz essa",
  );
  await rp.unroute("**/hub/media/*/file");
  await rp.reload();
  await rp.waitForFunction(
    () =>
      [...document.querySelectorAll(".imagens-artigo img")].filter(
        (i) => i.complete && i.naturalWidth === 64,
      ).length === 2,
  );
  // Os endereços blob: apagam-se ao sair da ficha (docs/22 §12.1).
  const enderecosBlob = await rp.evaluate(() =>
    [...document.querySelectorAll(".imagens-artigo img")].map((i) => i.src),
  );
  await rp.getByRole("link", { name: "Voltar aos artigos" }).click();
  await rp.getByText("5 de 30 artigos", { exact: true }).waitFor();
  confere(
    (await rp.getByLabel("Nome", { exact: true }).inputValue()) === "Azul",
    "ficha: «Voltar aos artigos» volta à lista com o mesmo filtro",
  );
  const blobsVivos = await rp.evaluate(async (enderecos) => {
    let vivos = 0;
    for (const e of enderecos) {
      try {
        await fetch(e);
        vivos++;
      } catch {
        // apagado
      }
    }
    return vivos;
  }, enderecosBlob);
  confere(
    enderecosBlob.length === 2 && blobsVivos === 0,
    "ficha: ao sair, os endereços blob: das imagens já não existem",
  );
  // Um filtro no endereço que a API recusaria não fica preso num erro
  // (revisão do #206, P3-2).
  await rp.goto(`${ORIGEM}/artigos?comerciante=mer_${comerciante}&texto=a%01b`);
  await rp.getByText("30 artigos", { exact: true }).waitFor();
  confere(
    true,
    "artigos: um filtro com caracteres de controlo no endereço não conta",
  );
  await rp.goto(
    `${ORIGEM}/artigos/prd_${randomBytes(16)
      .toString("hex")
      .replace(
        /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
        "$1-$2-$3-$4-$5",
      )}?comerciante=mer_${comerciante}`,
  );
  await rp.getByText("Este artigo não existe neste comerciante.").waitFor();
  confere(
    (await rp.getByRole("button", { name: "Tentar outra vez" }).count()) === 0,
    "ficha: um artigo que não existe diz-o, sem «Tentar outra vez»",
  );
  await enderecoNovo(rp);
  // Editar o artigo (docs/22 §13), com a Ana (dona), no «Verniz Rosa 2».
  const fichaEditavel = `${ORIGEM}/artigos/prd_${artigoEditavel}?comerciante=mer_${comerciante}`;
  const opcoesSemNada = rp.waitForResponse((r) =>
    r.url().includes(`/hub/products/prd_${artigoEditavel}/options`),
  );
  await rp.goto(fichaEditavel);
  await rp.getByRole("heading", { name: "Verniz Rosa 2", level: 1 }).waitFor();
  // Um artigo sem opções (docs/22 §20.2): nem colunas nem a linha.
  await opcoesSemNada;
  await rp.locator(".variantes-artigo").waitFor();
  confere(
    (await rp.getByText("Opções:", { exact: false }).count()) === 0 &&
      (await rp.locator(".variantes-artigo thead th").allTextContents())
        .slice(0, 2)
        .join("|") === "SKU|Estado",
    "ficha: um artigo sem opções fica como antes, sem colunas nem a linha",
  );
  // Só com o teclado (docs/22 §13.5; revisão do #217, P2-6): «Editar» com
  // Enter, escrever, e Enter no nome grava.
  await rp.getByRole("link", { name: "Editar", exact: true }).focus();
  await rp.keyboard.press("Enter");
  await rp.getByRole("heading", { name: "Editar o artigo" }).waitFor();
  // O «voltar» do navegador com alterações por guardar pergunta; recusar
  // fica no formulário (P2-1).
  await rp
    .getByLabel("Descrição", { exact: true })
    .fill("Acabamento brilhante.");
  let perguntouAoVoltar = false;
  rp.once("dialog", (d) => {
    perguntouAoVoltar = true;
    void d.dismiss();
  });
  await rp.goBack();
  await rp.waitForTimeout(300);
  confere(
    perguntouAoVoltar &&
      (await rp.getByLabel("Descrição", { exact: true }).inputValue()) ===
        "Acabamento brilhante.",
    "edição: o «voltar» do navegador com alterações por guardar pergunta e, recusado, fica",
  );
  await rp.getByLabel("Nome", { exact: true }).focus();
  await rp.keyboard.press("Control+A");
  await rp.keyboard.type("Verniz Rosa 2 Brilho");
  await rp.keyboard.press("Enter");
  await rp
    .getByRole("heading", { name: "Verniz Rosa 2 Brilho", level: 1 })
    .waitFor();
  // O aviso recebe o foco quando a ficha chega (revisão do #217, P3-6).
  await rp.waitForFunction(
    () => document.activeElement?.textContent === "Alterações guardadas.",
  );
  confere(
    (await rp.getByText("Alterações guardadas.").count()) === 1 &&
      (await rp.getByText("Acabamento brilhante.").count()) === 1 &&
      !new URL(rp.url()).searchParams.has("guardado"),
    "edição: guardar o nome e a descrição volta à ficha com «Alterações guardadas» no foco",
  );
  // Um conflito: outra escrita (aqui, um fetch do mesmo navegador) muda o
  // artigo entre abrir o formulário e guardar.
  await rp.getByRole("link", { name: "Editar", exact: true }).click();
  await rp.getByLabel("Nome", { exact: true }).waitFor();
  const outraEscrita = await rp.evaluate(
    async ({ c, a }) => {
      const ficha = await (
        await fetch(`/hub/products/${a}`, {
          headers: { "eurolify-comerciante": c },
        })
      ).json();
      const r = await fetch(`/hub/products/${a}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "eurolify-comerciante": c,
        },
        body: JSON.stringify({ versao: ficha.versao, marca: "Outra Marca" }),
      });
      return r.status;
    },
    { c: `mer_${comerciante}`, a: `prd_${artigoEditavel}` },
  );
  await rp.getByLabel("Nome", { exact: true }).fill("Verniz Rosa 2 Mate");
  await rp.getByRole("button", { name: "Guardar" }).click();
  await rp
    .getByText("Outra pessoa alterou este artigo entretanto.", { exact: false })
    .waitFor();
  confere(
    outraEscrita === 200 &&
      (await rp.getByLabel("Nome", { exact: true }).inputValue()) ===
        "Verniz Rosa 2 Mate" &&
      (await rp.getByText("Outra Marca", { exact: true }).count()) === 1,
    "edição: um conflito não grava, mostra o que está guardado e deixa o que se escreveu",
  );
  await rp.screenshot({
    path: join(SAIDA, "artigo-editar-conflito-375-claro.png"),
    fullPage: true,
  });
  // Cancelar com alterações por guardar pergunta antes.
  let perguntou = false;
  rp.once("dialog", (d) => {
    perguntou = true;
    void d.accept();
  });
  await rp.getByRole("button", { name: "Cancelar" }).click();
  await rp
    .getByRole("heading", { name: "Verniz Rosa 2 Brilho", level: 1 })
    .waitFor();
  confere(
    perguntou,
    "edição: cancelar com alterações por guardar pergunta antes",
  );
  // O estado: activar, arquivar (com confirmação) e repor.
  await rp.getByRole("button", { name: "Activar" }).click();
  await rp.getByRole("button", { name: "Arquivar", exact: true }).waitFor();
  let confirmouArquivo = false;
  rp.once("dialog", (d) => {
    confirmouArquivo = d.message().includes("tira-o de venda");
    void d.accept();
  });
  await rp.getByRole("button", { name: "Arquivar", exact: true }).click();
  await rp.getByRole("button", { name: "Repor" }).waitFor();
  await rp.getByRole("button", { name: "Repor" }).click();
  await rp.getByRole("button", { name: "Arquivar", exact: true }).waitFor();
  confere(
    confirmouArquivo &&
      (await rp.locator(".estado-artigo", { hasText: "Activo" }).count()) === 1,
    "edição: activar, arquivar com confirmação e repor",
  );
  // As imagens: o texto alternativo que faltava, a principal e a ordem.
  await rp.waitForFunction(
    () =>
      [...document.querySelectorAll(".imagens-artigo img")].filter(
        (i) => i.complete && i.naturalWidth === 64,
      ).length === 2,
  );
  const imagensEditaveis = rp.locator(".imagens-artigo > li");
  await imagensEditaveis
    .nth(1)
    .getByRole("button", { name: "Editar texto alternativo" })
    .click();
  await imagensEditaveis
    .nth(1)
    .getByLabel("Texto alternativo")
    .fill("Frasco de verniz laranja");
  await imagensEditaveis
    .nth(1)
    .getByRole("button", { name: "Guardar" })
    .click();
  await rp.getByText("Frasco de verniz laranja").waitFor();
  confere(
    (await rp
      .getByText("Sem texto alternativo — impede a publicação.")
      .count()) === 1,
    "edição: o texto alternativo que faltava grava-se e o aviso sai dessa imagem",
  );
  await imagensEditaveis
    .nth(1)
    .getByRole("button", { name: "Tornar principal" })
    .click();
  await rp.waitForFunction(
    () =>
      document
        .querySelectorAll(".imagens-artigo > li")[1]
        ?.textContent?.includes("Principal") === true,
  );
  // Mover com o teclado: o foco fica no aviso, não se perde (P2-2).
  await imagensEditaveis
    .nth(0)
    .getByRole("button", { name: "Mover para depois" })
    .focus();
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () =>
      document
        .querySelectorAll(".imagens-artigo > li")[0]
        ?.textContent?.includes("Frasco de verniz laranja") === true,
  );
  await rp.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "status",
  );
  confere(
    (await rp.locator(".imagens-artigo img").count()) === 2,
    "edição: tornar principal e mudar a ordem; o foco vai para «Alterações guardadas»",
  );
  // Uma lista pedida antes de outra gravação chega depois dela: não pode
  // repor o que já mudou (issue #251). A primeira releitura da lista fica
  // retida até a releitura da segunda gravação estar no ecrã (revisão do
  // #260, P2-1: sem depender de tempos).
  let listasAtrasadas = 0;
  let soltarLista = () => undefined;
  const listaSolta = new Promise((ok) => {
    soltarLista = ok;
  });
  await rp.route("**/hub/products/*/media?*", async (r) => {
    if (r.request().method() !== "GET" || listasAtrasadas > 0) {
      await r.fallback();
      return;
    }
    listasAtrasadas++;
    // A API responde já; a resposta é que chega atrasada, como numa rede
    // lenta (no máximo 15 s, para a passagem nunca ficar presa).
    const resposta = await r.fetch();
    await Promise.race([
      listaSolta,
      new Promise((ok) => setTimeout(ok, 15_000)),
    ]);
    await r.fulfill({ response: resposta });
  });
  const guardarTexto = async (indice, texto) => {
    const li = imagensEditaveis.nth(indice);
    await li.getByRole("button", { name: "Editar texto alternativo" }).click();
    await li.getByLabel("Texto alternativo").fill(texto);
    await li.getByRole("button", { name: "Guardar" }).click();
    await li
      .getByRole("button", { name: "Editar texto alternativo" })
      .waitFor();
  };
  await guardarTexto(1, "Frasco de verniz, de lado");
  await guardarTexto(0, "Frasco de verniz laranja, de frente");
  await rp.getByText("Frasco de verniz laranja, de frente").waitFor();
  // O texto novo no ecrã veio da segunda releitura; agora chega a primeira.
  const listaAntiga = rp.waitForResponse(
    (r) => /\/hub\/products\/[^/]+\/media\?/.test(r.url()),
    { timeout: 15_000 },
  );
  soltarLista();
  await listaAntiga;
  await rp.waitForTimeout(300);
  await rp.unroute("**/hub/products/*/media?*");
  confere(
    listasAtrasadas === 1 &&
      (await rp.getByText("Frasco de verniz laranja, de frente").count()) ===
        1 &&
      (await rp.getByText("Frasco de verniz, de lado").count()) === 1,
    "edição: uma lista antiga que chega depois não repõe o texto já gravado",
  );
  // Uma acção que falha com o teclado: o foco vai para o erro, não se perde
  // no início da página (issue #251).
  await rp.route(
    "**/hub/media/*",
    (r) =>
      r.request().method() === "PATCH"
        ? r.fulfill({
            status: 500,
            contentType: "application/problem+json",
            body: JSON.stringify({ codigo: "internal.error", status: 500 }),
          })
        : r.fallback(),
    { times: 1 },
  );
  await imagensEditaveis
    .nth(0)
    .getByRole("button", { name: "Mover para depois" })
    .focus();
  await rp.keyboard.press("Enter");
  await rp.locator(".erro[role=alert]").first().waitFor();
  const focoNoErro = await rp
    .waitForFunction(
      // O próprio elemento com o foco, nunca o <body> (revisão do #260,
      // P1-1: o body também contém o erro).
      () => document.activeElement?.matches(".falha-accao") === true,
      undefined,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  confere(
    focoNoErro,
    `edição: mover falha e o foco vai para o erro (foco em: ${await rp.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "nada")})`,
  );
  // Com uma margem, para o anel de foco (que fica por fora) aparecer.
  const caixaFalha = await rp.locator(".falha-accao").boundingBox();
  if (caixaFalha !== null) {
    await rp.screenshot({
      path: join(SAIDA, "artigo-falha-com-foco.png"),
      clip: {
        x: Math.max(caixaFalha.x - 16, 0),
        y: Math.max(caixaFalha.y - 16, 0),
        width: caixaFalha.width + 32,
        height: caixaFalha.height + 32,
      },
    });
  }
  // Arquivar a única variante: a confirmação diz que é a última.
  let ultima = false;
  rp.once("dialog", (d) => {
    ultima = d.message().includes("última variante activa");
    void d.accept();
  });
  await rp.getByRole("button", { name: "Arquivar variante ENS-002" }).click();
  await rp
    .locator(".variantes-artigo")
    .getByRole("row", { name: /ENS-002.*Arquivada/ })
    .waitFor();
  confere(ultima, "edição: arquivar a última variante avisa e fica Arquivada");
  // Sem variante activa, repor diz o motivo da API (P2-5).
  rp.once("dialog", (d) => void d.accept());
  await rp.getByRole("button", { name: "Arquivar", exact: true }).click();
  await rp.getByRole("button", { name: "Repor" }).click();
  await rp
    .getByText("precisa de pelo menos uma variante activa", { exact: false })
    .waitFor();
  confere(true, "edição: repor sem variante activa diz porquê");
  // Um artigo do sistema de gestão (P5): sem «Editar» nem estado; o aviso.
  await rp.goto(
    `${ORIGEM}/artigos/prd_${artigoExterno}?comerciante=mer_${comerciante}`,
  );
  await rp
    .getByText("Este artigo vem do sistema de gestão:", { exact: false })
    .waitFor();
  confere(
    (await rp.getByRole("link", { name: "Editar", exact: true }).count()) ===
      0 &&
      (await rp.getByRole("button", { name: /Activar|Arquivar/ }).count()) ===
        0,
    "edição: num artigo do sistema de gestão, sem «Editar» nem estado, com o aviso",
  );

  // Criar um artigo (docs/22 §14; issue #221), só com o teclado: «Criar
  // artigo» na lista, o formulário com as recusas dele e as da API, e a
  // ficha nova com o aviso no foco.
  // Escrever e escolher só com o teclado (revisão do #223, P3-1): o foco
  // no campo e as teclas; numa lista, as primeiras letras da opção.
  const escrever = async (campo, texto) => {
    await campo.focus();
    await rp.keyboard.press("Control+A");
    await rp.keyboard.type(texto);
  };
  const escolher = async (lista, letras) => {
    await lista.focus();
    await rp.keyboard.type(letras);
  };
  await rp.goto(`${ORIGEM}/artigos?comerciante=mer_${comerciante}`);
  await rp.getByRole("link", { name: "Criar artigo" }).focus();
  await rp.keyboard.press("Enter");
  await rp.getByRole("heading", { name: "Criar artigo", level: 1 }).waitFor();
  await rp.getByLabel("Nome", { exact: true }).focus();
  await rp.keyboard.type("Verniz Verde 31");
  await rp.getByLabel("SKU", { exact: true }).focus();
  await rp.keyboard.type("ENS-031");
  await rp.getByRole("button", { name: "Acrescentar outra variante" }).focus();
  await rp.keyboard.press("Enter");
  await rp.getByRole("group", { name: "Variante 2" }).waitFor();
  confere(
    await rp.evaluate(
      () => document.activeElement?.id.endsWith("-sku") === true,
    ),
    "criar: «Acrescentar outra variante» põe o foco no SKU da nova",
  );
  await rp.keyboard.type("ens-031");
  await rp.getByRole("button", { name: "Criar artigo" }).focus();
  await rp.keyboard.press("Enter");
  await rp
    .getByText("Este SKU está repetido neste formulário.")
    .first()
    .waitFor();
  confere(
    (await rp.getByText("Este SKU está repetido neste formulário.").count()) ===
      2,
    "criar: o SKU repetido no formulário (sem distinguir maiúsculas) diz-se nos dois campos, sem pedir à API",
  );
  const variante2 = rp.getByRole("group", { name: "Variante 2" });
  await escrever(variante2.getByLabel("SKU", { exact: true }), "ENS-002");
  const v1 = rp.getByRole("group", { name: "Variante 1" });
  await escrever(v1.getByLabel("GTIN", { exact: true }), "5601234567892");
  await escrever(v1.getByLabel("Quantidade do conteúdo"), "15");
  await escrever(v1.getByLabel("Peso (g)"), "6,5");
  await rp.getByRole("button", { name: "Criar artigo" }).focus();
  await rp.keyboard.press("Enter");
  await v1.getByText("Escolha a origem do GTIN.").waitFor();
  confere(
    (await v1
      .getByText("Escreva a quantidade e a unidade do conteúdo, ou nenhuma.")
      .count()) === 1 &&
      (await v1.getByText("Um número inteiro, sem casas decimais.").count()) ===
        1 &&
      (await rp.evaluate(
        () => document.activeElement?.getAttribute("aria-invalid") === "true",
      )),
    "criar: GTIN sem origem, conteúdo incompleto e peso com casas decimais, ao lado de cada campo, com o foco no primeiro",
  );
  confere(
    (await v1
      .getByLabel("Unidade do conteúdo")
      .getAttribute("aria-invalid")) === "true",
    "criar: falta a unidade do conteúdo: o erro fica na lista da unidade (revisão do #223, P3-5)",
  );
  await escolher(v1.getByLabel("Origem do GTIN"), "Do f");
  await escolher(v1.getByLabel("Unidade do conteúdo"), "ml");
  await escrever(v1.getByLabel("Peso (g)"), "60");
  confere(
    (await v1.getByText("Um número inteiro, sem casas decimais.").count()) ===
      0 &&
      (await v1.getByLabel("Origem do GTIN").inputValue()) === "fornecedor" &&
      (await v1.getByLabel("Unidade do conteúdo").inputValue()) === "ml",
    "criar: um campo corrigido deixa de mostrar o erro; as listas escolhem-se com o teclado",
  );
  await rp.getByRole("button", { name: "Criar artigo" }).focus();
  await rp.keyboard.press("Enter");
  await variante2
    .getByText("Este SKU já existe neste comerciante", { exact: false })
    .waitFor();
  confere(
    (await v1
      .getByText("Este SKU já existe neste comerciante", { exact: false })
      .count()) === 0,
    "criar: o SKU que já existe (409 da API) marca só o campo dele",
  );
  await rp.screenshot({
    path: join(SAIDA, "artigo-novo-erros-375-claro.png"),
    fullPage: true,
  });
  await escrever(variante2.getByLabel("SKU", { exact: true }), "ENS-031-B");
  await escolher(variante2.getByLabel("Unidade de venda"), "Cai");
  await rp.getByLabel("Nome", { exact: true }).focus();
  await rp.keyboard.press("Enter");
  await rp
    .getByRole("heading", { name: "Verniz Verde 31", level: 1 })
    .waitFor();
  await rp.waitForFunction(
    () =>
      document.activeElement?.getAttribute("role") === "status" &&
      document.activeElement.textContent === "Artigo criado em rascunho.",
  );
  confere(
    (await rp.getByText("Rascunho", { exact: true }).count()) >= 1 &&
      (await rp
        .getByRole("row", {
          name: /ENS-031\b.*Unidade.*5601234567892.*15 ml.*60 g/,
        })
        .count()) === 1 &&
      (await rp.getByRole("row", { name: /ENS-031-B.*Caixa/ }).count()) === 1 &&
      !new URL(rp.url()).search.includes("criado"),
    "criar: o artigo abre em rascunho, com as duas variantes e «Artigo criado em rascunho.» no foco",
  );
  const fichaVerde31 = rp.url();
  await rp.goBack();
  await rp.getByRole("heading", { name: /^Artigos/ }).waitFor();
  confere(
    new URL(rp.url()).pathname === "/artigos",
    "criar: o «voltar» depois de criar vai para a lista, não para o formulário",
  );
  // A resposta perde-se: o pedido gravou e o nginx deu 502, sem o corpo da
  // API (§14.2; revisão do #223, P2-1).
  await rp.route("**/hub/products", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    await r.fetch();
    await r.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html>502 Bad Gateway</html>",
    });
  });
  await rp.goto(`${ORIGEM}/artigos/novo?comerciante=mer_${comerciante}`);
  await rp.getByLabel("Nome", { exact: true }).fill("Verniz Verde 32");
  await rp.getByLabel("SKU", { exact: true }).fill("ENS-032");
  await rp.getByRole("button", { name: "Criar artigo" }).click();
  await rp
    .getByRole("heading", { name: "Verniz Verde 32", level: 1 })
    .waitFor();
  await rp.getByText("O artigo já tinha sido criado.").waitFor();
  confere(
    true,
    "criar: um 502 depois de gravar encontra o artigo criado e abre-o",
  );
  await rp.unroute("**/hub/products");
  // A ligação falha antes de gravar: diz que não encontrou o artigo, e
  // tentar outra vez cria-o.
  await rp.route("**/hub/products", (r) =>
    r.request().method() === "POST" ? r.abort("failed") : r.fallback(),
  );
  await rp.goto(`${ORIGEM}/artigos/novo?comerciante=mer_${comerciante}`);
  await rp.getByLabel("Nome", { exact: true }).fill("Verniz Verde 33");
  await rp.getByLabel("SKU", { exact: true }).fill("ENS-033");
  await rp.getByRole("button", { name: "Criar artigo" }).click();
  await rp
    .getByText("A ligação falhou e não encontrámos o artigo.", {
      exact: false,
    })
    .waitFor();
  confere(
    (await rp.getByLabel("SKU", { exact: true }).inputValue()) === "ENS-033",
    "criar: a ligação que falha antes de gravar diz-o e deixa o formulário",
  );
  await rp.unroute("**/hub/products");
  await rp.getByRole("button", { name: "Criar artigo" }).click();
  await rp
    .getByRole("heading", { name: "Verniz Verde 33", level: 1 })
    .waitFor();
  confere(true, "criar: depois da ligação falhada, tentar outra vez cria");
  // O GTIN que a API recusa (422) vai para o campo dele; o limite das 20
  // variantes; retirar uma variante com o teclado (revisão do #223, P3-1).
  await rp.goto(`${ORIGEM}/artigos/novo?comerciante=mer_${comerciante}`);
  await escrever(rp.getByLabel("Nome", { exact: true }), "Verniz Verde 34");
  await escrever(rp.getByLabel("SKU", { exact: true }), "ENS-034");
  await escrever(rp.getByLabel("GTIN", { exact: true }), "5601234567897");
  await escolher(rp.getByLabel("Origem do GTIN"), "Int");
  await rp.getByRole("button", { name: "Criar artigo" }).focus();
  await rp.keyboard.press("Enter");
  await rp.getByText("O GTIN não é válido", { exact: false }).waitFor();
  confere(
    (await rp.evaluate(
      () => document.activeElement?.getAttribute("aria-invalid") === "true",
    )) &&
      (await rp
        .getByLabel("GTIN", { exact: true })
        .getAttribute("aria-invalid")) === "true",
    "criar: o GTIN que a API recusa (422) fica ao lado do campo, com o foco",
  );
  for (let n = 2; n <= 20; n++) {
    await rp
      .getByRole("button", { name: "Acrescentar outra variante" })
      .click();
    await rp.getByRole("group", { name: `Variante ${String(n)}` }).waitFor();
  }
  confere(
    (await rp
      .getByRole("button", { name: "Acrescentar outra variante" })
      .count()) === 0 &&
      (await rp
        .getByText("No máximo 20 variantes aqui; mais pela importação.")
        .count()) === 1,
    "criar: com 20 variantes, o botão sai e a frase diz porquê",
  );
  await rp.getByRole("button", { name: "Retirar a variante 20" }).focus();
  await rp.keyboard.press("Enter");
  await rp
    .getByRole("button", { name: "Acrescentar outra variante" })
    .waitFor();
  confere(
    (await rp.getByRole("group", { name: "Variante 20" }).count()) === 0 &&
      (await rp.evaluate(() => {
        const a = document.activeElement;
        return (
          a?.id.endsWith("-sku") === true &&
          a.closest("fieldset")?.querySelector("legend")?.textContent ===
            "Variante 19"
        );
      })),
    "criar: retirar a variante 20 com o teclado põe o foco no SKU da 19",
  );
  // Cancelar com alguma coisa escrita pergunta antes.
  let perguntouCriar = false;
  rp.once("dialog", (d) => {
    perguntouCriar = true;
    void d.dismiss();
  });
  await rp.getByRole("button", { name: "Cancelar" }).click();
  confere(
    perguntouCriar &&
      (await rp
        .getByRole("heading", { name: "Criar artigo", level: 1 })
        .count()) === 1,
    "criar: cancelar com alguma coisa escrita pergunta antes",
  );
  // A lista sem artigos (resposta fingida): a frase e o botão.
  await rp.route("**/hub/products?*", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            dados: [],
            total: 0,
            ha_mais: false,
            cursor_seguinte: null,
          }),
        })
      : r.fallback(),
  );
  rp.once("dialog", (d) => void d.accept());
  await rp.goto(`${ORIGEM}/artigos?comerciante=mer_${comerciante}`);
  await rp.getByText("Ainda não há artigos.", { exact: true }).waitFor();
  confere(
    (await rp.getByRole("link", { name: "Criar artigo" }).count()) === 1,
    "criar: a lista vazia diz «Ainda não há artigos.» com «Criar artigo»",
  );
  await rp.unroute("**/hub/products?*");

  await enderecoNovo(rp);
  // Enviar imagens (docs/22 §15; issue #229), no «Verniz Verde 31», que não
  // tem nenhuma: só com o teclado; as recusas antes de enviar (o tamanho e o
  // tipo), a da API, o 429, a resposta perdida ao ligar e tirar.
  const comGps = resolve(HUB, "..", "api", "test", "imagens", "com-gps.jpg");
  let enviosFeitos = 0;
  const contarEnvios = (q) => {
    if (q.method() === "POST" && q.url().endsWith("/hub/media/uploads")) {
      enviosFeitos += 1;
    }
  };
  rp.on("request", contarEnvios);
  await rp.goto(fichaVerde31);
  await rp
    .getByRole("heading", { name: "Verniz Verde 31", level: 1 })
    .waitFor();
  await rp.getByText("Sem imagens", { exact: false }).waitFor();
  const escolherFicheiro = async (ficheiro) => {
    const escolha = rp.waitForEvent("filechooser");
    await rp.getByRole("button", { name: "Acrescentar imagem" }).focus();
    await rp.keyboard.press("Enter");
    await (await escolha).setFiles(ficheiro);
  };
  await escolherFicheiro({
    name: "grande.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(11 * 1024 * 1024),
  });
  await rp.getByText("A imagem passa de 10 MB.").waitFor();
  await escolherFicheiro({
    name: "nota.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("não é uma imagem"),
  });
  await rp.getByText("Só se aceitam imagens JPEG, PNG ou WebP.").waitFor();
  confere(
    enviosFeitos === 0 &&
      (await rp.evaluate(() => document.activeElement?.id)) ===
        "nova-imagem-recusa",
    "imagens: o tamanho e o tipo recusam-se antes de enviar, com o foco no motivo",
  );
  // Um ficheiro com o tipo certo mas que não é uma imagem: recusa da API.
  await escolherFicheiro({
    name: "falso.png",
    mimeType: "image/png",
    buffer: Buffer.from("isto não é um png"),
  });
  confere(
    await rp
      .waitForFunction(
        () => document.activeElement?.id === "nova-imagem-texto",
        undefined,
        { timeout: 5_000 },
      )
      .then(
        () => true,
        () => false,
      ),
    "imagens: escolhido o ficheiro, o foco vai para o texto alternativo",
  );
  await rp.keyboard.press("Enter");
  await rp
    .getByText("Escreva o texto alternativo, ou marque que guarda sem ele.")
    .waitFor();
  await rp.keyboard.type("Ficheiro estragado");
  await rp.keyboard.press("Enter");
  await rp
    .getByText("que se consiga ler até ao fim", { exact: false })
    .waitFor();
  confere(
    enviosFeitos === 1,
    "imagens: sem texto alternativo pede-o; um ficheiro que não é imagem é recusado pela API",
  );
  await rp.getByRole("button", { name: "Cancelar" }).focus();
  await rp.keyboard.press("Enter");
  // Um PNG gravado com o nome .jpg: o Hub manda o tipo verdadeiro e a API
  // aceita (revisão do #235, P3-2). Num artigo à venda (publicações
  // fingidas), guardar sem texto pergunta antes (P2-1); recusado, nada vai.
  await rp.route("**/hub/products/*/publications", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dados: [
          {
            id: "pub_00000000-0000-7000-8000-000000000001",
            canal: "chn_00000000-0000-7000-8000-000000000001",
            mercado: "mkt_00000000-0000-7000-8000-000000000001",
            canal_nome: "Loja online",
            mercado_nome: "Portugal",
            loja_nome: "Loja online",
            estado: "publicado",
            verificado_em: null,
            publicado_em: "2026-10-09T10:00:00Z",
            arquivado_em: null,
            motivo_arquivo: null,
          },
        ],
      }),
    }),
  );
  await rp.reload();
  await rp.getByRole("button", { name: "Acrescentar imagem" }).waitFor();
  const pngComoJpg = {
    name: "foto-descarregada.jpg",
    mimeType: "image/jpeg",
    buffer: readFileSync(
      resolve(HUB, "..", "api", "test", "imagens", "com-texto.png"),
    ),
  };
  await escolherFicheiro(pngComoJpg);
  await rp
    .getByLabel("Guardar sem texto alternativo", { exact: false })
    .focus();
  await rp.keyboard.press("Space");
  let perguntouSemTexto = false;
  rp.once("dialog", (d) => {
    perguntouSemTexto = d.message().includes("tira o artigo de venda");
    void d.dismiss();
  });
  const enviosAntes = enviosFeitos;
  await rp.getByRole("button", { name: "Guardar" }).focus();
  await rp.keyboard.press("Enter");
  await rp.waitForTimeout(300);
  confere(
    perguntouSemTexto && enviosFeitos === enviosAntes,
    "imagens: num artigo à venda, guardar sem texto pergunta antes; recusado, nada se envia",
  );
  await rp
    .getByLabel("Guardar sem texto alternativo", { exact: false })
    .focus();
  await rp.keyboard.press("Space");
  await rp.getByLabel("Texto alternativo", { exact: true }).focus();
  await rp.keyboard.type("Etiqueta do verniz");
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () => document.activeElement?.textContent === "Imagem acrescentada.",
  );
  await rp.unroute("**/hub/products/*/publications");
  await rp.locator(".imagens-artigo > li").first().waitFor();
  confere(
    await rp
      .getByRole("img", { name: "Etiqueta do verniz" })
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      ),
    "imagens: um PNG com o nome .jpg vai como PNG e entra",
  );
  // Tira-se, para o resto da passagem começar sem imagens.
  rp.once("dialog", (d) => void d.accept());
  await rp.getByRole("button", { name: "Tirar a imagem" }).click();
  await rp.waitForFunction(
    () => document.activeElement?.textContent === "Imagem tirada do artigo.",
  );
  await rp.getByText("Sem imagens", { exact: false }).waitFor();
  // Outros envios a decorrer (resposta fingida da API).
  await rp.route("**/hub/media/uploads", (r) =>
    r.fulfill({
      status: 429,
      contentType: "application/problem+json",
      headers: { "retry-after": "1" },
      body: JSON.stringify({ codigo: "rate_limit.exceeded", status: 429 }),
    }),
  );
  await escolherFicheiro(comGps);
  await rp.keyboard.type("Frasco de verniz verde, de frente");
  await rp.keyboard.press("Enter");
  await rp
    .getByText("Há demasiados envios ao mesmo tempo", { exact: false })
    .waitFor();
  confere(true, "imagens: o 429 diz que há demasiados envios ao mesmo tempo");
  await rp.unroute("**/hub/media/uploads");
  // A ligação grava mas a resposta perde-se: o ecrã relê e dá-a por feita.
  await rp.route("**/hub/products/*/media", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    await r.fetch();
    await r.abort("failed");
  });
  await rp.getByRole("button", { name: "Guardar" }).focus();
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () => document.activeElement?.textContent === "Imagem acrescentada.",
  );
  await rp.unroute("**/hub/products/*/media");
  await rp.locator(".imagens-artigo > li").first().waitFor();
  // A miniatura pede os bytes depois de a linha aparecer («A carregar…»):
  // contar logo falhava às vezes (issue #246). Espera-se pela imagem; se não
  // vier em 10 s, a contagem abaixo falha e diz porquê (revisão do #247).
  const semImagem = await rp
    .getByRole("img", { name: "Frasco de verniz verde, de frente" })
    .waitFor({ timeout: 10_000 })
    .then(
      () => "",
      (e) => ` (a imagem não apareceu: ${String(e).split("\n")[0]})`,
    );
  confere(
    (await rp.locator(".imagens-artigo > li").count()) === 1 &&
      (await rp.getByText("Principal", { exact: true }).count()) === 1 &&
      (await rp
        .getByRole("img", { name: "Frasco de verniz verde, de frente" })
        .count()) === 1,
    `imagens: só com o teclado, a imagem fica principal com o texto; a resposta perdida ao ligar não a duplica${semImagem}`,
  );
  // Uma segunda imagem, e a captura do formulário aberto.
  await escolherFicheiro(comGps);
  await rp.keyboard.type("Frasco de verniz verde, de lado");
  await rp.screenshot({
    path: join(SAIDA, "artigo-imagem-nova-375-claro.png"),
    fullPage: true,
  });
  // O mesmo formulário no computador e no tema escuro (revisão do #235,
  // P3-8), sem deslocação horizontal.
  const tamanhoAntes = rp.viewportSize();
  for (const [largura, tema] of [
    [768, "light"],
    [1280, "dark"],
  ]) {
    await rp.setViewportSize({ width: largura, height: 900 });
    await rp.emulateMedia({ colorScheme: tema });
    confere(
      !(await rp.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )),
      `imagens: o formulário a ${String(largura)} px (${tema}) sem deslocação horizontal`,
    );
    await rp.screenshot({
      path: join(
        SAIDA,
        `artigo-imagem-nova-${String(largura)}-${tema === "light" ? "claro" : "escuro"}.png`,
      ),
      fullPage: true,
    });
  }
  if (tamanhoAntes !== null) await rp.setViewportSize(tamanhoAntes);
  await rp.emulateMedia({ colorScheme: "light" });
  await rp.getByLabel("Texto alternativo", { exact: true }).focus();
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () => document.activeElement?.textContent === "Imagem acrescentada.",
  );
  await rp.locator(".imagens-artigo > li").nth(1).waitFor();
  // Tirar a segunda, com confirmação.
  let perguntouTirar = false;
  rp.once("dialog", (d) => {
    perguntouTirar = true;
    void d.accept();
  });
  await rp
    .locator(".imagens-artigo > li")
    .nth(1)
    .getByRole("button", { name: "Tirar a imagem" })
    .focus();
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () => document.activeElement?.textContent === "Imagem tirada do artigo.",
  );
  confere(
    perguntouTirar && (await rp.locator(".imagens-artigo > li").count()) === 1,
    "imagens: tirar pergunta antes, tira a imagem e o foco vai para o aviso",
  );
  rp.off("request", contarEnvios);

  // O histórico do artigo (docs/22 §16), com a Ana (dona): 30 alterações
  // ao peso de uma variante (mais do que uma página de 25), uma descrição
  // longa e uma alteração automática, cada uma na sua transacção. Depois da
  // 8.ª, uma alteração com duas entradas (a variante e o artigo), que fica
  // partida entre a 1.ª e a 2.ª página (revisão do #242, P2-5).
  {
    const ana = psql("select id from pessoa where email = 'ana@exemplo.test'");
    const como = (quem, alteracao) =>
      `begin; select set_config('eurolify.quem', '${quem}', true); ${alteracao}; commit;`;
    const alteracoes = [];
    for (let i = 1; i <= 30; i++) {
      alteracoes.push(
        como(
          `pessoa:per_${ana}`,
          `update variante set peso_g = ${String(10 * i)} where artigo_id = '${artigoDoHistorico}'`,
        ),
      );
      if (i === 8) {
        alteracoes.push(
          como(
            `pessoa:per_${ana}`,
            `update variante set peso_g = 85 where artigo_id = '${artigoDoHistorico}'; update artigo set descricao = 'Curta.' where id = '${artigoDoHistorico}'`,
          ),
        );
      }
    }
    alteracoes.push(
      como(
        `pessoa:per_${ana}`,
        `update artigo set descricao = repeat('Secagem rápida e brilho duradouro. ', 8) where id = '${artigoDoHistorico}'`,
      ),
      como(
        "sistema:passagem",
        `update variante set peso_g = 999 where artigo_id = '${artigoDoHistorico}'`,
      ),
    );
    psql(alteracoes.join("\n"));
  }
  await rp.goto(
    `${ORIGEM}/artigos/prd_${artigoDoHistorico}?comerciante=mer_${comerciante}`,
  );
  await rp.getByRole("link", { name: "Histórico" }).focus();
  await rp.keyboard.press("Enter");
  await rp
    .getByRole("heading", { name: "Histórico do artigo", level: 1 })
    .waitFor();
  const grupos = rp.locator(".historico > li");
  await grupos.first().waitFor();
  const maisRecente = (await grupos.nth(0).textContent()) ?? "";
  const seguinte = (await grupos.nth(1).textContent()) ?? "";
  confere(
    (await grupos.count()) === 25 &&
      maisRecente.includes("Automático") &&
      maisRecente.includes("alterou a variante ENS-003") &&
      maisRecente.includes("Peso (g)") &&
      maisRecente.includes("300 → 999") &&
      seguinte.includes("Ana Teste") &&
      seguinte.includes("alterou o artigo"),
    "histórico: pela ficha, só com o teclado; 25 alterações, a mais recente primeiro, com quem fez, a parte e o antes → depois",
  );
  // O texto longo mostra o começo e «Ver tudo», que abre com o teclado.
  const longo = grupos.nth(1).locator("details");
  await longo.locator("summary").focus();
  await rp.keyboard.press("Enter");
  confere(
    (await longo.getAttribute("open")) !== null &&
      ((await longo.textContent()) ?? "").includes(
        "brilho duradouro. Secagem rápida e brilho duradouro. ",
      ),
    "histórico: um texto longo mostra o começo e «Ver tudo» abre-o",
  );
  await longo.locator("summary").press("Enter");
  // As capturas sem o anel do foco no «Ver tudo».
  await rp.evaluate(() => {
    const activo = document.activeElement;
    if (activo !== null && "blur" in activo) activo.blur();
  });
  for (const [largura, tema] of [
    [375, "light"],
    [768, "light"],
    [1280, "dark"],
  ]) {
    await rp.setViewportSize({ width: largura, height: 900 });
    await rp.emulateMedia({ colorScheme: tema });
    confere(
      !(await rp.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )),
      `histórico: a ${String(largura)} px (${tema}) sem deslocação horizontal`,
    );
    await rp.screenshot({
      path: join(
        SAIDA,
        `historico-${String(largura)}-${tema === "light" ? "claro" : "escuro"}.png`,
      ),
      fullPage: true,
    });
  }
  await rp.setViewportSize({ width: 375, height: 800 });
  await rp.emulateMedia({ colorScheme: "light" });
  // «Mostrar mais» que falha diz o erro, com o foco nele, e as 25 ficam.
  let falhouMais = false;
  await rp.route("**/timeline?cursor=*", async (pedido) => {
    if (falhouMais) return pedido.fallback();
    falhouMais = true;
    await pedido.abort("failed");
  });
  await rp.getByRole("button", { name: "Mostrar mais" }).focus();
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () => document.activeElement?.id === "historico-falha-mais",
  );
  confere(
    (await grupos.count()) === 25 &&
      (await rp.getByRole("button", { name: "Tentar outra vez" }).count()) ===
        1,
    "histórico: «Mostrar mais» que falha diz o erro, com o foco nele; as 25 ficam",
  );
  await rp.getByRole("button", { name: "Tentar outra vez" }).focus();
  await rp.keyboard.press("Enter");
  await rp.waitForFunction(
    () => document.querySelectorAll(".historico > li").length > 25,
  );
  await rp.unroute("**/timeline?cursor=*");
  const focado = await rp.evaluate(() => document.activeElement?.id ?? "");
  // A alteração partida: a 25.ª fica com as duas entradas, e o foco vai
  // para a primeira entrada nova, que é a segunda dela (P3-6).
  const partida = grupos.nth(24).locator("ul > li");
  const ultimo = (await grupos.last().textContent()) ?? "";
  confere(
    (await grupos.count()) === 34 &&
      (await partida.count()) === 2 &&
      focado === (await partida.nth(1).getAttribute("id")) &&
      ultimo.includes("passagem:preparar") &&
      ultimo.includes("criou o artigo") &&
      ultimo.includes("criou a variante ENS-003") &&
      (await rp.getByRole("button", { name: "Mostrar mais" }).count()) === 0,
    "histórico: «Tentar outra vez» traz as seguintes; a alteração partida entre páginas fica junta, com o foco na primeira entrada nova, até à criação",
  );
  // O que a passagem fez pelo Hub aparece no histórico: a edição do
  // artigo 2 e a imagem acrescentada e tirada do artigo criado.
  await rp.goto(
    `${ORIGEM}/artigos/prd_${artigoEditavel}/historico?comerciante=mer_${comerciante}`,
  );
  await grupos.first().waitFor();
  const doEditavel = (await rp.locator(".historico").textContent()) ?? "";
  await rp.goto(fichaVerde31.replace("?", "/historico?"));
  await grupos.first().waitFor();
  const doCriado = (await rp.locator(".historico").textContent()) ?? "";
  confere(
    doEditavel.includes("Ana Teste") &&
      doEditavel.includes("alterou o artigo") &&
      doCriado.includes("criou uma imagem") &&
      doCriado.includes("apagou uma imagem") &&
      doCriado.includes("criou o artigo"),
    "histórico: a edição, a imagem acrescentada e a tirada pelo Hub aparecem com a Ana",
  );
  // Com a sessão terminada, o histórico vai para «Entrar».
  await rp.route("**/hub/products/*/timeline*", (pedido) =>
    pedido.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "auth.session_required", status: 401 }),
    }),
  );
  await rp.goto(fichaVerde31.replace("?", "/historico?"));
  await rp.waitForURL(/\/entrar$/);
  await rp.unroute("**/hub/products/*/timeline*");
  confere(true, "histórico: com a sessão terminada, vai para «Entrar»");
  await rp.goto(
    `${ORIGEM}/artigos/prd_00000000-0000-7000-8000-000000000000/historico?comerciante=mer_${comerciante}`,
  );
  await rp.getByText("Este artigo não existe neste comerciante.").waitFor();
  confere(true, "histórico: um artigo que não existe diz-o");

  // Sem permissão (403) e sessão que acabou (401), com respostas fingidas.
  const fichaReal = `${ORIGEM}/artigos/prd_${artigoDaFicha}?comerciante=mer_${comerciante}`;
  await rp.route("**/hub/products/prd_*", (r) =>
    r.fulfill({
      status: 403,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "member.inactive", status: 403 }),
    }),
  );
  await rp.goto(fichaReal);
  await rp.getByText("Não pode ver este comerciante.").waitFor();
  confere(
    (await rp.getByRole("button", { name: "Tentar outra vez" }).count()) === 0,
    "ficha: 403 diz «Não pode ver este comerciante», sem «Tentar outra vez»",
  );
  await rp.unroute("**/hub/products/prd_*");
  await rp.route("**/hub/products/prd_*", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({ codigo: "auth.session_required", status: 401 }),
    }),
  );
  await rp.goto(fichaReal);
  await rp.waitForURL(/\/entrar$/);
  confere(true, "ficha: com a sessão terminada, vai para «Entrar»");
  await rp.unroute("**/hub/products/prd_*");

  await enderecoNovo(rp);
  // B3c — as chaves de API (docs/22 §9.3), com a Ana (dona).
  const pedidosChaves = [];
  rp.on("request", (p) => {
    pedidosChaves.push(p.url());
  });
  await rp.goto(`${ORIGEM}/`);
  await rp.getByRole("link", { name: "Chaves de API" }).click();
  await rp.getByRole("heading", { name: /Chaves de API/ }).waitFor();
  await rp.getByText("Ainda não há chaves.").waitFor();
  confere(true, "chaves: a dona vê a página, ainda sem chaves");
  await rp.getByRole("button", { name: "Criar a chave" }).click();
  await rp.getByText("O nome tem de ter entre 1 e 100 caracteres.").waitFor();
  await rp
    .getByLabel("Nome (ex.: Integração da faturação)")
    .fill("Integração de teste");
  await rp.getByRole("button", { name: "Criar a chave" }).click();
  await rp
    .getByText("Escolha pelo menos uma coisa que a chave pode fazer.")
    .waitFor();
  confere(true, "chaves: sem nome ou sem âmbitos, o ecrã recusa antes da API");
  await rp.getByLabel("Ler o catálogo").check();
  await rp.getByLabel("Gerir chaves").check();
  await rp.getByRole("button", { name: "Criar a chave" }).click();
  await rp.getByText("O segredo da chave «Integração de teste»").waitFor();
  const segredoChave = (await rp.locator(".segredo").textContent()) ?? "";
  confere(
    /^eul_sk_[a-z2-7]+$/.test(segredoChave),
    "chaves: o segredo aparece uma vez (eul_sk_…)",
  );
  // Depois de a lista se reler (a captura só com o ecrã parado).
  await rp.getByText("1 chave", { exact: true }).waitFor();
  await rp.waitForLoadState("networkidle");
  await rp.screenshot({
    path: join(SAIDA, "chaves-segredo-375-claro.png"),
    fullPage: true,
  });
  const comChave = (segredo) =>
    fetch(`http://127.0.0.1:${String(PORTA_API)}/keys`, {
      headers: { authorization: `Bearer ${segredo}` },
    }).then((r) => r.status);
  confere(
    (await comChave(segredoChave)) === 200,
    "chaves: o segredo criado no Hub entra na API (GET /keys 200)",
  );
  await rp.getByRole("button", { name: "Já o guardei" }).click();
  confere(
    (await rp.locator(".segredo").count()) === 0,
    "chaves: «Já o guardei» tira o segredo do ecrã",
  );
  await rp.getByText("1 chave", { exact: true }).waitFor();
  const linha = rp.getByRole("row", { name: /Integração de teste/ });
  confere(
    (await linha.getByText("Activa", { exact: true }).count()) === 1 &&
      (await linha.getByText("Você", { exact: true }).count()) === 1 &&
      (await linha.getByText("Ler o catálogo, Gerir chaves").count()) === 1,
    "chaves: a lista mostra a chave activa, criada por si, com os âmbitos",
  );
  rp.once("dialog", (d) => void d.accept());
  await rp
    .getByRole("button", { name: "Revogar: Integração de teste" })
    .click();
  await rp.getByText("A chave foi revogada.").waitFor();
  confere(
    (await rp.getByText(/^Revogada a /).count()) === 1 &&
      (await rp.getByRole("button", { name: /^Revogar:/ }).count()) === 0,
    "chaves: revogar; fica «Revogada», sem o botão",
  );
  confere(
    (await comChave(segredoChave)) === 401,
    "chaves: a chave revogada deixa de entrar na API (401)",
  );
  // Sem resposta ao criar: o ecrã diz que a chave pode ter ficado criada e
  // relê a lista (revisão do #183, P2-1).
  await rp.route("**/hub/keys", (r) =>
    r.request().method() === "POST" ? r.abort() : r.continue(),
  );
  await rp
    .getByLabel("Nome (ex.: Integração da faturação)")
    .fill("Sem resposta");
  await rp.getByLabel("Ler o catálogo").check();
  await rp.getByRole("button", { name: "Criar a chave" }).click();
  await rp
    .getByText("a chave pode ter sido criada", { exact: false })
    .waitFor();
  confere(
    true,
    "chaves: sem resposta ao criar, o ecrã avisa que pode ter ficado criada",
  );
  await rp.unroute("**/hub/keys");
  // Uma chave com data de fim: a lista mostra a data.
  await rp.getByRole("button", { name: "Criar a chave" }).click();
  await rp.getByText("O segredo da chave «Sem resposta»").waitFor();
  await rp.getByRole("button", { name: "Já o guardei" }).click();
  const fimDoAno = `${String(new Date().getFullYear() + 1)}-12-31`;
  await rp.getByLabel("Nome (ex.: Integração da faturação)").fill("Com prazo");
  await rp.getByLabel("Ler o catálogo").check();
  await rp.getByLabel(/^Expira a/).fill(fimDoAno);
  await rp.getByRole("button", { name: "Criar a chave" }).click();
  await rp.getByText("O segredo da chave «Com prazo»").waitFor();
  await rp.getByRole("button", { name: "Já o guardei" }).click();
  await rp.getByText("3 chaves", { exact: true }).waitFor();
  confere(
    (await rp
      .getByRole("row", { name: /Com prazo/ })
      .getByText(`31/12/${fimDoAno.slice(0, 4)}`)
      .count()) === 1,
    "chaves: uma chave com data de fim mostra-a na lista",
  );

  const guardadoChaves = JSON.stringify(
    await recuperado.contexto.storageState(),
  );
  confere(
    !pedidosChaves.some((u) => u.includes(segredoChave)) &&
      !guardadoChaves.includes(segredoChave),
    "chaves: o segredo nunca foi num endereço nem ficou no navegador",
  );

  const sessao = await recuperado.contexto.storageState();
  const guardado = JSON.stringify(sessao).toUpperCase();
  confere(
    !guardado.includes(segredoTotp) &&
      !guardado.includes(palavraDaAna.toUpperCase()),
    "o navegador não guardou o segredo do autenticador nem a palavra-passe",
  );
  confere(
    !formas.some((c) => guardado.includes(c)),
    "o navegador não guardou nenhum código de recuperação",
  );

  // A entrada por módulos (docs/hub-modular-glassmorphism.md; skill
  // eurolify-hub-quality-gate): as 8 larguras nos dois temas, as línguas, a
  // pesquisa, o teclado, o modo opaco, as preferências e vários comerciantes.
  {
    const LARGURAS = [320, 375, 390, 768, 820, 1024, 1280, 1440];
    const colunasPara = (w) =>
      w < 480 ? 2 : w < 640 ? 3 : w < 880 ? 4 : w < 1040 ? 5 : 6;
    const destinosDoDono = ["equipa", "artigos", "chaves"].map(
      (c) => `/${c}?comerciante=mer_${comerciante}`,
    );
    const medirEntrada = (p) =>
      p.evaluate(() => {
        const grelha = document.querySelector(".grelha-modulos");
        const nav = document.querySelector(".modulos");
        const cartoes = [...document.querySelectorAll(".atalho-modulo")];
        return {
          largo: document.documentElement.scrollWidth > window.innerWidth,
          colunas: window
            .getComputedStyle(grelha)
            .gridTemplateColumns.split(" ").length,
          larguraGrelha: nav.clientWidth,
          pequenos: cartoes.filter((a) => {
            const r = a.getBoundingClientRect();
            return r.width < 44 || r.height < 44;
          }).length,
          cortados: [...document.querySelectorAll(".rotulo-modulo")].filter(
            (e) =>
              e.scrollWidth > e.clientWidth + 1 ||
              e.scrollHeight > e.clientHeight + 1,
          ).length,
          destinos: cartoes.map((a) => a.getAttribute("href")),
        };
      });
    // O vidro lê-se nos dois elementos que o têm, pelo desfoque e pela cor
    // de fundo (translúcida ou opaca) (revisão do #219, P2-4).
    const lerVidro = (p) =>
      p.evaluate(() =>
        [".superficie-icone", ".pesquisa-linha input"].map((sel) => {
          const cs = window.getComputedStyle(document.querySelector(sel));
          return { sel, filtro: cs.backdropFilter, fundo: cs.backgroundColor };
        }),
      );
    const opacoDe = (fundo) => /^rgb\(\d+, \d+, \d+\)$/.test(fundo);
    const comVidro = (l) =>
      l.every((x) => x.filtro.includes("blur") && !opacoDe(x.fundo));
    const semVidro = (l) =>
      l.every((x) => x.filtro === "none" && opacoDe(x.fundo));
    const mostrar = (l) =>
      l.map((x) => `${x.sel}: ${x.filtro}, ${x.fundo}`).join("; ");
    const ficheiro = (nome, largura, tema) =>
      join(
        SAIDA,
        `${nome}-${String(largura)}-${tema === "light" ? "claro" : "escuro"}.png`,
      );

    for (const tema of ["light", "dark"]) {
      for (const largura of LARGURAS) {
        const c = await navegador.newContext({
          ignoreHTTPSErrors: true,
          colorScheme: tema,
          viewport: { width: largura, height: 900 },
          storageState: sessao,
        });
        const p = await c.newPage();
        await p.goto(`${ORIGEM}/`);
        await p.locator(".grelha-modulos").waitFor();
        const m = await medirEntrada(p);
        const vidro = await lerVidro(p);
        const nome = `entrada ${String(largura)} ${tema}`;
        confere(!m.largo, `${nome}: sem deslocação horizontal`);
        confere(
          m.colunas === colunasPara(m.larguraGrelha),
          `${nome}: ${String(m.colunas)} colunas para ${String(m.larguraGrelha)} px de grelha`,
        );
        confere(
          m.pequenos === 0,
          `${nome}: cada módulo tem pelo menos 44 × 44 px`,
        );
        confere(m.cortados === 0, `${nome}: nenhum rótulo cortado`);
        confere(
          JSON.stringify(m.destinos) === JSON.stringify(destinosDoDono),
          `${nome}: os três módulos do dono, com o comerciante no endereço`,
        );
        confere(
          comVidro(vidro),
          `${nome}: o vidro está ligado no ícone e no campo (${mostrar(vidro)})`,
        );
        await p.screenshot({
          path: ficheiro("entrada", largura, tema),
          fullPage: true,
        });
        await c.close();
      }
    }

    // As outras línguas, a 375, 768 e 1280 px.
    for (const [lingua, rotulo] of [
      ["es", "Claves de API"],
      ["en", "API keys"],
    ]) {
      for (const largura of [375, 768, 1280]) {
        const c = await navegador.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: largura, height: 900 },
          storageState: sessao,
        });
        await c.addInitScript((l) => {
          window.localStorage.setItem("eurolify-hub-lingua", l);
        }, lingua);
        const p = await c.newPage();
        await p.goto(`${ORIGEM}/`);
        await p.locator(".grelha-modulos").waitFor();
        const m = await medirEntrada(p);
        const nome = `entrada ${lingua} ${String(largura)}`;
        confere(
          !m.largo && m.cortados === 0,
          `${nome}: sem deslocação nem rótulos cortados`,
        );
        confere(
          (await p.getByRole("link", { name: rotulo, exact: true }).count()) ===
            1,
          `${nome}: o módulo das chaves na língua («${rotulo}»)`,
        );
        await p.screenshot({
          path: join(SAIDA, `entrada-${lingua}-${String(largura)}-claro.png`),
          fullPage: true,
        });
        await c.close();
      }
    }

    // Pesquisa, teclado, Ctrl+clique e modo opaco.
    const c = await navegador.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 375, height: 900 },
      storageState: sessao,
    });
    const p = await c.newPage();
    await p.goto(`${ORIGEM}/`);
    await p.locator(".grelha-modulos").waitFor();
    const campo = p.getByLabel("Pesquisar módulos");
    await campo.fill("  CONVITES ");
    confere(
      (await p.locator(".atalho-modulo").allTextContents()).join() ===
        "Equipa" &&
        (await p.locator(".contagem-modulos").textContent()) === "1 módulo",
      "entrada: a pesquisa encontra a equipa pelos termos, sem acentos nem maiúsculas, e anuncia 1 módulo",
    );
    await campo.fill("faturas");
    await p
      .getByText("Nenhum módulo corresponde a «faturas».")
      .waitFor({ timeout: 5_000 });
    confere(
      (await p.locator(".atalho-modulo").count()) === 0,
      "entrada: uma pesquisa sem resultados diz qual foi e não mostra módulos",
    );
    await p.screenshot({
      path: join(SAIDA, "entrada-sem-resultados-375-claro.png"),
      fullPage: true,
    });
    await p.getByRole("button", { name: "Limpar a pesquisa" }).click();
    confere(
      (await campo.inputValue()) === "" &&
        (await p.locator(".atalho-modulo").count()) === 3 &&
        (await campo.evaluate((e) => e === document.activeElement)),
      "entrada: «Limpar a pesquisa» volta aos três módulos e devolve o foco ao campo",
    );
    // Só teclado: do campo, Tab passa pelos módulos pela ordem e Enter abre.
    await campo.focus();
    await p.keyboard.press("Tab");
    const primeiro = await p.evaluate(
      () => document.activeElement?.textContent,
    );
    await p.keyboard.press("Tab");
    const segundoFoco = await p.evaluate(
      () => document.activeElement?.textContent,
    );
    confere(
      primeiro === "Equipa" && segundoFoco === "Artigos",
      `entrada: Tab do campo vai à Equipa e depois aos Artigos (${String(primeiro)}, ${String(segundoFoco)})`,
    );
    await p.keyboard.press("Enter");
    await p.getByRole("heading", { name: /Artigos/ }).waitFor();
    confere(
      new URL(p.url()).pathname === "/artigos",
      "entrada: Enter num módulo abre a página",
    );
    await p.getByRole("link", { name: "Voltar ao início" }).click();
    await p.locator(".grelha-modulos").waitFor();
    confere(
      new URL(p.url()).search === `?comerciante=mer_${comerciante}`,
      "entrada: «Voltar ao início» volta com o comerciante no endereço",
    );
    // Ctrl/Cmd+clique abre noutro separador e esta página fica.
    const [nova] = await Promise.all([
      c.waitForEvent("page"),
      p
        .getByRole("link", { name: "Chaves de API", exact: true })
        .click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await nova.waitForLoadState();
    confere(
      new URL(nova.url()).pathname === "/chaves" &&
        new URL(p.url()).pathname === "/",
      "entrada: Ctrl/Cmd+clique abre o módulo noutro separador e a entrada fica",
    );
    await nova.close();

    // «Superfícies opacas»: tira o vidro, dura na sessão da página, não se
    // guarda no navegador.
    const antesDeOpaco = JSON.stringify(await c.storageState());
    const opaco = p.getByRole("button", { name: "Superfícies opacas" });
    await opaco.click();
    const vidroOpaco = await lerVidro(p);
    confere(
      (await opaco.getAttribute("aria-pressed")) === "true" &&
        semVidro(vidroOpaco),
      `entrada: «Superfícies opacas» tira o vidro do ícone e do campo (${mostrar(vidroOpaco)})`,
    );
    await p.screenshot({
      path: join(SAIDA, "entrada-opaca-375-claro.png"),
      fullPage: true,
    });
    await p.getByRole("link", { name: "Equipa", exact: true }).click();
    await p.getByRole("heading", { name: /Equipa/ }).waitFor();
    await p.getByRole("link", { name: "Voltar ao início" }).click();
    await p.locator(".grelha-modulos").waitFor();
    confere(
      (await p
        .getByRole("button", { name: "Superfícies opacas" })
        .getAttribute("aria-pressed")) === "true",
      "entrada: o modo opaco continua ao navegar dentro do Hub",
    );
    confere(
      JSON.stringify(await c.storageState()) === antesDeOpaco,
      "entrada: o modo opaco não escreve nada no navegador",
    );
    await p.reload();
    await p.locator(".grelha-modulos").waitFor();
    confere(
      (await p
        .getByRole("button", { name: "Superfícies opacas" })
        .getAttribute("aria-pressed")) === "false",
      "entrada: recarregar volta ao vidro (nada guardado)",
    );

    // As preferências do sistema: menos transparência (pelo protocolo do
    // Chromium; o Playwright não a tem), cores forçadas e menos movimento.
    const cdp = await c.newCDPSession(p);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    const suportada = await p.evaluate(
      () => window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
    );
    if (suportada) {
      const vidroReduzido = await lerVidro(p);
      confere(
        semVidro(vidroReduzido),
        `entrada: com prefers-reduced-transparency, sem vidro no ícone nem no campo (${mostrar(vidroReduzido)})`,
      );
    } else {
      passos.push(
        "NV   entrada: este Chromium não emula prefers-reduced-transparency",
      );
    }
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await p.emulateMedia({ forcedColors: "active" });
    const vidroForcado = await lerVidro(p);
    confere(
      semVidro(vidroForcado),
      `entrada: com cores forçadas, sem vidro no ícone nem no campo (${mostrar(vidroForcado)})`,
    );
    await p.screenshot({
      path: join(SAIDA, "entrada-cores-forcadas-375.png"),
      fullPage: true,
    });
    await p.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    const transicao = await p
      .locator(".superficie-icone")
      .first()
      .evaluate((e) => window.getComputedStyle(e).transitionDuration);
    confere(
      transicao === "0s",
      `entrada: com menos movimento, as superfícies dos ícones sem transição (${transicao})`,
    );
    await c.close();

    // Vários comerciantes: a Ana passa a ser apoio de uma segunda loja (só
    // nesta base descartável, direito na tabela, como o faria um convite).
    const baseDois = abrirBase(urlDe(nomeBase, "eurolify_api", SENHA));
    const segundo = await registarComerciante(baseDois, {
      nome: "Segunda Loja de Ensaio",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    await baseDois.destroy();
    psql(
      `insert into membro (comerciante_id, pessoa_id, papel, convidado_por)
       select '${segundo}'::uuid, id, 'apoio', 'operador:capturas'
       from pessoa where email = 'ana@exemplo.test'`,
    );
    const cv = await navegador.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 375, height: 900 },
      storageState: sessao,
    });
    const pv = await cv.newPage();
    await pv.goto(`${ORIGEM}/`);
    await pv.getByRole("heading", { name: "Escolha o comerciante" }).waitFor();
    confere(
      (await pv.locator(".grelha-modulos").count()) === 0,
      "entrada: com dois comerciantes e nenhum no endereço, pede a escolha e não mostra módulos",
    );
    await pv.screenshot({
      path: join(SAIDA, "entrada-escolher-375-claro.png"),
      fullPage: true,
    });
    await pv.getByRole("link", { name: /Segunda Loja de Ensaio/ }).click();
    await pv.locator(".grelha-modulos").waitFor();
    confere(
      new URL(pv.url()).search === `?comerciante=mer_${segundo}` &&
        JSON.stringify(await pv.locator(".atalho-modulo").allTextContents()) ===
          JSON.stringify(["Equipa", "Artigos"]),
      "entrada: na segunda loja, o apoio vê a equipa e os artigos, sem as chaves",
    );
    await pv.getByRole("link", { name: "Mudar de comerciante" }).click();
    await pv.getByRole("heading", { name: "Escolha o comerciante" }).waitFor();
    await pv.goBack();
    await pv.locator(".grelha-modulos").waitFor();
    confere(
      new URL(pv.url()).search === `?comerciante=mer_${segundo}`,
      "entrada: voltar atrás regressa ao comerciante escolhido",
    );
    await pv.goto(
      `${ORIGEM}/?comerciante=mer_00000000-0000-7000-8000-000000000000`,
    );
    await pv
      .getByText("Este comerciante não está entre os seus.")
      .waitFor({ timeout: 5_000 });
    confere(
      (await pv.locator(".grelha-modulos").count()) === 0,
      "entrada: um comerciante no endereço que não é da pessoa não abre módulos",
    );
    await cv.close();
  }

  // Escolher o tema (docs/22 §4, issue #226): «Tema escuro» com o aparelho
  // em claro, «Tema claro» com o aparelho em escuro, guardado ao recarregar,
  // «Tema automático» volta ao aparelho e apaga a escolha.
  {
    // O fundo e a cor do texto da página (revisão do #227, P2-2): os dois
    // vêm dos tokens, por isso mudam juntos. Espera um pouco pelo efeito do
    // React depois de escolher.
    const html = (p) =>
      p.evaluate(() => {
        const cs = window.getComputedStyle(document.documentElement);
        return `${cs.backgroundColor} / ${cs.color}`;
      });
    const esperarHtml = async (p, valor) => {
      for (let i = 0; i < 20 && (await html(p)) !== valor; i++) {
        await p.waitForTimeout(50);
      }
      return html(p);
    };
    const CLARO = "rgb(255, 255, 255) / rgb(27, 31, 36)";
    const ESCURO = "rgb(17, 20, 24) / rgb(245, 246, 248)";
    const guardado = (p) =>
      p.evaluate(() => window.localStorage.getItem("eurolify-hub-tema"));
    for (const [sistema, escolha, rotulo, esperado, largura] of [
      ["light", "escuro", "Tema escuro", ESCURO, 375],
      ["dark", "claro", "Tema claro", CLARO, 1280],
    ]) {
      const c = await navegador.newContext({
        ignoreHTTPSErrors: true,
        colorScheme: sistema,
        viewport: { width: largura, height: 900 },
        storageState: sessao,
      });
      const p = await c.newPage();
      await p.goto(`${ORIGEM}/equipa?comerciante=mer_${comerciante}`);
      await p.getByRole("heading", { name: /Equipa/ }).waitFor();
      const antes = await html(p);
      await p
        .getByLabel("Tema", { exact: true })
        .selectOption({ label: rotulo });
      await esperarHtml(p, esperado);
      confere(
        (await html(p)) === esperado && antes !== esperado,
        `tema: «${rotulo}» com o aparelho em ${sistema === "light" ? "claro" : "escuro"} muda a página (${antes} → ${await html(p)})`,
      );
      confere(
        (await guardado(p)) === escolha &&
          (await p.evaluate(
            () => document.documentElement.style.colorScheme,
          )) === (escolha === "escuro" ? "dark" : "light"),
        `tema: «${rotulo}» fica guardado e os controlos do navegador seguem-no`,
      );
      await p.reload();
      await p.getByRole("heading", { name: /Equipa/ }).waitFor();
      confere(
        (await html(p)) === esperado &&
          (await p.getByLabel("Tema", { exact: true }).inputValue()) ===
            escolha,
        `tema: «${rotulo}» continua depois de recarregar`,
      );
      const largo = await p.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      confere(!largo, `tema: ${String(largura)} px sem deslocação horizontal`);
      await p.screenshot({
        path: join(
          SAIDA,
          `tema-${escolha}-aparelho-${sistema === "light" ? "claro" : "escuro"}-${String(largura)}.png`,
        ),
        fullPage: true,
      });
      await p
        .getByLabel("Tema", { exact: true })
        .selectOption({ label: "Tema automático" });
      confere(
        (await esperarHtml(p, antes)) === antes && (await guardado(p)) === null,
        "tema: «Tema automático» volta ao tema do aparelho e apaga a escolha guardada",
      );
      // Em automático, o Hub segue o aparelho quando ele muda.
      const outro = sistema === "light" ? "dark" : "light";
      const doOutro = outro === "dark" ? ESCURO : CLARO;
      await p.emulateMedia({ colorScheme: outro });
      confere(
        (await esperarHtml(p, doOutro)) === doOutro,
        `tema: em «Tema automático», o aparelho a passar para ${outro === "dark" ? "escuro" : "claro"} muda a página`,
      );
      await c.close();
    }
    // O cabeçalho a 320 px, com as duas listas, sem deslocação.
    const c = await navegador.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 320, height: 800 },
      storageState: sessao,
    });
    const p = await c.newPage();
    await p.goto(`${ORIGEM}/`);
    await p.getByLabel("Tema", { exact: true }).waitFor();
    confere(
      !(await p.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )),
      "tema: a 320 px, o cabeçalho com a língua e o tema cabe sem deslocação",
    );
    await p.screenshot({
      path: join(SAIDA, "tema-cabecalho-320-claro.png"),
    });
    await c.close();
  }

  // A letra escolhida nas definições do navegador (docs/22 §4, issue #237):
  // com 32 px em vez de 16, o Hub segue-a e as páginas não deslocam. Um
  // separador novo por página: o protocolo do Chromium pode esquecer a
  // definição entre navegações na mesma página.
  {
    for (const largura of [375, 768, 1280]) {
      const c = await navegador.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: largura, height: 900 },
        storageState: sessao,
      });
      for (const [nome, caminho] of [
        ["entrada", `/?comerciante=mer_${comerciante}`],
        ["equipa", `/equipa?comerciante=mer_${comerciante}`],
        ["artigos", `/artigos?comerciante=mer_${comerciante}`],
        ["chaves", `/chaves?comerciante=mer_${comerciante}`],
        ["conta", "/conta"],
      ]) {
        const p = await c.newPage();
        const cdp = await c.newCDPSession(p);
        await cdp.send("Page.enable");
        await cdp.send("Page.setFontSizes", {
          fontSizes: { standard: 32, fixed: 26 },
        });
        await p.goto(`${ORIGEM}${caminho}`);
        await p.locator("h1").first().waitFor();
        await p.waitForLoadState("networkidle");
        const m = await p.evaluate(() => {
          const teste = document.createElement("p");
          teste.style.fontSize = "medium";
          document.body.append(teste);
          const medio = window.getComputedStyle(teste).fontSize;
          teste.remove();
          return {
            medio,
            letra: window.getComputedStyle(document.documentElement).fontSize,
            titulo: window.getComputedStyle(document.querySelector("h1"))
              .fontSize,
            largo: document.documentElement.scrollWidth > window.innerWidth,
            largura: document.documentElement.scrollWidth,
            // Os pontos das tabelas em em seguem a letra (revisão do #241,
            // P3-1): a 32 px, 40em são 1280 px.
            cartoes: window.matchMedia("(max-width: 40em)").matches,
            // Nenhum rótulo de módulo parte uma palavra a meio (P2-1): sem
            // a quebra forçada, cada palavra tem de caber na largura.
            partidos: [...document.querySelectorAll(".rotulo-modulo")]
              .filter((e) => {
                const antes = e.style.overflowWrap;
                e.style.overflowWrap = "normal";
                const largo = e.scrollWidth > e.clientWidth + 1;
                e.style.overflowWrap = antes;
                return largo;
              })
              .map((e) => e.textContent),
          };
        });
        confere(
          m.cartoes === largura <= 1280,
          `letra do navegador a 32 px, ${nome} a ${String(largura)} px: as tabelas ${m.cartoes ? "passam" : "não passam"} a cartões (40em = 1280 px)`,
        );
        confere(
          m.partidos.length === 0,
          `letra do navegador a 32 px, ${nome} a ${String(largura)} px: nenhum rótulo de módulo parte palavras${m.partidos.length > 0 ? ` (${m.partidos.join(", ")})` : ""}`,
        );
        confere(
          m.medio === "32px" &&
            m.letra === "32px" &&
            m.titulo === "48px" &&
            !m.largo,
          `letra do navegador a 32 px (${m.medio}), ${nome} a ${String(largura)} px: a página segue-a (${m.letra}, título ${m.titulo}) e não desloca (${String(m.largura)} px)`,
        );
        await p.screenshot({
          path: join(SAIDA, `letra-32-${nome}-${String(largura)}.png`),
          fullPage: true,
        });
        await p.close();
      }
      await c.close();
    }
  }

  // As capturas: 9 ecrãs × 3 larguras × 2 temas.
  const ecras = [
    ["entrar", "/entrar", "Entrar no Hub"],
    ["convite", `/convite#${conviteDasCapturas}`, "Aceitar o convite"],
    ["inicio", `/?comerciante=mer_${comerciante}`, "Início"],
    ["equipa", `/equipa?comerciante=mer_${comerciante}`, "Equipa"],
    ["artigos", `/artigos?comerciante=mer_${comerciante}`, "Artigos"],
    [
      "artigo",
      `/artigos/prd_${artigoDaFicha}?comerciante=mer_${comerciante}`,
      "Verniz Azul 1",
    ],
    [
      "artigo-novo",
      `/artigos/novo?comerciante=mer_${comerciante}`,
      "Criar artigo",
    ],
    [
      "artigo-editar",
      `/artigos/prd_${artigoEditavel}/editar?comerciante=mer_${comerciante}`,
      "Editar o artigo",
    ],
    ["conta", "/conta", "A minha conta"],
    ["chaves", `/chaves?comerciante=mer_${comerciante}`, "Chaves de API"],
    ["recuperar", "/recuperar", "Recuperar a conta"],
  ];
  for (const tema of ["light", "dark"]) {
    for (const largura of [375, 768, 1280]) {
      const c = await navegador.newContext({
        ignoreHTTPSErrors: true,
        colorScheme: tema,
        viewport: { width: largura, height: 900 },
        storageState: sessao,
      });
      const p = await c.newPage();
      for (const [nome, caminho, titulo] of ecras) {
        await p.goto(`${ORIGEM}${caminho}`);
        await p
          .getByRole("heading", { name: new RegExp(titulo) })
          .first()
          .waitFor();
        await p.waitForLoadState("networkidle");
        const largo = await p.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        confere(
          !largo,
          `${nome} ${String(largura)} ${tema}: sem deslocação horizontal`,
        );
        // As tabelas continuam tabelas para os leitores de ecrã, também
        // quando passam a cartões (display: block), e cada célula diz o seu
        // valor. Mede-se a árvore de acessibilidade do próprio Chromium: o
        // getByRole do Playwright calcula o papel pela etiqueta e não vê o
        // efeito do CSS (revisão do #192, P2-1).
        const falhasTabela = await papeisDasTabelas(c, p);
        if (falhasTabela !== null) {
          confere(
            falhasTabela.length === 0,
            `${nome} ${String(largura)} ${tema}: as tabelas são tabelas para os leitores de ecrã${falhasTabela.length === 0 ? "" : ` (${falhasTabela.slice(0, 3).join("; ")})`}`,
          );
        }
        await p.screenshot({
          path: join(
            SAIDA,
            `${nome}-${String(largura)}-${tema === "light" ? "claro" : "escuro"}.png`,
          ),
          fullPage: true,
        });
      }
      await c.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  api.kill();
  await new Promise((r) => setTimeout(r, 300));
}

console.log(passos.join("\n"));
console.log(`capturas em ${SAIDA}`);
if (falhas.length > 0) {
  console.error(`${String(falhas.length)} verificação(ões) falharam`);
  process.exit(1);
}
