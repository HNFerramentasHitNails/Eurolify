import { enviarTeste } from "./notificacoes/teste.js";

// O e-mail de teste (docs/34 §13.1). Corre na VPS num contentor de uma vez,
// com a imagem da API que está no ar e só o api-smtp.env, lançado pelo
// eurolify-configurar (fluxo «configurar», acção «testar»). Escreve uma linha
// JSON com o resultado; nunca a configuração. Sai com 0 se o servidor aceitou
// o e-mail, 1 se não.

const resultado = await enviarTeste(process.env, process.argv[2] ?? "");
console.log(JSON.stringify(resultado));
// O transporte guarda a ligação aberta (pool): sai-se à mão.
process.exit(resultado.enviado ? 0 : 1);
