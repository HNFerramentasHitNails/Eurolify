import { abrirBase } from "./base/ligacao.js";
import { registarComerciante } from "./comerciante/repositorio.js";
import { lerPedido } from "./identidade/operador.js";
import { registarChave } from "./identidade/repositorio.js";

// Comando do operador (docs/19 §6). Corre na VPS num contentor de uma vez,
// lançado pelo serviço da máquina (eurolify-operador), com a ligação do dono
// das tabelas (migrar.env), como as migrações. Escreve uma linha JSON com o
// resultado; nunca escreve o pedido nem a ligação.

const url = process.env["BASE_DADOS_URL_MIGRACAO"]?.trim();
if (url === undefined || url === "") {
  console.error("operador: falta BASE_DADOS_URL_MIGRACAO");
  process.exit(1);
}

let pedido;
try {
  pedido = lerPedido(process.argv[2] ?? "");
} catch (erro) {
  console.error(`operador: pedido recusado (${(erro as Error).message})`);
  process.exit(65);
}

const base = abrirBase(url);
try {
  if (pedido.accao === "comerciante") {
    const id = await registarComerciante(base, {
      nome: pedido.nome,
      lingua: pedido.lingua,
      fuso: pedido.fuso,
    });
    console.log(JSON.stringify({ comerciante: `mer_${id}` }));
  } else {
    const id = await registarChave(base, pedido.comercianteId, {
      tipo: "servidor",
      nome: pedido.nome,
      ambitos: pedido.ambitos,
      prefixo: pedido.prefixo,
      resumo: pedido.resumo,
      criadaPor: `operador:${pedido.quem}`,
    });
    console.log(
      JSON.stringify({ chave: `key_${id}`, prefixo: pedido.prefixo }),
    );
  }
} catch (erro) {
  // Só o código do PostgreSQL e a primeira linha da mensagem: sem valores
  // da linha nem a ligação.
  const e = erro as { code?: unknown; message?: unknown };
  const codigo = typeof e.code === "string" ? e.code : "";
  const mensagem = typeof e.message === "string" ? e.message : "";
  console.error(
    `operador: falhou (${codigo}) ${(mensagem.split("\n")[0] ?? "").slice(0, 200)}`,
  );
  process.exitCode = 1;
} finally {
  await base.destroy();
}
