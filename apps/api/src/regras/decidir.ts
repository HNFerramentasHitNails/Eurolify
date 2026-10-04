import type {
  Decisao,
  Motivo,
  PedidoDecisao,
  PerfilPais,
  Regra,
  Registo,
} from "./tipos.js";

/** Uma regra conta no momento pedido? Uma proposta nunca conta. */
function regraEmVigor(regra: Regra, momento: number): boolean {
  if (regra.estadoLegal === "proposta") return false;
  const desde = Date.parse(regra.aplicaDesde);
  if (Number.isNaN(desde) || momento < desde) return false;
  if (regra.aplicaAte !== null) {
    const ate = Date.parse(regra.aplicaAte);
    if (Number.isNaN(ate) || momento >= ate) return false;
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

/**
 * Decide uma combinação (país, território, domínios, momento) contra um
 * registo. Função pura: a mesma entrada e o mesmo registo dão sempre a mesma
 * decisão, e a decisão guarda a versão do registo usada. Um bloqueio vale só
 * para a combinação pedida.
 */
export function decidir(registo: Registo, pedido: PedidoDecisao): Decisao {
  const base = {
    regrasAplicadas: [] as string[],
    versaoRegisto: registo.versao,
  };

  const perfil: PerfilPais | undefined = registo.paises.find(
    (p) => p.codigo === pedido.pais,
  );
  if (perfil === undefined) {
    return {
      ...base,
      estado: "recusado",
      motivos: [{ codigo: "pais_fora_da_ue", pais: pedido.pais }],
    };
  }

  const momento = Date.parse(pedido.momento);
  if (Number.isNaN(momento)) {
    return {
      ...base,
      estado: "recusado",
      motivos: [{ codigo: "momento_invalido", momento: pedido.momento }],
    };
  }

  const motivos: Motivo[] = [];
  const regrasAplicadas: string[] = [];

  if (
    pedido.territorio !== undefined &&
    !(perfil.territorios ?? []).includes(pedido.territorio)
  ) {
    motivos.push({
      codigo: "territorio_nao_mapeado",
      territorio: pedido.territorio,
    });
  }

  for (const dominio of new Set(pedido.dominios)) {
    const revisao = perfil.dominios[dominio];
    if (revisao.estado === "nao_aplicavel") continue;
    if (revisao.estado === "por_verificar") {
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
    for (const regra of emVigor)
      regrasAplicadas.push(`${regra.id}@${String(regra.versao)}`);
  }

  return {
    estado: motivos.length === 0 ? "permitido" : "revisao_necessaria",
    regrasAplicadas,
    versaoRegisto: registo.versao,
    motivos,
  };
}
