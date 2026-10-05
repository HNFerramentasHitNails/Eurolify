import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VALIDADE_MS, type Confirmacoes } from "./confirmacoes.js";
import type { FilaDePedidos } from "./pedidos.js";

/** O que as ferramentas precisam da fila: só pedir. */
export type Pedinte = Pick<FilaDePedidos, "pedir">;

const CONFIRMACAO = z
  .string()
  .regex(/^[A-Za-z0-9]{8}$/)
  .optional()
  .describe(
    "Código de confirmação devolvido pelo primeiro pedido desta acção. Só depois de a pessoa dizer que sim.",
  );

/**
 * Ferramentas do MCP do ensaio (ADR-0033). As de leitura são as medições do
 * fluxo «medir»; as acções são um conjunto fixo, marcadas como destrutivas
 * e confirmadas em dois passos no servidor (#92): o primeiro pedido não
 * executa, devolve um código; só o segundo, com o código, executa. Nenhuma
 * muda configuração (ADR-0028).
 */
export function criarServidorMcp(
  fila: Pedinte,
  quem: () => string,
  confirmacoes: Confirmacoes,
): McpServer {
  const servidor = new McpServer({ name: "eurolify-ensaio", version: "1.1.0" });

  const texto = (t: string, erro = false) => ({
    content: [{ type: "text" as const, text: t }],
    isError: erro,
  });

  const responder = async (comando: string) => {
    console.info(`mcp: ${quem()} pediu «${comando.split(" ")[0] ?? comando}»`);
    const { codigo, saida } = await fila.pedir(comando);
    return texto(
      codigo === 0
        ? saida || "(sem saída)"
        : `A máquina respondeu com o código ${String(codigo)}.\n\n${saida}`,
      codigo !== 0,
    );
  };

  /** Os dois passos de uma acção. */
  const agir = (
    titulo: string,
    comando: string,
    confirmacao: string | undefined,
  ) => {
    const conta = quem();
    const nome = comando.split(" ")[0] ?? comando;
    if (confirmacao === undefined) {
      const codigo = confirmacoes.pedir(conta, comando);
      if (codigo === null) {
        console.info(
          `mcp: ${conta} pediu «${nome}» — recusado, códigos a mais`,
        );
        return texto(
          "Há demasiadas acções por confirmar desta conta. Espera que caduquem (5 minutos) e pede de novo.",
          true,
        );
      }
      console.info(`mcp: ${conta} pediu «${nome}» — à espera de confirmação`);
      return texto(
        `NADA FOI FEITO AINDA.\n\nAcção: ${titulo}\nPedido: ${comando}\n\n` +
          `Mostra isto à pessoa e pergunta se confirma. Só se ela disser que sim, ` +
          `chama esta ferramenta outra vez, com os mesmos argumentos e confirmacao: "${codigo}". ` +
          `O código vale uma vez, só para esta acção e esta conta, durante ${String(VALIDADE_MS / 60_000)} minutos.`,
      );
    }
    const resultado = confirmacoes.confirmar(conta, comando, confirmacao);
    if (!resultado.ok) {
      console.info(
        `mcp: ${conta} confirmou «${nome}» — recusado (${resultado.motivo})`,
      );
      const porque = {
        desconhecido: "o código não existe ou já foi usado",
        caducado: "o código caducou",
        outra_conta: "o código não é desta conta",
        outro_comando:
          "o código foi pedido para outra acção ou outros argumentos",
      }[resultado.motivo];
      return texto(
        `NADA FOI FEITO: ${porque}. Pede a acção de novo, sem código, para receber outro.`,
        true,
      );
    }
    console.info(`mcp: ${conta} confirmou «${nome}»`);
    return responder(comando);
  };

  const leitura = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const accao = {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  };
  const DOIS_PASSOS =
    " Corre em dois passos: o primeiro pedido não faz nada e devolve um código; só com o código, depois de a pessoa confirmar, é que executa.";

  servidor.registerTool(
    "estado_do_ensaio",
    {
      title: "Estado do ensaio",
      description:
        "Medição só de leitura da VPS do ensaio: sistema, serviços, contentores, portas, SSH, firewall, fail2ban, actualizações, últimas publicações e acções registadas. Sem endereços IP.",
      annotations: leitura,
    },
    () => responder("medir"),
  );

  servidor.registerTool(
    "publicacoes_recentes",
    {
      title: "Publicações recentes",
      description:
        "As últimas imagens publicadas no ensaio (data, resumo sha256 e a anterior). Os resumos daqui são os únicos aceites por «voltar_a_publicacao».",
      annotations: leitura,
    },
    () => responder("publicacoes"),
  );

  servidor.registerTool(
    "correr_copia",
    {
      title: "Correr a cópia agora",
      description:
        "Começa já a cópia diária da base do ensaio (cifrada, para o OVH Object Storage), em segundo plano; o resultado vê-se em «estado_do_ensaio», secção «tarefas»." +
        DOIS_PASSOS,
      inputSchema: { confirmacao: CONFIRMACAO },
      annotations: accao,
    },
    ({ confirmacao }) => agir("Correr a cópia agora", "copia", confirmacao),
  );

  servidor.registerTool(
    "correr_reposicao",
    {
      title: "Correr o ensaio de reposição agora",
      description:
        "Em segundo plano: descarrega a cópia mais recente, repõe-na numa base temporária, confere e apaga-a. O resultado vê-se em «estado_do_ensaio», secção «tarefas»." +
        DOIS_PASSOS,
      inputSchema: { confirmacao: CONFIRMACAO },
      annotations: accao,
    },
    ({ confirmacao }) =>
      agir("Correr o ensaio de reposição agora", "reposicao", confirmacao),
  );

  servidor.registerTool(
    "reiniciar_api",
    {
      title: "Reiniciar a API do ensaio",
      description:
        "Reinicia o contentor da API e confirma o /health. O ensaio fica uns segundos em baixo." +
        DOIS_PASSOS,
      inputSchema: { confirmacao: CONFIRMACAO },
      annotations: accao,
    },
    ({ confirmacao }) =>
      agir("Reiniciar a API do ensaio", "reiniciar-api", confirmacao),
  );

  servidor.registerTool(
    "voltar_a_publicacao",
    {
      title: "Voltar a uma publicação",
      description:
        "Republica no ensaio uma imagem que já esteve no ar (resumo sha256 tirado de «publicacoes_recentes»). Só imagens que têm o MCP. Corre em segundo plano; o resultado vê-se em «estado_do_ensaio». O MCP reinicia com a imagem: é preciso voltar a ligar o connector." +
        DOIS_PASSOS,
      inputSchema: {
        resumo: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/)
          .describe("Resumo da imagem, sha256:<64 hexadecimais>"),
        confirmacao: CONFIRMACAO,
      },
      annotations: accao,
    },
    ({ resumo, confirmacao }) =>
      agir("Voltar a uma publicação", `publicar ${resumo}`, confirmacao),
  );

  servidor.registerTool(
    "actualizar_vps",
    {
      title: "Actualizar os pacotes da VPS",
      description:
        "apt upgrade na VPS, em segundo plano. Recusado em dias úteis das 08:00 às 20:00 (Lisboa), regra 4 do AGENTS.md." +
        DOIS_PASSOS,
      inputSchema: { confirmacao: CONFIRMACAO },
      annotations: accao,
    },
    ({ confirmacao }) =>
      agir("Actualizar os pacotes da VPS", "actualizar", confirmacao),
  );

  servidor.registerTool(
    "reiniciar_vps",
    {
      title: "Reiniciar a VPS",
      description:
        "Em segundo plano: faz uma cópia da base e depois reinicia a máquina. Recusado em dias úteis das 08:00 às 20:00 (Lisboa), regra 4 do AGENTS.md, e cancelado se a cópia acabar já nesse horário. Depois é preciso voltar a ligar o connector." +
        DOIS_PASSOS,
      inputSchema: { confirmacao: CONFIRMACAO },
      annotations: accao,
    },
    ({ confirmacao }) => agir("Reiniciar a VPS", "reiniciar-vps", confirmacao),
  );

  return servidor;
}
