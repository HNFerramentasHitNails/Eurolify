import { correrMigracao } from "./base/correr-migracao.js";
import { decidirMigracao } from "./base/url-migracao.js";

// Corre na publicação, antes de trocar a versão (eurolify-publicar). Liga-se
// com o utilizador dono das tabelas, nunca com o da API. A falta da variável
// só é tolerada até à data de fim em url-migracao.ts; um erro faz a
// publicação parar e ficar a versão anterior (código de saída 1, sem o
// objecto do erro: correr-migracao.ts).
const decisao = decidirMigracao(process.env, new Date());

if (decisao.tipo === "sem_base") {
  console.log(decisao.aviso);
} else {
  process.exitCode = await correrMigracao(decisao.url, {
    log: (texto) => {
      console.log(texto);
    },
    erro: (texto) => {
      console.error(texto);
    },
  });
}
