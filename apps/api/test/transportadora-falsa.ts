import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ErroDeRede,
  type AdaptadorTransportadora,
  type CredenciaisTransportadora,
  type EtiquetaEmitida,
  type EventoSeguimento,
  type PedidoEtiqueta,
  type PontoRecolha,
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
    pedir: "emitir" as
      "emitir" | "recusar" | "rede" | "rede_mas_criada" | "pendurar",
    /** Se existe, o pedido de etiqueta espera por ela antes de responder. */
    atraso: null as Promise<void> | null,
    /** Como responde a consultas (etiqueta e seguimento). */
    consultar: "responde" as "responde" | "rede",
    anular: "anulada" as "anulada" | "nao_permitido",
    pedidos: [] as PedidoEtiqueta[],
    etiquetas: new Map<string, EtiquetaEmitida>(),
    eventos: new Map<string, EventoSeguimento[]>(),
    anuladas: [] as string[],
    numero: 0,
    /** Os pontos de recolha da procura (docs/36 §21). */
    pontos: [] as PontoRecolha[],
    /** O que a procura recebeu (para ver que só sai o país e o código postal). */
    procuras: [] as unknown[],
    /** Os pontos que já não recebem; «rede» = não responde. */
    pontosFechados: new Set<string>(),
    disponibilidade: "responde" as "responde" | "rede",
    /** Como responde ao próximo pedido de etiqueta de devolução (docs/36 §22). */
    pedirDevolucao: "emitir" as "emitir" | "recusar" | "rede",
    pedidosDevolucao: [] as PedidoEtiqueta[],
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
        codigo: "PONTO_48",
        nome: { pt: "Entrega num ponto, 48 h" },
        paises: ["PT"],
        pesoMaxG: 10_000,
        pedeTelefone: false,
        pedeEmail: false,
        aceitaOnu: [],
        ponto: true,
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
    procurarPontos(_c, pedido) {
      estado.procuras.push(pedido);
      if (estado.consultar === "rede") {
        return Promise.reject(new ErroDeRede("tempo esgotado"));
      }
      return Promise.resolve(estado.pontos.slice(0, pedido.limite));
    },
    pontoDisponivel(_c, ponto) {
      if (estado.disponibilidade === "rede") {
        return Promise.reject(new ErroDeRede("tempo esgotado"));
      }
      return Promise.resolve(!estado.pontosFechados.has(ponto));
    },
    testar(credenciais: CredenciaisTransportadora) {
      return credenciais["chave"] === CHAVE_BOA
        ? Promise.resolve()
        : Promise.reject(new Error("recusada"));
    },
    async pedirEtiqueta(_c, pedido) {
      estado.pedidos.push(pedido);
      if (estado.atraso !== null) await estado.atraso;
      switch (estado.pedir) {
        case "recusar":
          return { estado: "recusada", motivo: "código postal desconhecido" };
        case "rede":
          throw new ErroDeRede("tempo esgotado");
        case "rede_mas_criada":
          emitir(pedido.referencia);
          throw new ErroDeRede("tempo esgotado");
        case "pendurar":
          // Nunca responde: o núcleo tem de desistir sozinho.
          return new Promise<never>(() => undefined);
        default:
          return { estado: "emitida", ...emitir(pedido.referencia) };
      }
    },
    pedirEtiquetaDevolucao(_c, pedido) {
      estado.pedidosDevolucao.push(pedido);
      switch (estado.pedirDevolucao) {
        case "recusar":
          return Promise.resolve({
            estado: "recusada",
            motivo: "serviço sem devoluções",
          });
        case "rede":
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
  return { adaptador, estado, emitir };
}
