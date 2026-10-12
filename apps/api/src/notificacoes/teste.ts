import {
  type ConfigSmtp,
  type Correio,
  configSmtp,
  correioSmtp,
  ErroCorreio,
} from "./correio.js";

// O e-mail de teste da acção «configurar» (docs/34 §13.1; issue #372; Diogo,
// 12/10/2026: «A»): uma mensagem do remetente para o próprio remetente, com a
// configuração que a API tem, para provar que o envio sai sem precisar de um
// caso nem de dados de alguém. Nunca devolve nem escreve os valores da
// configuração: só se saiu, o `Message-ID` ou o código do erro.

export type ResultadoDoTeste =
  | { enviado: true; id: string }
  | { enviado: false; codigo: string; culpa?: string };

/** A execução do GitHub que pediu o teste, para o texto e para o registo. */
const EXECUCAO = /^run:[0-9]{1,20}$/;

export async function enviarTeste(
  env: Record<string, string | undefined>,
  execucao: string,
  fabrica: (c: ConfigSmtp) => Correio = correioSmtp,
): Promise<ResultadoDoTeste> {
  if (!EXECUCAO.test(execucao)) {
    return { enviado: false, codigo: "execucao_invalida" };
  }
  const { config, problema } = configSmtp(env);
  if (config === undefined) {
    // O `problema` só diz que variáveis faltam, nunca os valores.
    return {
      enviado: false,
      codigo:
        problema === undefined ? "sem_configuracao" : "configuracao_incompleta",
    };
  }
  try {
    const { id } = await fabrica(config).enviar({
      para: config.remetente,
      assunto: "Eurolify: e-mail de teste",
      texto:
        "Este é um e-mail de teste do Eurolify, pedido pela acção «configurar» " +
        `do GitHub (execução ${execucao.slice(4)}).\n\n` +
        "Se chegou, a API envia e-mails com a configuração que tem. " +
        "Não é preciso fazer nada.\n",
    });
    return { enviado: true, id };
  } catch (erro) {
    if (erro instanceof ErroCorreio) {
      return { enviado: false, codigo: erro.codigo, culpa: erro.culpa };
    }
    return { enviado: false, codigo: "desconhecido" };
  }
}
