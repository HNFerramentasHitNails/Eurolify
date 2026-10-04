import { instante } from "./instante.js";
import { tipo, valor } from "./mostrar.js";
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

/** É um objecto (não null)? Sem estreitar o tipo, pela mesma razão. */
function ehObjecto(valor: unknown): boolean {
  return typeof valor === "object" && valor !== null;
}

/**
 * Formato da `id` de uma regra: minúsculas, algarismos, «.», «_» e «-», a
 * começar por letra ou algarismo. Assim «R», «r », «a  b» ou «ı» não podem
 * parecer a mesma `id` que outra e não ser (revisões do #50, P2-1 e P2-A).
 */
const FORMATO_ID = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Uma `id` entre aspas, com o que não é ASCII visível escrito em `\uXXXX`:
 * um espaço invisível ou um «ı» vêem-se na mensagem (revisão do #50, P2-2).
 */
function mostrarId(id: string): string {
  return JSON.stringify(id).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
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
    erros.push(`versão do registo inválida: ${valor(registo.versao)}`);
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

  // Um elemento que não é objecto (null, texto, número) é listado e posto de
  // parte, para a lista de erros sair completa (revisão do #47, P2 n.º 1).
  const paises = registo.paises.filter((perfil, i) => {
    if (ehObjecto(perfil)) return true;
    erros.push(`paises[${String(i)}] não é um objecto`);
    return false;
  });
  const regras = registo.regras.filter((regra, i) => {
    if (ehObjecto(regra)) return true;
    erros.push(`regras[${String(i)}] não é um objecto`);
    return false;
  });

  const codigos = paises.map((p) => p.codigo as string);
  for (const codigo of CODIGOS_UE) {
    const vezes = codigos.filter((c) => c === codigo).length;
    if (vezes !== 1)
      erros.push(`país ${codigo} aparece ${String(vezes)} vezes`);
  }
  for (const codigo of codigos) {
    if (!(CODIGOS_UE as readonly string[]).includes(codigo)) {
      erros.push(`país ${valor(codigo)} não é um dos 27`);
    }
  }

  for (const perfil of paises) {
    if (vazio(perfil.nome)) erros.push(`${valor(perfil.codigo)}: sem nome`);
    if (perfil.territorios !== null && !ehLista(perfil.territorios)) {
      erros.push(
        `${valor(perfil.codigo)}: «territorios» não é null nem uma lista`,
      );
    }
    const dominios: unknown = perfil.dominios;
    if (typeof dominios !== "object" || dominios === null) {
      erros.push(`${valor(perfil.codigo)}: «dominios» não é um objecto`);
      continue;
    }
    const chaves = Object.keys(dominios);
    for (const dominio of DOMINIOS) {
      if (!chaves.includes(dominio)) {
        erros.push(`${valor(perfil.codigo)}: falta o domínio ${dominio}`);
      }
    }
    for (const chave of chaves) {
      if (!DOMINIOS.includes(chave)) {
        erros.push(`${valor(perfil.codigo)}: domínio desconhecido ${chave}`);
      }
    }
    for (const [dominio, revisao] of Object.entries<RevisaoDominio>(
      perfil.dominios,
    )) {
      const sitio = `${valor(perfil.codigo)}/${dominio}`;
      if (!ehObjecto(revisao)) {
        erros.push(`${sitio}: a revisão não é um objecto`);
        continue;
      }
      const estado: unknown = revisao.estado;
      if (!ESTADOS_DE_REVISAO.includes(estado as string)) {
        // Revisão do #40, P1-1: uma gralha no estado não pode passar.
        erros.push(
          `${sitio}: estado de revisão desconhecido «${valor(estado)}»`,
        );
        continue;
      }
      if (revisao.estado === "verificado") {
        if (instante(revisao.verificadoEm) === null) {
          erros.push(
            `${sitio}: data de verificação inválida «${valor(revisao.verificadoEm)}»`,
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
  // Uma `id` fora do formato diz-se uma vez, não uma por versão (revisão do
  // #50, P2-1).
  const idsForaDoFormato = new Set<string>();
  for (const regra of regras) {
    // Como a `id` aparece em todas as mensagens dela (revisões do #50):
    // dentro do formato, tal como é; em texto fora do formato, vazia incluída,
    // entre aspas e escapada («""», espaços que não se vêem); se não for
    // texto, entre parênteses com o tipo — `5` não se confunde com `"5"` e um
    // `Symbol` não rebenta a lista.
    const id: unknown = regra.id;
    let mostrada: string;
    let foraDoFormato = false;
    if (typeof id !== "string") {
      // Entre parênteses com o tipo, em português: «(número: 5)», «(nulo)»,
      // «(lista)» (revisão do #50, P2-4).
      const comValor =
        typeof id === "number" ||
        typeof id === "boolean" ||
        typeof id === "bigint" ||
        typeof id === "symbol";
      mostrada = comValor ? `(${tipo(id)}: ${valor(id)})` : `(${tipo(id)})`;
    } else if (FORMATO_ID.test(id)) {
      mostrada = id;
    } else {
      // Vazia incluída: o «sem id» é testado antes e ganha (revisão do #50,
      // P2-B).
      mostrada = mostrarId(id);
      foraDoFormato = true;
    }
    const nome = `${mostrada}@${valor(regra.versao)}`;
    if (vistas.has(nome)) erros.push(`${nome}: repetida`);
    vistas.add(nome);

    // A prova de uma regra não pode estar vazia (AGENTS.md, regras da UE,
    // ponto 3: uma regra só entra com fonte; revisão do #40, P2-5).
    if (vazio(regra.id)) erros.push(`${nome}: sem id`);
    else if (foraDoFormato && !idsForaDoFormato.has(regra.id)) {
      idsForaDoFormato.add(regra.id);
      erros.push(`${nome}: id fora do formato (a-z, 0-9, «.», «_», «-»)`);
    }
    if (!Number.isInteger(regra.versao) || regra.versao < 1) {
      erros.push(`${nome}: versão inválida`);
    }
    if (!ESTADOS_LEGAIS.includes(regra.estadoLegal)) {
      erros.push(
        `${nome}: estado legal desconhecido «${valor(regra.estadoLegal)}»`,
      );
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
      erros.push(`${nome}: aplicaDesde inválido «${valor(regra.aplicaDesde)}»`);
    }
    const ate = regra.aplicaAte === null ? null : instante(regra.aplicaAte);
    if (regra.aplicaAte !== null && ate === null) {
      erros.push(`${nome}: aplicaAte inválido «${valor(regra.aplicaAte)}»`);
    }
    if (desde !== null && ate !== null && ate <= desde) {
      erros.push(`${nome}: aplicaAte não é depois de aplicaDesde`);
    }
    if (regra.estadoLegal === "revogada" && regra.aplicaAte === null) {
      erros.push(`${nome}: revogada sem aplicaAte`);
    }
    if (instante(regra.verificadaEm) === null) {
      erros.push(
        `${nome}: verificadaEm inválido «${valor(regra.verificadaEm)}»`,
      );
    }

    const perfil = paises.find((p) => p.codigo === regra.pais);
    if (perfil === undefined) {
      erros.push(`${nome}: país ${valor(regra.pais)} sem perfil`);
      continue;
    }
    // Só um domínio em texto se procura no perfil: um objecto sem protótipo
    // como chave rebentava o hasOwn (revisão do #50, P2-A).
    const dominioDaRegra: unknown = regra.dominio;
    const revisao: unknown =
      typeof dominioDaRegra === "string" &&
      ehObjecto(perfil.dominios) &&
      Object.hasOwn(perfil.dominios, dominioDaRegra)
        ? (perfil.dominios as Record<string, unknown>)[dominioDaRegra]
        : undefined;
    if (revisao === undefined) {
      erros.push(`${nome}: domínio desconhecido ${valor(regra.dominio)}`);
    } else if (
      !ehObjecto(revisao) ||
      (revisao as RevisaoDominio).estado !== "verificado"
    ) {
      erros.push(
        `${nome}: o domínio ${valor(regra.dominio)} de ${valor(regra.pais)} não está verificado`,
      );
    }
    if (ehLista(regra.territorios)) {
      for (const territorio of regra.territorios) {
        if (!(perfil.territorios ?? []).includes(territorio)) {
          erros.push(
            `${nome}: território ${valor(territorio)} não mapeado em ${valor(regra.pais)}`,
          );
        }
      }
    }
  }

  // Duas versões da mesma regra não podem valer ao mesmo tempo. Uma
  // `proposta` nunca conta (decidir.ts), por isso pode viver ao lado da versão
  // em vigor (revisão do #40, P2-3).
  // Uma regra sem `id`, ou com uma `id` fora do formato, já tem o seu erro;
  // não entra nos testes por `id`.
  const porId = new Map<string, Regra[]>();
  for (const regra of regras) {
    if (vazio(regra.id) || !FORMATO_ID.test(regra.id)) continue;
    porId.set(regra.id, [...(porId.get(regra.id) ?? []), regra]);
  }
  for (const [id, todas] of porId) {
    // A `id` é uma regra de um país e de um domínio (§4.1), propostas
    // incluídas (revisão do #45, P2-4).
    const lugares = new Set(
      todas.map((r) => `${valor(r.pais)}/${valor(r.dominio)}`),
    );
    if (lugares.size > 1) {
      erros.push(`${id}: a mesma id em ${[...lugares].join(" e ")}`);
    }
    const versoes = todas.filter((r) => r.estadoLegal !== "proposta");
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
            `${id}: as versões ${valor(a.versao)} e ${valor(b.versao)} valem ao mesmo tempo`,
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
      `Registo de regras inválido (versão ${valor(registo.versao)}):\n- ${erros.join("\n- ")}`,
    );
  }
}
