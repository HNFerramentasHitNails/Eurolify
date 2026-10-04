import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FilaDePedidos } from "./pedidos.js";

/**
 * Ferramentas do MCP do ensaio (ADR-0033). As de leitura são as medições do
 * fluxo «medir»; as acções são um conjunto fixo, marcadas como destrutivas
 * para o Claude pedir confirmação. Nenhuma muda configuração (ADR-0028).
 */
export function criarServidorMcp(
  fila: FilaDePedidos,
  quem: () => string,
): McpServer {
  const servidor = new McpServer({ name: "eurolify-ensaio", version: "1.0.0" });

  const responder = async (comando: string) => {
    console.info(`mcp: ${quem()} pediu «${comando.split(" ")[0] ?? comando}»`);
    const { codigo, saida } = await fila.pedir(comando);
    const texto =
      codigo === 0
        ? saida
        : `A máquina respondeu com o código ${String(codigo)}.\n\n${saida}`;
    return {
      content: [{ type: "text" as const, text: texto || "(sem saída)" }],
      isError: codigo !== 0,
    };
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
        "Começa já a cópia diária da base do ensaio (cifrada, para o OVH Object Storage), em segundo plano; o resultado vê-se em «estado_do_ensaio», secção «tarefas».",
      annotations: accao,
    },
    () => responder("copia"),
  );

  servidor.registerTool(
    "correr_reposicao",
    {
      title: "Correr o ensaio de reposição agora",
      description:
        "Em segundo plano: descarrega a cópia mais recente, repõe-na numa base temporária, confere e apaga-a. O resultado vê-se em «estado_do_ensaio», secção «tarefas».",
      annotations: accao,
    },
    () => responder("reposicao"),
  );

  servidor.registerTool(
    "reiniciar_api",
    {
      title: "Reiniciar a API do ensaio",
      description:
        "Reinicia o contentor da API e confirma o /health. O ensaio fica uns segundos em baixo.",
      annotations: accao,
    },
    () => responder("reiniciar-api"),
  );

  servidor.registerTool(
    "voltar_a_publicacao",
    {
      title: "Voltar a uma publicação",
      description:
        "Republica no ensaio uma imagem que já esteve no ar (resumo sha256 tirado de «publicacoes_recentes»). Só imagens que têm o MCP. Corre em segundo plano; o resultado vê-se em «estado_do_ensaio». O MCP reinicia com a imagem: é preciso voltar a ligar o connector.",
      inputSchema: {
        resumo: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/)
          .describe("Resumo da imagem, sha256:<64 hexadecimais>"),
      },
      annotations: accao,
    },
    ({ resumo }) => responder(`publicar ${resumo}`),
  );

  servidor.registerTool(
    "actualizar_vps",
    {
      title: "Actualizar os pacotes da VPS",
      description:
        "apt upgrade na VPS, em segundo plano. Recusado em dias úteis das 08:00 às 20:00 (Lisboa), regra 4 do AGENTS.md.",
      annotations: accao,
    },
    () => responder("actualizar"),
  );

  servidor.registerTool(
    "reiniciar_vps",
    {
      title: "Reiniciar a VPS",
      description:
        "Em segundo plano: faz uma cópia da base e depois reinicia a máquina. Recusado em dias úteis das 08:00 às 20:00 (Lisboa), regra 4 do AGENTS.md, e cancelado se a cópia acabar já nesse horário. Depois é preciso voltar a ligar o connector.",
      annotations: accao,
    },
    () => responder("reiniciar-vps"),
  );

  return servidor;
}
