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
const conviteGestor = convidar("gil@exemplo.test", "gestor");
const conviteApoio = convidar("ivo@exemplo.test", "apoio");

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
  /** Um navegador novo com uma passkey em software. */
  async function comPasskey() {
    const c = await navegador.newContext({ ignoreHTTPSErrors: true });
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

  /** Aceita um convite numa conta nova e fica nos comerciantes. */
  async function aceitar(p, segredo, nome) {
    await p.goto(`${ORIGEM}/convite#${segredo}`);
    await p.getByLabel("O seu nome").fill(nome);
    await p
      .getByRole("button", { name: "Criar a conta com uma passkey" })
      .click();
    await p.getByRole("button", { name: "Já os guardei" }).click();
    await p.getByRole("heading", { name: "Os seus comerciantes" }).waitFor();
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
  await pagina.getByRole("heading", { name: "Os seus comerciantes" }).waitFor();
  await pagina.getByText("Loja de Ensaio").waitFor();
  await pagina.getByRole("link", { name: "Ver a equipa" }).click();
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
  await pagina.getByLabel("Papel").selectOption("armazem");
  await pagina.getByRole("button", { name: "Criar o convite" }).click();
  await pagina.getByText("Ligação do convite").waitFor();
  confere(
    pedidosVistos
      .slice(antes)
      .some((u) => u.endsWith("/hub/session/reauthenticate")),
    "convidar com a sessão antiga pede a passkey outra vez e repete",
  );

  // Passkey recusada (sem verificação do utilizador): fica neutro, não vermelho.
  psql(
    "update sessao set autenticada_em = now() - interval '1 hour' where revogada_em is null",
  );
  await cdp.send("WebAuthn.setUserVerified", {
    authenticatorId: autenticador,
    isUserVerified: false,
  });
  await pagina.goto(equipa);
  await pagina.getByLabel("E-mail do convidado").fill("lia@exemplo.test");
  await pagina.getByLabel("Papel").selectOption("apoio");
  await pagina.getByRole("button", { name: "Criar o convite" }).click();
  await pagina.waitForTimeout(1500);
  const vermelho = await pagina.locator(".erro").count();
  const textoNeutro = await pagina
    .getByText("A passkey foi cancelada", { exact: false })
    .count();
  confere(
    vermelho === 0 && textoNeutro === 1,
    `passkey recusada: aviso neutro, sem caixa vermelha (vermelho ${String(vermelho)}, neutro ${String(textoNeutro)})`,
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

  // O gestor só oferece armazém e apoio; o apoio não convida (P2-2).
  const gestor = await comPasskey();
  await aceitar(gestor.pagina, conviteGestor, "Gil Teste");
  await gestor.pagina.goto(equipa);
  // Espera pelo formulário: ler as opções antes dele dava uma lista vazia.
  await gestor.pagina.getByRole("option", { name: "Apoio" }).waitFor({
    state: "attached",
  });
  const opcoes = await gestor.pagina
    .getByLabel("Papel")
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
    .getByRole("heading", { name: "Os seus comerciantes" })
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
  await rp.getByRole("button", { name: "Continuar" }).click();
  await rp
    .getByRole("img", { name: "Código QR para a aplicação de autenticação" })
    .waitFor();
  const segredoTotp = (
    (await rp.locator(".segredo").textContent()) ?? ""
  ).replaceAll(" ", "");
  confere(
    /^[A-Z2-7]{16,}$/.test(segredoTotp),
    "palavra-passe: o código QR e o segredo aparecem",
  );
  await rp.setViewportSize({ width: 375, height: 800 });
  await rp.screenshot({
    path: join(SAIDA, "palavra-passe-qr-375-claro.png"),
    fullPage: true,
  });
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
  await rp.getByRole("button", { name: "Sair" }).click();
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
  await rp.getByRole("heading", { name: "Os seus comerciantes" }).waitFor();
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

  // As capturas: 6 ecrãs × 3 larguras × 2 temas.
  const ecras = [
    ["entrar", "/entrar", "Entrar no Hub"],
    ["convite", `/convite#${conviteParaVer}`, "Aceitar o convite"],
    ["comerciantes", "/", "Os seus comerciantes"],
    ["equipa", `/equipa?comerciante=mer_${comerciante}`, "Equipa"],
    ["conta", "/conta", "A minha conta"],
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
