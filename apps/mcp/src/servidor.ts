import { criarApp } from "./app.js";
import { AutorizacaoGitHub } from "./oauth.js";
import { FilaDePedidos } from "./pedidos.js";

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`falta a variável ${nome}`);
    process.exit(1);
  }
  return valor;
}

const urlPublico = obrigatoria("MCP_URL").replace(/\/+$/, "");
// Números das contas no GitHub, não nomes: um nome pode mudar e ficar livre.
const contas = obrigatoria("CONTAS_PERMITIDAS")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    if (!/^[0-9]+$/.test(c)) {
      console.error(
        `CONTAS_PERMITIDAS: «${c}» não é um número de conta do GitHub`,
      );
      process.exit(1);
    }
    return Number(c);
  });

const app = criarApp({
  urlPublico,
  autorizacao: new AutorizacaoGitHub({
    urlPublico,
    githubClientId: obrigatoria("GITHUB_CLIENT_ID"),
    githubClientSecret: obrigatoria("GITHUB_CLIENT_SECRET"),
    contasPermitidas: contas,
  }),
  fila: new FilaDePedidos(process.env["PASTA_PEDIDOS"] ?? "/pedidos"),
});

// Só dentro da máquina: o nginx (com o certificado) está à frente.
const anfitriao = process.env["ANFITRIAO"] ?? "127.0.0.1";
const porta = Number(process.env["PORTA"] ?? "8090");
const servidorHttp = app.listen(porta, anfitriao, () => {
  console.info(
    `mcp: a ouvir em ${anfitriao}:${String(porta)}; contas permitidas: ${contas.join(", ")}`,
  );
});

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.once(sinal, () => {
    servidorHttp.close(() => process.exit(0));
  });
}
