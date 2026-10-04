import { instante } from "./instante.js";
import {
  DOMINIOS,
  type Decisao,
  type Motivo,
  type PedidoDecisao,
  type PerfilPais,
  type Regra,
  type Registo,
  type RevisaoDominio,
} from "./tipos.js";

/**
 * Os estados legais que podem contar, pela positiva: uma gralha, um estado em
 * falta ou uma «Proposta» com maiúscula não contam (revisão do #45, P1-1).
 */
const ESTADOS_QUE_CONTAM: readonly string[] = [
  "em_vigor",
  "adoptada_futura",
  "revogada",
];

/**
 * Uma regra conta no momento pedido? Uma proposta nunca conta; o intervalo é
 * [aplicaDesde, aplicaAte). Uma data inválida dá «não conta» — o lado seguro;
 * o registo é validado ao carregar (validar.ts), para isto não ficar em
 * silêncio.
 */
function regraEmVigor(regra: Regra, momento: number): boolean {
  if (!ESTADOS_QUE_CONTAM.includes(regra.estadoLegal)) return false;
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

function regraDoTerritorio(
  regra: Regra,
  territorio: string | undefined,
): boolean {
  // Uma regra sem lista de territórios não conta: um texto vazio não é «sem
  // território» (revisão do #45, P2-2).
  const territorios: unknown = regra.territorios;
  if (!Array.isArray(territorios)) return false;
  if (territorio === undefined) return territorios.length === 0;
  return regra.territorios.includes(territorio);
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
 * Decide uma combinação (país, território, domínios, momento) contra um
 * registo. Função pura: a mesma entrada e o mesmo registo dão sempre a mesma
 * decisão, e a decisão guarda a versão do registo usada. Um bloqueio vale só
 * para a combinação pedida. **Nunca sai «permitido» sem pelo menos uma regra
 * aplicada** (revisão do #37, P0-1).
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

  // O tipo já exige um domínio, mas o pedido pode vir de fora sem tipos: sem
  // lista, lista vazia ou um texto no lugar da lista são «sem domínios».
  const dominios: unknown = pedido.dominios;
  if (!Array.isArray(dominios) || dominios.length === 0) {
    return recusado(versao, { codigo: "sem_dominios" });
  }
  const dominiosDoPerfil: unknown = perfil.dominios;
  for (const dominio of pedido.dominios) {
    // Só os 11 e só chaves próprias: «constructor» ou «__proto__» existem em
    // qualquer objecto (revisão do #40, P2-2), e um domínio a mais no perfil
    // não passa a valer (revisão do #45, P2-1).
    if (
      !DOMINIOS.includes(dominio) ||
      typeof dominiosDoPerfil !== "object" ||
      dominiosDoPerfil === null ||
      !Object.hasOwn(dominiosDoPerfil, dominio)
    ) {
      return recusado(versao, { codigo: "dominio_desconhecido", dominio });
    }
  }

  const motivos: Motivo[] = [];
  const regrasAplicadas: string[] = [];

  // Só uma lista mapeia territórios: um texto faria do `includes` uma
  // pesquisa de subtexto (revisão do #45, segunda volta, P1-1).
  const territoriosDoPerfil: unknown = perfil.territorios;
  const mapeados: readonly unknown[] = Array.isArray(territoriosDoPerfil)
    ? territoriosDoPerfil
    : [];
  const territorioMapeado =
    pedido.territorio === undefined || mapeados.includes(pedido.territorio);
  if (!territorioMapeado && pedido.territorio !== undefined) {
    motivos.push({
      codigo: "territorio_nao_mapeado",
      territorio: pedido.territorio,
    });
  }

  for (const dominio of new Set(pedido.dominios)) {
    // Alargado de propósito: vindo de fora, a revisão pode ser null.
    const revisao = perfil.dominios[dominio] as RevisaoDominio | null;
    if (revisao?.estado === "nao_aplicavel") continue;
    // Só «verificado» segue para as regras. Um estado que não se conhece
    // trata-se como por verificar: a decisão não pode depender de o registo
    // ter passado pelo validar.ts (revisão do #40, P1-1).
    if (revisao?.estado !== "verificado") {
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
