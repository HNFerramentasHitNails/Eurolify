import {
  ErroHub,
  type CamposMetodoEntrega,
  type MetodoEntrega,
  type ServicoConta,
} from "./api";
import { ErroDoEcra } from "./erros";
import { centimosDoTexto, MONTANTE_MAXIMO } from "./preco";
import type { Textos } from "./textos";

// Apoio dos ecrãs dos métodos de entrega e da embalagem (docs/22 §31). A
// API confere tudo (a conta pronta, o serviço, o país, o peso, o telefone);
// aqui só se evita um pedido que já se sabe recusado e se escolhe o texto.

/** O mesmo formato de prefixo que a API aceita (`CamposEnvios`). */
const PREFIXO = /^[0-9A-Za-z][0-9A-Za-z -]{0,11}$/;
const MAX_PREFIXOS = 200;
export const TARIFA_MAXIMA = 100_000_000;
export const EMBALAGEM_MAXIMA_G = 100_000;
export const PESO_MAXIMO_G = 1_000_000;

/**
 * «1, 2, 3», um por linha, ou com ponto e vírgula → ["1", "2", "3"], sem
 * repetidos. Vazio quer dizer o país todo. `null` quando um não é um
 * prefixo ou são mais de 200.
 */
export function prefixosDoTexto(texto: string): string[] | null {
  const partes = texto
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const unicos = [...new Set(partes)];
  if (unicos.length > MAX_PREFIXOS) return null;
  return unicos.every((p) => PREFIXO.test(p)) ? unicos : null;
}

export const textoDosPrefixos = (prefixos: readonly string[]) =>
  prefixos.join(", ");

/** O nome na língua pedida, senão na principal, senão o primeiro. */
export function nomeNaLingua(
  nomes: Record<string, string>,
  lingua: string,
  principal?: string,
): string {
  return (
    nomes[lingua] ??
    (principal === undefined ? undefined : nomes[principal]) ??
    Object.values(nomes)[0] ??
    ""
  );
}

/** Os métodos por mostrar: de um mercado (ou todos) e os arquivados a pedido. */
export function metodosAMostrar(
  metodos: readonly MetodoEntrega[],
  mercado: string | null,
  comArquivados: boolean,
): MetodoEntrega[] {
  return metodos.filter(
    (m) =>
      (mercado === null || m.mercado === mercado) &&
      (comArquivados || m.estado !== "arquivado"),
  );
}

/**
 * Os serviços de uma conta que entregam em todos os países do mercado: só
 * esses o servidor aceita (docs/36 §3.2). É uma sugestão; quem decide é ele.
 */
export function servicosParaOMercado(
  servicos: readonly ServicoConta[],
  paises: readonly string[],
): ServicoConta[] {
  return servicos.filter((s) => paises.every((p) => s.paises.includes(p)));
}

/** O que se escreve no formulário de um método, como texto. */
export interface FormularioMetodo {
  nome: Record<string, string>;
  prazo: Record<string, string>;
  tarifa: string;
  gratis: string;
  pedeTelefone: boolean;
  conta: string;
  servico: string;
  prazoMaxDias: string;
  prefixos: string;
  pesoMaxG: string;
}

export type CampoMetodo =
  | "nome"
  | "tarifa"
  | "gratis"
  | "servico"
  | "prazoMaxDias"
  | "prefixos"
  | "pesoMaxG";

const inteiro = (texto: string, min: number, max: number): number | null => {
  const limpo = texto.trim();
  if (!/^\d{1,9}$/.test(limpo)) return null;
  const n = Number(limpo);
  return n >= min && n <= max ? n : null;
};

/**
 * Do formulário ao corpo da API, ou o primeiro campo errado com o texto.
 * `principal` é a língua principal do mercado, a única obrigatória.
 */
export function conferirMetodo(
  f: FormularioMetodo,
  principal: string,
  casas: number,
):
  | { campos: CamposMetodoEntrega; falta: null }
  | { campos: null; falta: { campo: CampoMetodo; texto: keyof Textos } } {
  const errado = (campo: CampoMetodo, texto: keyof Textos) =>
    ({ campos: null, falta: { campo, texto } }) as const;
  const limpar = (r: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(r)
        .map(([l, v]) => [l, v.trim()] as const)
        .filter(([, v]) => v !== ""),
    );
  const nome = limpar(f.nome);
  if ((nome[principal] ?? "") === "") return errado("nome", "metodosFaltaNome");
  const tarifa = centimosDoTexto(f.tarifa, casas);
  if (tarifa === null || tarifa > TARIFA_MAXIMA) {
    return errado("tarifa", "metodosTarifaErrada");
  }
  let gratis: number | null = null;
  if (f.gratis.trim() !== "") {
    gratis = centimosDoTexto(f.gratis, casas);
    if (gratis === null || gratis < 1 || gratis > MONTANTE_MAXIMO) {
      return errado("gratis", "metodosGratisErrado");
    }
  }
  if (f.conta !== "" && f.servico === "") {
    return errado("servico", "metodosFaltaServico");
  }
  const prazoMaxDias = inteiro(f.prazoMaxDias, 1, 30);
  if (prazoMaxDias === null)
    return errado("prazoMaxDias", "metodosPrazoErrado");
  const prefixos = prefixosDoTexto(f.prefixos);
  if (prefixos === null) return errado("prefixos", "metodosPrefixosErrados");
  let pesoMaxG: number | null = null;
  if (f.pesoMaxG.trim() !== "") {
    pesoMaxG = inteiro(f.pesoMaxG, 1, PESO_MAXIMO_G);
    if (pesoMaxG === null) return errado("pesoMaxG", "metodosPesoErrado");
  }
  return {
    campos: {
      nome,
      prazo: limpar(f.prazo),
      tarifa,
      gratis_a_partir_de: gratis,
      pede_telefone: f.pedeTelefone,
      conta: f.conta === "" ? null : f.conta,
      servico: f.conta === "" ? null : f.servico,
      prazo_max_dias: prazoMaxDias,
      codigos_postais: prefixos,
      peso_max_g: pesoMaxG,
    },
    falta: null,
  };
}

/**
 * Só os campos que mudaram, para o PATCH: um método cuja conta deixou de
 * estar pronta ainda pode mudar de tarifa sem que o servidor volte a
 * conferir a conta (`mudarMetodoEntrega` só confere os envios se lhes
 * tocarem).
 */
export function camposMudados(
  antes: MetodoEntrega,
  depois: CamposMetodoEntrega,
): Partial<CamposMetodoEntrega> {
  const actual: CamposMetodoEntrega = {
    nome: antes.nome,
    prazo: antes.prazo,
    tarifa: antes.tarifa,
    gratis_a_partir_de: antes.gratis_a_partir_de,
    pede_telefone: antes.pede_telefone,
    conta: antes.conta,
    servico: antes.servico,
    prazo_max_dias: antes.prazo_max_dias,
    codigos_postais: antes.codigos_postais,
    peso_max_g: antes.peso_max_g,
  };
  const mudados: Partial<CamposMetodoEntrega> = {};
  for (const k of Object.keys(depois) as (keyof CamposMetodoEntrega)[]) {
    if (JSON.stringify(depois[k]) !== JSON.stringify(actual[k])) {
      Object.assign(mudados, { [k]: depois[k] });
    }
  }
  // A conta e o serviço vão juntos.
  if ("conta" in mudados || "servico" in mudados) {
    mudados.conta = depois.conta;
    mudados.servico = depois.servico;
  }
  return mudados;
}

const TEXTO_DO_CODIGO: Record<string, keyof Textos> = {
  "shipping.account_not_ready": "metodosContaNaoPronta",
  "shipping.service_unknown": "metodosServicoDesconhecido",
  "shipping.invalid_field": "metodosServicoNaoServe",
  // Num método, o que os envios não encontram é a conta.
  "shipping.not_found": "metodosContaNaoExiste",
  "checkout.version_conflict": "metodosConflito",
};

const mapear = (e: unknown, mapa: Record<string, keyof Textos>) => {
  if (!(e instanceof ErroHub) || e.codigo === undefined) return e;
  const chave = mapa[e.codigo];
  return chave === undefined ? e : new ErroDoEcra(chave);
};

/**
 * Um erro do servidor ao gravar um método, no texto deste ecrã: os códigos
 * dos envios querem dizer outra coisa aqui do que no ecrã da conta. Ao
 * criar, o que o checkout não encontra é o mercado; ao mudar, o método.
 */
export function erroDoMetodo(e: unknown, criar = false): unknown {
  return mapear(e, {
    ...TEXTO_DO_CODIGO,
    "checkout.not_found": criar
      ? "metodosMercadoNaoExiste"
      : "metodosNaoExiste",
  });
}

/** Um erro ao guardar a embalagem: o que não se encontra é o armazém. */
export function erroDaEmbalagem(e: unknown): unknown {
  return mapear(e, { "shipping.not_found": "embalagemNaoExiste" });
}
