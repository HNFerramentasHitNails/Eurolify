import { sql } from "kysely";
import { abrirBase } from "./base/ligacao.js";
import { entrarNoRasto } from "./base/rasto.js";
import { comComerciante } from "./comerciante/repositorio.js";
import { lerPedido } from "./identidade/operador.js";
import { registarChave } from "./identidade/repositorio.js";

// Comando do operador (docs/19 §6). Corre na VPS num contentor de uma vez,
// lançado pelo serviço da máquina (eurolify-operador), com a ligação do papel
// eurolify_operador (operador.env), que só chama as três portas do operador
// (migração 0045; revisão do #110, P3-8). Escreve uma linha JSON com o
// resultado; nunca escreve o pedido nem a ligação.

const url = process.env["BASE_DADOS_URL_OPERADOR"]?.trim();
if (url === undefined || url === "") {
  console.error("operador: falta BASE_DADOS_URL_OPERADOR");
  process.exit(1);
}

let pedido;
try {
  pedido = lerPedido(process.argv[2] ?? "");
} catch (erro) {
  console.error(`operador: pedido recusado (${(erro as Error).message})`);
  process.exit(65);
}

// O rasto de auditoria (docs/28 §3.1, #322): o canal é o operador, e o
// pedido, quando o há, é a execução do GitHub.
entrarNoRasto({
  canal: "operador",
  ...(pedido.accao === "comerciante" ? { pedido: pedido.pedido } : {}),
});
const base = abrirBase(url);
try {
  if (pedido.accao === "comerciante") {
    // O mesmo pedido (a mesma execução do GitHub, também num «Re-run»)
    // devolve o mesmo comerciante, com `ja_existia: true` (0045).
    const { rows } = await sql<{ id: string; ja_existia: boolean }>`
      select id, ja_existia from comerciante_criar_pelo_operador(
        ${pedido.pedido}, ${pedido.nome}, ${pedido.lingua}, ${pedido.fuso},
        ${`operador:${pedido.quem}`})`.execute(base);
    const criado = rows[0];
    if (criado === undefined)
      throw new Error("a base não devolveu o comerciante");
    console.log(
      JSON.stringify({
        comerciante: `mer_${criado.id}`,
        ja_existia: criado.ja_existia,
      }),
    );
  } else if (pedido.accao === "convite") {
    // A base valida o e-mail, o papel e o resumo, e que o comerciante está
    // activo; o convite vale 7 dias e uma vez (docs/19 §6.0). A correcção do
    // 42704 do primeiro convite no ensaio (08/10/2026) está na migração 0027;
    // o contexto do comerciante, como na chave, fica como segunda protecção
    // (revisão do #168, P3-5).
    const id = await comComerciante(base, pedido.comercianteId, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select convite_criar_pelo_operador(${pedido.comercianteId}::uuid,
          ${pedido.email}, ${pedido.papel}, ${pedido.resumo},
          ${`operador:${pedido.quem}`}) as id`.execute(trx);
      return rows[0]?.id;
    });
    if (id === undefined) throw new Error("a base não devolveu o convite");
    console.log(JSON.stringify({ convite: `inv_${id}` }));
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
