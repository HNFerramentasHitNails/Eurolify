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
import { request as pedidoHttp } from "node:http";
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
execFileSync("node", [join(API, "dist/migrar.js")], {
  env: { ...process.env, BASE_DADOS_URL_MIGRACAO: urlDe(nomeBase) },
  stdio: "inherit",
});
psql(`alter role eurolify_api login password '${SENHA}'`);
const { abrirBase } = await import(join(API, "dist/base/ligacao.js"));
const { registarComerciante } = await import(
  join(API, "dist/comerciante/repositorio.js")
);
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
const conviteParaVer = convidar("rui@exemplo.test", "gestor");

// 2. A API com o Hub ligado, atrás do «proxy» de confiança (127.0.0.1).
const api = spawn("node", [join(API, "dist/servidor.js")], {
  env: {
    ...process.env,
    ANFITRIAO: "127.0.0.1",
    PORTA: String(PORTA_API),
    BASE_DADOS_URL: urlDe(nomeBase, "eurolify_api", SENHA),
    HUB_ORIGEM: ORIGEM,
    PROXY_CONFIAVEL: "127.0.0.1",
  },
  stdio: ["ignore", "ignore", "inherit"],
});

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
          headers: {
            ...pedido.headers,
            "x-forwarded-for": pedido.socket.remoteAddress ?? "",
          },
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
      });
      resposta.end(corpo);
    } catch {
      resposta.writeHead(200, { "content-type": TIPOS[".html"] });
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

// 4. O navegador, com uma passkey em software.
const navegador = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
});
const falhas = [];
const passos = [];
const confere = (condicao, texto) => {
  passos.push(`${condicao ? "ok " : "FALHOU"} ${texto}`);
  if (!condicao) falhas.push(texto);
};

try {
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
  const pagina = await contexto.newPage();
  const pedidosVistos = [];
  pagina.on("request", (p) => {
    pedidosVistos.push(p.url());
  });
  const cdp = await contexto.newCDPSession(pagina);
  await cdp.send("WebAuthn.enable");
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

  // Aceitar o convite: o segredo sai da barra de endereço.
  await pagina.goto(`${ORIGEM}/convite#${conviteDona}`);
  await pagina.getByLabel("O seu nome").waitFor();
  confere(!pagina.url().includes("#"), "o segredo saiu da barra de endereço");
  await pagina.getByLabel("O seu nome").fill("Ana Teste");
  await pagina
    .getByRole("button", { name: "Criar a conta com uma passkey" })
    .click();
  await pagina
    .getByRole("heading", { name: "Os seus códigos de recuperação" })
    .waitFor();
  const codigos = await pagina.locator(".codigos li").count();
  confere(codigos === 10, `10 códigos de recuperação (vi ${String(codigos)})`);
  await pagina.setViewportSize({ width: 375, height: 800 });
  await pagina.screenshot({
    path: join(SAIDA, "codigos-375-claro.png"),
    fullPage: true,
  });
  await pagina.getByRole("button", { name: "Já os guardei" }).click();

  // Os comerciantes e a equipa.
  await pagina.getByRole("heading", { name: "Os seus comerciantes" }).waitFor();
  await pagina.getByText("Loja de Ensaio").waitFor();
  await pagina.getByRole("link", { name: "Ver a equipa" }).click();
  await pagina.getByRole("heading", { name: /Equipa/ }).waitFor();
  await pagina.getByText("rui@exemplo.test").waitFor();
  confere(true, "a equipa mostra o convite em aberto do Rui");

  // Convidar pede autenticação recente? Acabou de criar a conta: não.
  await pagina.getByLabel("E-mail do convidado").fill("eva@exemplo.test");
  await pagina.getByLabel("Papel").selectOption("apoio");
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
  await pagina.getByRole("button", { name: "Sair" }).click();
  await pagina.getByRole("heading", { name: "Entrar no Hub" }).waitFor();
  await pagina.getByRole("button", { name: "Entrar com passkey" }).click();
  await pagina.getByRole("heading", { name: "Os seus comerciantes" }).waitFor();
  confere(true, "sair e entrar outra vez com a passkey");

  // O segredo do convite nunca foi num pedido (caminho ou consulta).
  confere(
    !pedidosVistos.some((u) => u.includes("euc_")),
    "nenhum pedido levou o segredo do convite no endereço",
  );

  // Teclado: o primeiro Tab vai ao «Saltar para o conteúdo», e há foco visível.
  await pagina.goto(`${ORIGEM}/entrar`);
  await pagina.keyboard.press("Tab");
  const primeiro = await pagina.evaluate(
    () => document.activeElement?.textContent,
  );
  confere(primeiro === "Saltar para o conteúdo", "o primeiro Tab é o salto");
  await pagina.keyboard.press("Tab");
  await pagina.keyboard.press("Tab");
  await pagina.screenshot({
    path: join(SAIDA, "entrar-teclado-375-claro.png"),
  });

  const sessao = await contexto.storageState();

  // As capturas: 4 ecrãs × 3 larguras × 2 temas.
  const ecras = [
    ["entrar", "/entrar", "Entrar no Hub"],
    ["convite", `/convite#${conviteParaVer}`, "Aceitar o convite"],
    ["comerciantes", "/", "Os seus comerciantes"],
    ["equipa", `/equipa?comerciante=mer_${comerciante}`, "Equipa"],
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
  psql(`drop database if exists ${nomeBase} with (force)`, "postgres");
  psql(`alter role eurolify_api password null`, "postgres");
}

console.log(passos.join("\n"));
console.log(`capturas em ${SAIDA}`);
if (falhas.length > 0) {
  console.error(`${String(falhas.length)} verificação(ões) falharam`);
  process.exit(1);
}
