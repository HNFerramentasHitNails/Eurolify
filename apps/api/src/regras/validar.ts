import { instante } from "./instante.js";
import {
  CODIGOS_UE,
  DOMINIOS as DOMINIOS_TIPADOS,
  ESTADOS_LEGAIS as ESTADOS_LEGAIS_TIPADOS,
  type Registo,
  type RevisaoDominio,
} from "./tipos.js";

const DOMINIOS: readonly string[] = DOMINIOS_TIPADOS;
const ESTADOS_LEGAIS: readonly string[] = ESTADOS_LEGAIS_TIPADOS;

/** Um objecto a sério (nem null, nem texto, nem lista). */
function objecto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

const ESTADOS_REVISAO: readonly string[] = [
  "por_verificar",
  "verificado",
  "nao_aplicavel",
];

/** Um campo de prova ou de identidade não pode ficar vazio. */
function vazio(texto: unknown): boolean {
  return typeof texto !== "string" || texto.trim() === "";
}

/**
 * Lista os erros de um registo (revisão do #37, P1-2: nada falha em
 * silêncio). Vazia = registo coerente. Não diz se as regras estão certas —
 * isso é a revisão humana com a fonte —, só se o registo é consistente.
 */
export function errosDoRegisto(registo: Registo): string[] {
  const erros: string[] = [];

  if (!Number.isInteger(registo.versao) || registo.versao < 1) {
    erros.push(`versão do registo inválida: ${String(registo.versao)}`);
  }

  // Vindo de fora sem tipos, `paises` ou `regras` podem não ser listas; sem
  // elas não há mais nada que se possa verificar (revisão do #40, P2-1).
  const paises: unknown = registo.paises;
  const regras: unknown = registo.regras;
  if (!Array.isArray(paises) || !Array.isArray(regras)) {
    erros.push("«paises» e «regras» têm de ser listas");
    return erros;
  }

  const codigos = registo.paises.map((p) => p.codigo as string);
  for (const codigo of CODIGOS_UE) {
    const vezes = codigos.filter((c) => c === codigo).length;
    if (vezes !== 1)
      erros.push(`país ${codigo} aparece ${String(vezes)} vezes`);
  }
  for (const codigo of codigos) {
    if (!(CODIGOS_UE as readonly string[]).includes(codigo)) {
      erros.push(`país ${codigo} não é um dos 27`);
    }
  }

  for (const perfil of registo.paises) {
    // Vindo de fora, «dominios» pode não ser um objecto (revisão do #45,
    // P2-2): lista-se e passa-se ao país seguinte.
    const dominiosDoPerfil: unknown = perfil.dominios;
    if (!objecto(dominiosDoPerfil)) {
      erros.push(`${perfil.codigo}: «dominios» tem de ser um objecto`);
      continue;
    }
    const territoriosDoPerfil: unknown = perfil.territorios;
    if (territoriosDoPerfil !== null && !Array.isArray(territoriosDoPerfil)) {
      erros.push(
        `${perfil.codigo}: «territorios» tem de ser uma lista ou null`,
      );
    }
    const chaves = Object.keys(dominiosDoPerfil);
    for (const dominio of DOMINIOS) {
      if (!chaves.includes(dominio)) {
        erros.push(`${perfil.codigo}: falta o domínio ${dominio}`);
      }
    }
    for (const chave of chaves) {
      if (!DOMINIOS.includes(chave)) {
        erros.push(`${perfil.codigo}: domínio desconhecido ${chave}`);
      }
    }
    for (const [dominio, valor] of Object.entries(dominiosDoPerfil)) {
      const sitio = `${perfil.codigo}/${dominio}`;
      if (!objecto(valor)) {
        erros.push(`${sitio}: revisão em falta`);
        continue;
      }
      const revisao = valor as unknown as RevisaoDominio;
      // Um estado fora dos três fica listado, não interpretado (revisão do
      // #40, P1-1).
      if (!ESTADOS_REVISAO.includes(revisao.estado)) {
        erros.push(
          `${sitio}: estado de revisão desconhecido «${revisao.estado}»`,
        );
        continue;
      }
      if (revisao.estado === "por_verificar") continue;
      if (vazio(revisao.revistoPor)) {
        erros.push(`${sitio}: «${revisao.estado}» sem quem reviu`);
      }
      if (
        revisao.estado === "verificado" &&
        instante(revisao.verificadoEm) === null
      ) {
        erros.push(
          `${sitio}: data de verificação inválida «${revisao.verificadoEm}»`,
        );
      }
      if (
        revisao.estado === "nao_aplicavel" &&
        (vazio(revisao.justificacao) || vazio(revisao.prova))
      ) {
        erros.push(`${sitio}: «não aplicável» sem justificação ou sem prova`);
      }
    }
  }

  const vistas = new Set<string>();
  for (const regra of registo.regras) {
    const nome = `${regra.id}@${String(regra.versao)}`;
    if (vistas.has(nome)) erros.push(`${nome}: repetida`);
    vistas.add(nome);

    // Identidade e prova: nada vazio (revisão do #40, P2-5). Uma regra sem
    // fonte lida não entra (AGENTS.md, regras da UE, ponto 3).
    if (vazio(regra.id)) erros.push(`${nome}: sem id`);
    if (!Number.isInteger(regra.versao) || regra.versao < 1) {
      erros.push(`${nome}: versão inválida «${String(regra.versao)}»`);
    }
    // Vindo de fora, a `base` pode faltar, ser null ou ser um texto (revisão
    // do #45, P2-3).
    const base: unknown = regra.base;
    if (
      !objecto(base) ||
      vazio(base.url) ||
      vazio(base.titulo) ||
      vazio(base.artigo)
    ) {
      erros.push(`${nome}: fonte incompleta (url, título e artigo)`);
    }
    if (vazio(regra.revistaPor)) erros.push(`${nome}: sem quem reviu`);

    const desde = instante(regra.aplicaDesde);
    if (desde === null) {
      erros.push(`${nome}: aplicaDesde inválido «${regra.aplicaDesde}»`);
    }
    const ate = regra.aplicaAte === null ? null : instante(regra.aplicaAte);
    if (regra.aplicaAte !== null && ate === null) {
      erros.push(`${nome}: aplicaAte inválido «${regra.aplicaAte}»`);
    }
    if (desde !== null && ate !== null && ate <= desde) {
      erros.push(`${nome}: aplicaAte não é depois de aplicaDesde`);
    }
    // O estado legal pela positiva: uma gralha não pode passar por em vigor
    // (revisão do #45, P1-1).
    if (!ESTADOS_LEGAIS.includes(regra.estadoLegal)) {
      erros.push(`${nome}: estado legal desconhecido «${regra.estadoLegal}»`);
    }
    if (regra.estadoLegal === "revogada" && regra.aplicaAte === null) {
      erros.push(`${nome}: revogada sem aplicaAte`);
    }
    if (instante(regra.verificadaEm) === null) {
      erros.push(`${nome}: verificadaEm inválido «${regra.verificadaEm}»`);
    }

    const perfil = registo.paises.find((p) => p.codigo === regra.pais);
    if (perfil === undefined) {
      erros.push(`${nome}: país ${regra.pais} sem perfil`);
      continue;
    }
    // Só os 11 e só chaves próprias, para listar o erro em vez de rebentar
    // (revisão do #40, P2-1; revisão do #45, P2-2).
    const dominiosDoPerfil: unknown = perfil.dominios;
    const revisao =
      objecto(dominiosDoPerfil) &&
      Object.hasOwn(dominiosDoPerfil, regra.dominio)
        ? dominiosDoPerfil[regra.dominio]
        : undefined;
    if (!DOMINIOS.includes(regra.dominio)) {
      erros.push(`${nome}: domínio desconhecido ${regra.dominio}`);
    } else if (!objecto(revisao) || revisao["estado"] !== "verificado") {
      erros.push(
        `${nome}: o domínio ${regra.dominio} de ${regra.pais} não está verificado`,
      );
    }
    const territorios: unknown = regra.territorios;
    if (!Array.isArray(territorios)) {
      erros.push(`${nome}: «territorios» tem de ser uma lista`);
      continue;
    }
    for (const territorio of regra.territorios) {
      const territoriosDoPerfil: unknown = perfil.territorios;
      const mapeados: readonly unknown[] = Array.isArray(territoriosDoPerfil)
        ? territoriosDoPerfil
        : [];
      if (!mapeados.includes(territorio)) {
        erros.push(
          `${nome}: território ${territorio} não mapeado em ${regra.pais}`,
        );
      }
    }
  }

  // Uma `id` é de um país e de um domínio, em todas as versões, propostas
  // incluídas (tipos.ts; revisão do #45, P2-4).
  const dono = new Map<string, Registo["regras"][number]>();
  const misturas = new Set<string>();
  for (const regra of registo.regras) {
    const primeira = dono.get(regra.id);
    if (primeira === undefined) {
      dono.set(regra.id, regra);
    } else if (
      primeira.pais !== regra.pais ||
      primeira.dominio !== regra.dominio
    ) {
      misturas.add(
        `${regra.id}: a mesma id em ${primeira.pais}/${primeira.dominio} e ${regra.pais}/${regra.dominio}`,
      );
    }
  }
  erros.push(...misturas);

  // Duas versões da mesma regra não podem valer ao mesmo tempo. Uma proposta
  // nunca conta em decidir.ts, por isso fica de fora: registar a proposta ao
  // lado da versão em vigor é o uso previsto (revisão do #40, P2-3).
  const porId = new Map<string, Registo["regras"][number][]>();
  for (const regra of registo.regras) {
    if (regra.estadoLegal === "proposta") continue;
    porId.set(regra.id, [...(porId.get(regra.id) ?? []), regra]);
  }
  for (const [id, versoes] of porId) {
    for (let i = 0; i < versoes.length; i++) {
      for (let j = i + 1; j < versoes.length; j++) {
        const a = versoes[i];
        const b = versoes[j];
        if (a === undefined || b === undefined || a.versao === b.versao)
          continue;
        const aDesde = instante(a.aplicaDesde);
        const bDesde = instante(b.aplicaDesde);
        if (aDesde === null || bDesde === null) continue;
        const aAte = a.aplicaAte === null ? Infinity : instante(a.aplicaAte);
        const bAte = b.aplicaAte === null ? Infinity : instante(b.aplicaAte);
        if (aAte === null || bAte === null) continue;
        if (aDesde < bAte && bDesde < aAte) {
          erros.push(
            `${id}: as versões ${String(a.versao)} e ${String(b.versao)} valem ao mesmo tempo`,
          );
        }
      }
    }
  }

  return erros;
}

/** Lança com a lista completa de erros; chamado ao criar a aplicação. */
export function assegurarRegistoValido(registo: Registo): void {
  const erros = errosDoRegisto(registo);
  if (erros.length > 0) {
    throw new Error(
      `Registo de regras inválido (versão ${String(registo.versao)}):\n- ${erros.join("\n- ")}`,
    );
  }
}
