import { instante } from "./instante.js";
import type {
  Decisao,
  EstadoLegal,
  Motivo,
  PedidoDecisao,
  PerfilPais,
  Regra,
  Registo,
  RevisaoDominio,
} from "./tipos.js";

/** Os estados legais que podem contar; `proposta` e o que não existe, nunca. */
const ESTADOS_QUE_CONTAM = [
  "em_vigor",
  "adoptada_futura",
  "revogada",
] as const satisfies readonly EstadoLegal[];

/**
 * Uma regra conta no momento pedido? Lista de aceitação, não de exclusão
 * (revisão do #47, P1): só `em_vigor`, `adoptada_futura` e `revogada` com
 * fim podem contar; uma proposta, uma gralha ou um estado em falta não
 * contam. O intervalo é [aplicaDesde, aplicaAte). Uma data inválida dá «não
 * conta» — o lado seguro; o registo é validado ao carregar (validar.ts), para
 * isto não ficar em silêncio.
 */
function regraEmVigor(regra: Regra, momento: number): boolean {
  if (!(ESTADOS_QUE_CONTAM as readonly string[]).includes(regra.estadoLegal))
    return false;
  const desde = instante(regra.aplicaDesde);
  if (desde === null || momento < desde) return false;
  if (regra.aplicaAte !== null) {
    const ate = instante(regra.aplicaAte);
    if (ate === null || momento >= ate) return false;
  } else if (regra.estadoLegal === "revogada") {
    // Revogada sem data de fim: não se sabe desde quando — não conta.
    return false;
  }
  return true;
}

/**
 * A regra vale para o território pedido? Uma lista que não é lista não conta:
 * um texto faria `includes` por pedaço de texto (`"PT-MA"` contém `"MA"`)
 * (revisão do #47, 2.ª, P2-A).
 */
function regraDoTerritorio(
  regra: Regra,
  territorio: string | undefined,
): boolean {
  const territorios: unknown = regra.territorios;
  if (!Array.isArray(territorios)) return false;
  if (territorio === undefined) return territorios.length === 0;
  return (territorios as readonly unknown[]).includes(territorio);
}

function recusado(versaoRegisto: number, motivo: Motivo): Decisao {
  return {
    estado: "recusado",
    regrasAplicadas: [],
    versaoRegisto,
    motivos: [motivo],
  };
}

/**
 * A revisão de um domínio no perfil, ou undefined se o domínio não existir.
 * Só chaves próprias: `constructor` ou `__proto__` não são domínios (revisão
 * do #40, P2-2).
 */
function revisaoDoDominio(
  perfil: PerfilPais,
  dominio: string,
): RevisaoDominio | undefined {
  return Object.hasOwn(perfil.dominios, dominio)
    ? (perfil.dominios as Record<string, RevisaoDominio>)[dominio]
    : undefined;
}

/**
 * Decide uma combinação (país, território, domínios, momento) contra um
 * registo. Função pura: a mesma entrada e o mesmo registo dão sempre a mesma
 * decisão, e a decisão guarda a versão do registo usada. Um bloqueio vale só
 * para a combinação pedida. **Nunca sai «permitido» sem pelo menos uma regra
 * aplicada** (revisão do #37, P0-1).
 *
 * Assume um registo validado (validar.ts, chamado por `criarApp`), com duas
 * excepções que se defendem aqui mesmo sem validação: o estado da revisão do
 * domínio e o estado legal da regra — só os valores conhecidos que permitem
 * contam — e os territórios da regra, que só contam se forem uma lista. Fora
 * destes três campos, o `decidir` não se defende sozinho: um registo que não
 * passou pelo `validar` pode dar uma excepção ou uma decisão errada (revisão
 * do #47, P2 n.º 3, e 2.ª revisão, P2-A).
 */
export function decidir(registo: Registo, pedido: PedidoDecisao): Decisao {
  const versao = registo.versao;

  if (!/^[A-Z]{2}$/.test(pedido.pais)) {
    return recusado(versao, {
      codigo: "codigo_pais_invalido",
      pais: pedido.pais,
    });
  }
  const perfil: PerfilPais | undefined = registo.paises.find(
    (p) => p.codigo === pedido.pais,
  );
  if (perfil === undefined) {
    return recusado(versao, { codigo: "pais_fora_da_ue", pais: pedido.pais });
  }

  const momento = instante(pedido.momento);
  if (momento === null) {
    return recusado(versao, {
      codigo: "momento_invalido",
      momento: pedido.momento,
    });
  }

  // O tipo já exige uma lista com um domínio, mas o pedido pode vir de fora
  // sem tipos: null, texto ou lista vazia são «sem domínios».
  const dominios: unknown = pedido.dominios;
  if (!Array.isArray(dominios) || dominios.length === 0) {
    return recusado(versao, { codigo: "sem_dominios" });
  }
  for (const dominio of dominios as readonly unknown[]) {
    if (
      typeof dominio !== "string" ||
      revisaoDoDominio(perfil, dominio) === undefined
    ) {
      return recusado(versao, {
        codigo: "dominio_desconhecido",
        dominio: typeof dominio === "string" ? dominio : String(dominio),
      });
    }
  }

  const motivos: Motivo[] = [];
  const regrasAplicadas: string[] = [];

  const territorioMapeado =
    pedido.territorio === undefined ||
    (perfil.territorios ?? []).includes(pedido.territorio);
  if (!territorioMapeado && pedido.territorio !== undefined) {
    motivos.push({
      codigo: "territorio_nao_mapeado",
      territorio: pedido.territorio,
    });
  }

  for (const dominio of new Set(pedido.dominios)) {
    const revisao = perfil.dominios[dominio];
    if (revisao.estado === "nao_aplicavel") continue;
    // Só «verificado» segue para as regras. Qualquer outro estado — o
    // `por_verificar` ou um estado que não existe (gralha num registo que não
    // passou pelo validar) — bloqueia (revisão do #40, P1-1).
    if (revisao.estado !== "verificado") {
      motivos.push({ codigo: "dominio_por_verificar", dominio });
      continue;
    }
    const emVigor = registo.regras.filter(
      (regra) =>
        regra.pais === perfil.codigo &&
        regra.dominio === dominio &&
        regraDoTerritorio(regra, pedido.territorio) &&
        regraEmVigor(regra, momento),
    );
    if (emVigor.length === 0) {
      motivos.push({ codigo: "sem_regra_em_vigor", dominio });
      continue;
    }
    // Num território não mapeado nenhuma regra se dá como aplicada.
    if (territorioMapeado) {
      for (const regra of emVigor)
        regrasAplicadas.push(`${regra.id}@${String(regra.versao)}`);
    }
  }

  if (motivos.length === 0 && regrasAplicadas.length === 0) {
    motivos.push({ codigo: "sem_regra_aplicada" });
  }

  return {
    estado: motivos.length === 0 ? "permitido" : "revisao_necessaria",
    regrasAplicadas,
    versaoRegisto: versao,
    motivos,
  };
}
