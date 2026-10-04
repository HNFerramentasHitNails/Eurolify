import { instante } from "./instante.js";
import type {
  Decisao,
  Motivo,
  PedidoDecisao,
  PerfilPais,
  Regra,
  Registo,
} from "./tipos.js";

/**
 * Uma regra conta no momento pedido? Uma proposta nunca conta; o intervalo é
 * [aplicaDesde, aplicaAte). Uma data inválida dá «não conta» — o lado seguro;
 * o registo é validado ao carregar (validar.ts), para isto não ficar em
 * silêncio.
 */
function regraEmVigor(regra: Regra, momento: number): boolean {
  if (regra.estadoLegal === "proposta") return false;
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
  if (territorio === undefined) return regra.territorios.length === 0;
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
  for (const dominio of pedido.dominios) {
    // Só chaves próprias: «constructor» ou «__proto__» existem em qualquer
    // objecto e passavam por domínio (revisão do #40, P2-2).
    if (!Object.hasOwn(perfil.dominios, dominio)) {
      return recusado(versao, { codigo: "dominio_desconhecido", dominio });
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
    // Só «verificado» segue para as regras. Um estado que não se conhece
    // trata-se como por verificar: a decisão não pode depender de o registo
    // ter passado pelo validar.ts (revisão do #40, P1-1).
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
