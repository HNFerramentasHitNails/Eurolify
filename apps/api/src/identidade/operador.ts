import { AMBITOS, type Ambito } from "./chaves.js";

// O comando do operador (docs/19 §6): criar um comerciante, a primeira chave
// de servidor dele e o convite do primeiro dono (§6.0), fora da API pública. O pedido chega numa linha, pelo
// fluxo «operar» do GitHub (ADR-0028), e valida-se aqui e na máquina. O
// segredo da chave nunca chega cá: o operador gera-o no computador dele
// (scripts/gerar-chave.mjs) e só manda o prefixo e o resumo. O do convite
// também: scripts/gerar-convite.mjs, e só o resumo vem.
//
//   comerciante <lingua> <fuso> <nome em base64url> <quem>
//   chave <comerciante uuid> <âmbitos,separados> <prefixo> <resumo> <nome em base64url> <quem>
//   convite <comerciante uuid> <e-mail em base64url> dono <resumo> <quem>
//
// <quem> é `github:<número da conta>`, o operador que lançou o fluxo.

export type PedidoOperador =
  | {
      accao: "comerciante";
      lingua: string;
      fuso: string;
      nome: string;
      quem: string;
    }
  | {
      accao: "chave";
      comercianteId: string;
      ambitos: Ambito[];
      prefixo: string;
      resumo: string;
      nome: string;
      quem: string;
    }
  | {
      accao: "convite";
      comercianteId: string;
      email: string;
      papel: "dono";
      resumo: string;
      quem: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUEM = /^github:[0-9]{1,20}$/;
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/;

function nomeDe(codificado: string): string {
  if (!BASE64URL.test(codificado)) throw new Error("nome: não é base64url");
  const nome = Buffer.from(codificado, "base64url").toString("utf8");
  // O que não for UTF-8 válido vira «�»: recusa-se em vez de gravar lixo.
  // Nem caracteres de controlo nem de formato (ex.: U+202E, que inverte o
  // texto e disfarça um nome; revisão do #110, P3-3).
  if (nome.includes("\uFFFD") || /[\p{Cc}\p{Cf}]/u.test(nome)) {
    throw new Error("nome: texto inválido");
  }
  const limpo = nome.trim();
  if (limpo.length < 1 || limpo.length > 100) {
    throw new Error("nome: entre 1 e 100 caracteres");
  }
  return limpo;
}

// As mesmas regras da base (convite_validar, migração 0018), sem caracteres
// de controlo nem de formato. A base valida outra vez.
function emailDe(codificado: string): string {
  if (!/^[A-Za-z0-9_-]{1,340}$/.test(codificado)) {
    throw new Error("e-mail: não é base64url");
  }
  const email = Buffer.from(codificado, "base64url").toString("utf8").trim();
  if (
    email.includes("\uFFFD") ||
    /[\p{Cc}\p{Cf}]/u.test(email) ||
    email.length < 3 ||
    email.length > 254 ||
    !/^[^@\s]+@[^@\s]+$/.test(email)
  ) {
    throw new Error("e-mail: inválido");
  }
  return email;
}

/** Lê e valida um pedido; lança um erro com o motivo, sem repetir o pedido. */
export function lerPedido(linha: string): PedidoOperador {
  // O mesmo limite das camadas da máquina (revisão do #110, P3-1).
  if (linha.length > 600) throw new Error("pedido comprido demais");
  const partes = linha.split(" ");
  const [accao] = partes;
  if (accao === "comerciante" && partes.length === 5) {
    const [, lingua = "", fuso = "", nome = "", quem = ""] = partes;
    if (!/^[a-z]{2}$/.test(lingua)) throw new Error("língua: duas letras");
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(fuso)) {
      throw new Error("fuso: nome IANA (ex.: Europe/Lisbon)");
    }
    if (!QUEM.test(quem)) throw new Error("quem: github:<número>");
    return { accao, lingua, fuso, nome: nomeDe(nome), quem };
  }
  if (accao === "chave" && partes.length === 7) {
    const [
      ,
      comercianteId = "",
      lista = "",
      prefixo = "",
      resumo = "",
      nome = "",
      quem = "",
    ] = partes;
    if (!UUID.test(comercianteId)) throw new Error("comerciante: uuid");
    const ambitos = lista.split(",");
    const validos = AMBITOS.filter(
      (a) => a !== "storefront",
    ) as readonly string[];
    if (
      ambitos.length === 0 ||
      new Set(ambitos).size !== ambitos.length ||
      ambitos.some((a) => !validos.includes(a))
    ) {
      throw new Error("âmbitos: lista de âmbitos de servidor, sem repetidos");
    }
    if (!/^eul_sk_[a-z2-7]{5}$/.test(prefixo)) {
      throw new Error("prefixo: eul_sk_ e 5 caracteres");
    }
    if (!/^[0-9a-f]{64}$/.test(resumo)) throw new Error("resumo: sha256");
    if (!QUEM.test(quem)) throw new Error("quem: github:<número>");
    return {
      accao,
      comercianteId,
      ambitos: ambitos as Ambito[],
      prefixo,
      resumo,
      nome: nomeDe(nome),
      quem,
    };
  }
  if (accao === "convite" && partes.length === 6) {
    const [
      ,
      comercianteId = "",
      email = "",
      papel = "",
      resumo = "",
      quem = "",
    ] = partes;
    if (!UUID.test(comercianteId)) throw new Error("comerciante: uuid");
    // Só o primeiro dono (ou a recuperação): os outros papéis convida-os um
    // dono no Hub (docs/19 §6.0).
    if (papel !== "dono") throw new Error("papel: só dono");
    if (!/^[0-9a-f]{64}$/.test(resumo)) throw new Error("resumo: sha256");
    if (!QUEM.test(quem)) throw new Error("quem: github:<número>");
    return {
      accao,
      comercianteId,
      email: emailDe(email),
      papel,
      resumo,
      quem,
    };
  }
  throw new Error("acção desconhecida ou número de partes errado");
}
