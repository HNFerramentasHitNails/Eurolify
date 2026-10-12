import type { ContaTransportadora, RemetenteConta } from "./api";
import type { Textos } from "./textos";

// Apoio dos ecrãs dos envios (docs/22 §29): o estado de uma conta, o
// remetente e o caminho dos avisos, em linguagem comum. A API decide tudo
// (que campos pedir, se a conta está pronta, que serviços tem); isto só
// apresenta e confere o mínimo antes de enviar.

export const TRANSPORTADORAS: readonly ContaTransportadora["transportadora"][] =
  ["sendcloud", "ctt"];

/** O texto do estado, como o servidor o decidiu. */
export function rotuloDoEstado(
  t: Textos,
  estado: ContaTransportadora["estado"],
): string {
  return estado === "pronta"
    ? t.enviosEstadoPronta
    : estado === "arquivada"
      ? t.enviosEstadoArquivada
      : t.enviosEstadoPorTestar;
}

/** O nome de um campo de credenciais; um que o ecrã não conhece sai técnico. */
export function rotuloDoCampo(t: Textos, campo: string): string {
  const chave = `enviosCampo_${campo}`;
  return chave in t ? t[chave as keyof Textos] : campo;
}

export type CampoRemetente =
  "nome" | "linha1" | "codigo_postal" | "localidade" | "pais";

/** O remetente sem espaços nas pontas, e o primeiro campo em falta. */
export function conferirRemetente(r: RemetenteConta): {
  remetente: RemetenteConta;
  falta: CampoRemetente | null;
} {
  const linha2 = r.linha2?.trim() ?? "";
  const limpo: RemetenteConta = {
    nome: r.nome.trim(),
    linha1: r.linha1.trim(),
    ...(linha2 === "" ? {} : { linha2 }),
    codigo_postal: r.codigo_postal.trim(),
    localidade: r.localidade.trim(),
    pais: r.pais.trim().toUpperCase(),
  };
  const obrigatorios: CampoRemetente[] = [
    "nome",
    "linha1",
    "codigo_postal",
    "localidade",
  ];
  const falta =
    obrigatorios.find((c) => limpo[c] === "") ??
    (/^[A-Z]{2}$/.test(limpo.pais) ? null : "pais");
  return { remetente: limpo, falta };
}

/**
 * O caminho na API onde a transportadora deixa os avisos da conta (docs/36
 * §7.2). É o caminho, não o endereço completo: o servidor público da API
 * decide-se na VPS.
 */
export function caminhoDosAvisos(c: ContaTransportadora): string {
  return `/webhooks/carriers/${c.transportadora}/${c.id}`;
}

/** As contas por mostrar: as arquivadas só quando se pedem. */
export function contasAMostrar(
  contas: readonly ContaTransportadora[],
  comArquivadas: boolean,
): ContaTransportadora[] {
  return contas.filter((c) => comArquivadas || c.estado !== "arquivada");
}
