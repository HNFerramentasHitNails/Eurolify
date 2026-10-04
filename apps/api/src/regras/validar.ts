import { instante } from "./instante.js";
import {
  CODIGOS_UE,
  DOMINIOS_CONDICIONAIS,
  DOMINIOS_OBRIGATORIOS,
  type Registo,
  type RevisaoDominio,
} from "./tipos.js";

const DOMINIOS: readonly string[] = [
  ...DOMINIOS_OBRIGATORIOS,
  ...DOMINIOS_CONDICIONAIS,
];

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
    const chaves = Object.keys(perfil.dominios);
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
      if (
        revisao.estado === "verificado" &&
        instante(revisao.verificadoEm) === null
      ) {
        erros.push(
          `${perfil.codigo}/${dominio}: data de verificação inválida «${revisao.verificadoEm}»`,
        );
      }
      if (
        revisao.estado === "nao_aplicavel" &&
        (revisao.justificacao.trim() === "" || revisao.prova.trim() === "")
      ) {
        erros.push(
          `${perfil.codigo}/${dominio}: «não aplicável» sem justificação ou sem prova`,
        );
      }
    }
  }

  const vistas = new Set<string>();
  for (const regra of registo.regras) {
    const nome = `${regra.id}@${String(regra.versao)}`;
    if (vistas.has(nome)) erros.push(`${nome}: repetida`);
    vistas.add(nome);

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
    if (perfil.dominios[regra.dominio].estado !== "verificado") {
      erros.push(
        `${nome}: o domínio ${regra.dominio} de ${regra.pais} não está verificado`,
      );
    }
    for (const territorio of regra.territorios) {
      if (!(perfil.territorios ?? []).includes(territorio)) {
        erros.push(
          `${nome}: território ${territorio} não mapeado em ${regra.pais}`,
        );
      }
    }
  }

  // Duas versões da mesma regra não podem valer ao mesmo tempo.
  const porId = new Map<string, Registo["regras"][number][]>();
  for (const regra of registo.regras) {
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
