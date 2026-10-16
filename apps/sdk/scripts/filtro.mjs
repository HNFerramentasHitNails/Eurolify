// Que rotas do contrato da API entram no SDK (docs/39 §3). Uma função pura,
// sem dependências, para o gerador e os testes usarem a mesma. O SDK não
// decide nada de negócio: só escolhe, pelo âmbito que a API escreve em cada
// rota (`x-ambito`), a quem cada rota se destina.

const METODOS = ["get", "put", "post", "delete", "options", "head", "patch"];

/** Âmbitos da API da Loja (chave pública, ou rota sem chave). */
export const AMBITOS_DA_LOJA = ["publico", "storefront"];
/** Rotas do Hub: sessão de uma pessoa, não chave. Nunca entram no SDK. */
export const AMBITOS_DO_HUB = ["sessao", "sessao_comerciante"];

/**
 * Rotas que não são para quem constrói uma loja: avisos que os prestadores
 * mandam ao Eurolify e a volta da autorização do Moloni.
 */
export const CAMINHOS_FORA = [
  /^\/webhooks\//,
  /^\/invoicing-connections\/moloni\/callback$/,
];

function soJson(conteudo) {
  const tipos = Object.keys(conteudo ?? {});
  return tipos.every((t) => t === "application/json");
}

/** Porque é que uma operação fica de fora do SDK; `undefined` se entra. */
export function razaoDeExclusao(caminho, op) {
  const ambito = op["x-ambito"];
  if (typeof ambito !== "string") return "sem x-ambito no contrato";
  if (AMBITOS_DO_HUB.includes(ambito)) return "rota do Hub (sessão)";
  if (CAMINHOS_FORA.some((r) => r.test(caminho))) return "aviso de prestador";
  if (!soJson(op.requestBody?.content)) return "corpo do pedido não é JSON";
  for (const [estado, resposta] of Object.entries(op.responses ?? {})) {
    if (/^2/.test(estado) && !soJson(resposta.content)) {
      return "resposta de sucesso não é JSON (ficheiro)";
    }
  }
  return undefined;
}

/**
 * Parte o contrato em dois: a Loja e a Administração (chave de servidor).
 * Devolve também, para cada operação fora, a razão (os testes e o doc contam-nas).
 */
export function repartir(contrato) {
  const base = () => ({
    ...contrato,
    paths: {},
  });
  const loja = base();
  const administracao = base();
  const fora = [];
  for (const [caminho, item] of Object.entries(contrato.paths)) {
    for (const metodo of METODOS) {
      const op = item[metodo];
      if (op === undefined) continue;
      const razao = razaoDeExclusao(caminho, op);
      if (razao !== undefined) {
        fora.push({ metodo, caminho, razao });
        continue;
      }
      const alvo = AMBITOS_DA_LOJA.includes(op["x-ambito"])
        ? loja
        : administracao;
      alvo.paths[caminho] = { ...alvo.paths[caminho], [metodo]: op };
    }
  }
  return { loja, administracao, fora };
}
