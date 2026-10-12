import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ErroDeRede,
  type AdaptadorTransportadora,
  type CredenciaisTransportadora,
  type EtiquetaEmitida,
  type EventoSeguimento,
  type PedidoEtiqueta,
} from "../src/envios/adaptador.js";

// Uma transportadora de ensaio com o contrato inteiro do docs/36 §8: os
// testes dizem-lhe como responder (emitir, recusar, não responder, criar a
// etiqueta e não responder) e que eventos tem cada número de seguimento.

export const CHAVE_BOA = "chave-boa-123";

/** A assinatura de um aviso: HMAC-SHA256 do corpo, em hexadecimal. */
export const assinarAviso = (corpo: string, segredo: string) =>
  createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");

export function transportadoraFalsa() {
  const estado = {
    /** Como responde ao próximo pedido de etiqueta. */
    pedir: "emitir" as "emitir" | "recusar" | "rede" | "rede_mas_criada",
    /** Como responde a consultas (etiqueta e seguimento). */
    consultar: "responde" as "responde" | "rede",
    anular: "anulada" as "anulada" | "nao_permitido",
    pedidos: [] as PedidoEtiqueta[],
    etiquetas: new Map<string, EtiquetaEmitida>(),
    eventos: new Map<string, EventoSeguimento[]>(),
    anuladas: [] as string[],
    numero: 0,
  };
  const emitir = (referencia: string): EtiquetaEmitida => {
    estado.numero += 1;
    const e: EtiquetaEmitida = {
      seguimento: `EA${String(estado.numero).padStart(9, "0")}PT`,
      urlSeguimento: `https://seguimento.exemplo/EA${String(estado.numero)}`,
      ficheiro: {
        formato: "pdf",
        conteudo: Buffer.from(`%PDF-falso ${referencia}`),
      },
    };
    estado.etiquetas.set(referencia, e);
    return e;
  };
  const adaptador: AdaptadorTransportadora = {
    transportadora: "ctt",
    servicos: () => [
      {
        codigo: "EXPRESSO_48",
        nome: { pt: "Expresso 48 h" },
        paises: ["PT"],
        pesoMaxG: 30_000,
        pedeTelefone: false,
        pedeEmail: false,
        aceitaOnu: ["UN1266"],
      },
      {
        codigo: "COM_TELEFONE",
        nome: { pt: "Com aviso por SMS" },
        paises: ["PT"],
        pesoMaxG: 10_000,
        pedeTelefone: true,
        pedeEmail: false,
        aceitaOnu: [],
      },
      {
        codigo: "SO_ESPANHA",
        nome: { pt: "Só Espanha" },
        paises: ["ES"],
        pesoMaxG: null,
        pedeTelefone: false,
        pedeEmail: false,
        aceitaOnu: [],
      },
    ],
    testar(credenciais: CredenciaisTransportadora) {
      return credenciais["chave"] === CHAVE_BOA
        ? Promise.resolve()
        : Promise.reject(new Error("recusada"));
    },
    pedirEtiqueta(_c, pedido) {
      estado.pedidos.push(pedido);
      switch (estado.pedir) {
        case "recusar":
          return Promise.resolve({
            estado: "recusada",
            motivo: "código postal desconhecido",
          });
        case "rede":
          return Promise.reject(new ErroDeRede("tempo esgotado"));
        case "rede_mas_criada":
          emitir(pedido.referencia);
          return Promise.reject(new ErroDeRede("tempo esgotado"));
        default:
          return Promise.resolve({
            estado: "emitida",
            ...emitir(pedido.referencia),
          });
      }
    },
    consultarEtiqueta(_c, referencia) {
      if (estado.consultar === "rede") {
        return Promise.reject(new ErroDeRede("tempo esgotado"));
      }
      return Promise.resolve(estado.etiquetas.get(referencia) ?? null);
    },
    anularEtiqueta(_c, seguimento) {
      if (estado.anular === "anulada") estado.anuladas.push(seguimento);
      return Promise.resolve(estado.anular);
    },
    consultarSeguimento(_c, seguimento) {
      if (estado.consultar === "rede") {
        return Promise.reject(new ErroDeRede("tempo esgotado"));
      }
      return Promise.resolve(estado.eventos.get(seguimento) ?? []);
    },
    lerAviso(cabecalhos, corpo, segredo) {
      const dada = cabecalhos["x-assinatura"];
      const esperada = assinarAviso(corpo, segredo);
      if (
        typeof dada !== "string" ||
        dada.length !== esperada.length ||
        !timingSafeEqual(Buffer.from(dada), Buffer.from(esperada))
      ) {
        return { valido: false };
      }
      const j = JSON.parse(corpo) as {
        referencia?: string;
        seguimento?: string;
        eventos: {
          id: string;
          estado: string;
          normalizado: EventoSeguimento["estadoNormalizado"];
          em: string;
        }[];
      };
      return {
        valido: true,
        referencia: j.referencia ?? null,
        seguimento: j.seguimento ?? null,
        eventos: j.eventos.map((e) => ({
          idExterno: e.id,
          estadoTransportadora: e.estado,
          estadoNormalizado: e.normalizado,
          em: new Date(e.em),
        })),
      };
    },
  };
  return { adaptador, estado };
}
