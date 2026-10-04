import { instante } from "./instante.js";
import {
  CODIGOS_UE,
  DOMINIOS_CONDICIONAIS,
  DOMINIOS_OBRIGATORIOS,
  type Regra,
  type Registo,
  type RevisaoDominio,
} from "./tipos.js";

const DOMINIOS: readonly string[] = [
  ...DOMINIOS_OBRIGATORIOS,
  ...DOMINIOS_CONDICIONAIS,
];

const ESTADOS_DE_REVISAO: readonly string[] = [
  "por_verificar",
  "verificado",
  "nao_aplicavel",
];

const ESTADOS_LEGAIS: readonly string[] = [
  "em_vigor",
  "adoptada_futura",
  "proposta",
  "revogada",
];

/**
 * É uma lista? Sem estreitar o tipo: o `Array.isArray` sobre uma lista só de
 * leitura dá `any[]` e apaga os tipos dos elementos.
 */
function ehLista(valor: unknown): boolean {
  return Array.isArray(valor);
}

function vazio(texto: unknown): boolean {
  return typeof texto !== "string" || texto.trim() === "";
}

/**
 * Lista os erros de um registo (revisão do #37, P1-2: nada falha em
 * silêncio). Vazia = registo coerente. Não diz se as regras estão certas —
 * isso é a revisão humana com a fonte —, só se o registo é consistente.
 * Aceita o que vier (também um objecto sem tipos, da base ou de um ficheiro):
 * um campo com a forma errada é um erro na lista, não uma excepção
 * (revisão do #40, P2-1).
 */
export function errosDoRegisto(registo: Registo): string[] {
  const erros: string[] = [];

  if (!Number.isInteger(registo.versao) || registo.versao < 1) {
    erros.push(`versão do registo inválida: ${String(registo.versao)}`);
  }
  if (!ehLista(registo.paises)) {
    erros.push("«paises» não é uma lista");
  }
  if (!ehLista(registo.regras)) {
    erros.push("«regras» não é uma lista");
  }
  if (!ehLista(registo.paises) || !ehLista(registo.regras)) {
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
    if (vazio(perfil.nome)) erros.push(`${perfil.codigo}: sem nome`);
    if (perfil.territorios !== null && !ehLista(perfil.territorios)) {
      erros.push(`${perfil.codigo}: «territorios» não é null nem uma lista`);
    }
    const dominios: unknown = perfil.dominios;
    if (typeof dominios !== "object" || dominios === null) {
      erros.push(`${perfil.codigo}: «dominios» não é um objecto`);
      continue;
    }
    const chaves = Object.keys(dominios);
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
    for (const [dominio, revisao] of Object.entries<RevisaoDominio>(
      perfil.dominios,
    )) {
      const sitio = `${perfil.codigo}/${dominio}`;
      const estado: unknown = revisao.estado;
      if (!ESTADOS_DE_REVISAO.includes(estado as string)) {
        // Revisão do #40, P1-1: uma gralha no estado não pode passar.
        erros.push(
          `${sitio}: estado de revisão desconhecido «${String(estado)}»`,
        );
        continue;
      }
      if (revisao.estado === "verificado") {
        if (instante(revisao.verificadoEm) === null) {
          erros.push(
            `${sitio}: data de verificação inválida «${revisao.verificadoEm}»`,
          );
        }
        if (vazio(revisao.revistoPor)) erros.push(`${sitio}: sem revistoPor`);
      }
      if (revisao.estado === "nao_aplicavel") {
        if (vazio(revisao.justificacao) || vazio(revisao.prova)) {
          erros.push(`${sitio}: «não aplicável» sem justificação ou sem prova`);
        }
        if (vazio(revisao.revistoPor)) erros.push(`${sitio}: sem revistoPor`);
      }
    }
  }

  const vistas = new Set<string>();
  for (const regra of registo.regras) {
    const nome = `${regra.id}@${String(regra.versao)}`;
    if (vistas.has(nome)) erros.push(`${nome}: repetida`);
    vistas.add(nome);

    // A prova de uma regra não pode estar vazia (AGENTS.md, regras da UE,
    // ponto 3: uma regra só entra com fonte; revisão do #40, P2-5).
    if (vazio(regra.id)) erros.push(`${nome}: sem id`);
    if (!Number.isInteger(regra.versao) || regra.versao < 1) {
      erros.push(`${nome}: versão inválida`);
    }
    if (!ESTADOS_LEGAIS.includes(regra.estadoLegal)) {
      erros.push(`${nome}: estado legal desconhecido «${regra.estadoLegal}»`);
    }
    const base: unknown = regra.base;
    if (typeof base !== "object" || base === null) {
      erros.push(`${nome}: sem base legal`);
    } else {
      if (vazio(regra.base.url)) erros.push(`${nome}: base sem url`);
      if (vazio(regra.base.titulo)) erros.push(`${nome}: base sem título`);
      if (vazio(regra.base.artigo)) erros.push(`${nome}: base sem artigo`);
    }
    if (vazio(regra.revistaPor)) erros.push(`${nome}: sem revistaPor`);
    if (!ehLista(regra.territorios)) {
      erros.push(`${nome}: «territorios» não é uma lista`);
    }

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
    const revisao = Object.hasOwn(perfil.dominios, regra.dominio)
      ? (perfil.dominios as Record<string, RevisaoDominio>)[regra.dominio]
      : undefined;
    if (revisao === undefined) {
      erros.push(`${nome}: domínio desconhecido ${regra.dominio}`);
    } else if (revisao.estado !== "verificado") {
      erros.push(
        `${nome}: o domínio ${regra.dominio} de ${regra.pais} não está verificado`,
      );
    }
    if (ehLista(regra.territorios)) {
      for (const territorio of regra.territorios) {
        if (!(perfil.territorios ?? []).includes(territorio)) {
          erros.push(
            `${nome}: território ${territorio} não mapeado em ${regra.pais}`,
          );
        }
      }
    }
  }

  // Duas versões da mesma regra não podem valer ao mesmo tempo. Uma
  // `proposta` nunca conta (decidir.ts), por isso pode viver ao lado da versão
  // em vigor (revisão do #40, P2-3).
  const porId = new Map<string, Regra[]>();
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
