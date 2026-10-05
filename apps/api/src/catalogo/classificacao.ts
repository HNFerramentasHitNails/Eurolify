import {
  FAMILIAS_RESTRITAS,
  FAMILIAS_SETORIAIS,
  NATUREZAS_DO_TIPO,
  type FamiliaSetorial,
  type Modo,
  type NaturezaConsumidor,
  type TipoArtigo,
} from "../base/esquema.js";

// A classificação do artigo (docs/14 §3.10, «Classificação do artigo»;
// migração 0006). A base recusa as combinações que o desenho não admite;
// aqui ficam os impedimentos que a verificação «pode publicar?» (C2) vai
// pedir quando a publicação existir (parte 4 do #77): «sem classificação
// não se publica».

/** O que o comerciante declara ao classificar um artigo. */
export interface Classificacao {
  familias: readonly FamiliaSetorial[];
  natureza_consumidor: NaturezaConsumidor | null;
  modo?: Modo | null;
  /** Instantes; vão juntos. */
  prestacao_inicio?: Date | null;
  prestacao_fim?: Date | null;
  /** Um dos 27 (ISO 3166-1; a Grécia é GR). */
  local_pais?: string | null;
  local_territorio?: string | null;
  /** Só num `acesso_com_data`; por omissão, não. */
  lazer_com_data?: boolean;
}

/** O que a função lê do artigo. */
export interface ArtigoClassificado {
  tipo: TipoArtigo;
  familias: readonly string[];
  natureza_consumidor: string | null;
  modo: string | null;
  prestacao_inicio: Date | null;
  prestacao_fim: Date | null;
  local_pais: string | null;
}

export type ImpedimentoClassificacao =
  | { codigo: "classificacao_em_falta" }
  | { codigo: "natureza_incompativel" }
  | { codigo: "data_ou_local_em_falta"; falta: ("data" | "local" | "modo")[] }
  | { codigo: "familia_restrita"; familias: string[] };

/**
 * Os impedimentos da classificação para publicar (C2). Lista vazia = a
 * classificação não impede. Lê o que a base guardou; um valor estranho conta
 * como impedimento, nunca como «pode».
 */
export function impedimentosDaClassificacao(
  artigo: ArtigoClassificado,
): ImpedimentoClassificacao[] {
  const impedimentos: ImpedimentoClassificacao[] = [];
  const lidas: unknown = artigo.familias;
  const familias: readonly string[] = Array.isArray(lidas)
    ? lidas.filter((f): f is string => typeof f === "string")
    : [];
  // Uma família que não existe conta como por classificar (revisão do #96,
  // P3-3): só passa o que está na lista.
  if (
    familias.length === 0 ||
    familias.includes("por_classificar") ||
    familias.some(
      (f) => !(FAMILIAS_SETORIAIS as readonly string[]).includes(f),
    ) ||
    artigo.natureza_consumidor === null
  ) {
    impedimentos.push({ codigo: "classificacao_em_falta" });
  }
  const admitidas: readonly string[] =
    (NATUREZAS_DO_TIPO as Readonly<Record<string, readonly string[]>>)[
      artigo.tipo
    ] ?? [];
  if (
    artigo.natureza_consumidor !== null &&
    !admitidas.includes(artigo.natureza_consumidor)
  ) {
    impedimentos.push({ codigo: "natureza_incompativel" });
  }

  const falta: ("data" | "local" | "modo")[] = [];
  const natureza = artigo.natureza_consumidor;
  if (natureza === "acesso_com_data") {
    if (artigo.prestacao_inicio === null || artigo.prestacao_fim === null)
      falta.push("data");
    if (artigo.modo === null) falta.push("modo");
    else if (artigo.modo === "presencial" && artigo.local_pais === null)
      falta.push("local");
  }
  if (natureza === "servico_presencial" && artigo.local_pais === null) {
    falta.push("local");
  }
  // O modo do serviço humano à distância (docs/14 §3.10: obrigatório no
  // acesso com data e no serviço humano; revisão do #96, P2-3). No
  // presencial, o modo é o próprio presencial.
  if (natureza === "servico_humano_a_distancia" && artigo.modo === null) {
    falta.push("modo");
  }
  if (falta.length > 0) {
    impedimentos.push({ codigo: "data_ou_local_em_falta", falta });
  }

  const restritas = familias.filter((f) =>
    (FAMILIAS_RESTRITAS as readonly string[]).includes(f),
  );
  if (restritas.length > 0) {
    impedimentos.push({ codigo: "familia_restrita", familias: restritas });
  }
  return impedimentos;
}
