import type { Textos } from "./textos";

// As páginas do Hub (docs/22 §2, §9 e §11), numa tabela só: o caminho, se
// tem «Conta» e «Sair» e o título da janela (WCAG 2.4.2). Uma página nova
// entra aqui, com as duas decisões escritas, ou não tem ecrã: o App escolhe o
// ecrã pelo nome, com um `switch` que o compilador obriga a ser completo
// (revisão do #425: a página do preço ficou sem «Sair» e sem título). Nunca
// debaixo de /hub/, que é da API.

/** As chaves dos textos que são frases (as que podem ser título). */
type ChaveDeTexto = {
  [K in keyof Textos]: Textos[K] extends string ? K : never;
}[keyof Textos];

interface DefinicaoDePagina {
  nome: string;
  /** O caminho exacto, ou a expressão com as partes entre parênteses. */
  caminho: string | RegExp;
  /** «Conta» e «Sair» no cabeçalho: só as páginas de antes de entrar não. */
  sessao: boolean;
  titulo: ChaveDeTexto;
  /** Um caminho desta página, para o teste. */
  exemplo: string;
}

const PRD = "prd_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const VAR = "var_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

// Por esta ordem: a primeira que serve ganha («/artigos/novo» antes da ficha
// de um artigo, «variantes/nova» antes de uma variante).
export const PAGINAS = [
  {
    nome: "entrar",
    caminho: "/entrar",
    sessao: false,
    titulo: "entrarTitulo",
    exemplo: "/entrar",
  },
  {
    nome: "recuperar",
    caminho: "/recuperar",
    sessao: false,
    titulo: "recuperarTitulo",
    exemplo: "/recuperar",
  },
  {
    nome: "convite",
    caminho: "/convite",
    sessao: false,
    titulo: "conviteTitulo",
    exemplo: "/convite",
  },
  {
    nome: "inicio",
    caminho: "/",
    sessao: true,
    titulo: "inicioTitulo",
    exemplo: "/",
  },
  {
    nome: "equipa",
    caminho: "/equipa",
    sessao: true,
    titulo: "equipaTitulo",
    exemplo: "/equipa",
  },
  {
    nome: "artigos",
    caminho: "/artigos",
    sessao: true,
    titulo: "artigosTitulo",
    exemplo: "/artigos",
  },
  {
    nome: "artigoNovo",
    caminho: "/artigos/novo",
    sessao: true,
    titulo: "artigoNovoTitulo",
    exemplo: "/artigos/novo",
  },
  {
    nome: "artigo",
    caminho: /^\/artigos\/([^/]+)$/,
    sessao: true,
    titulo: "artigoTitulo",
    exemplo: `/artigos/${PRD}`,
  },
  {
    nome: "artigoEditar",
    caminho: /^\/artigos\/([^/]+)\/editar$/,
    sessao: true,
    titulo: "artigoEditarTitulo",
    exemplo: `/artigos/${PRD}/editar`,
  },
  {
    nome: "historico",
    caminho: /^\/artigos\/([^/]+)\/historico$/,
    sessao: true,
    titulo: "historicoTitulo",
    exemplo: `/artigos/${PRD}/historico`,
  },
  {
    nome: "opcoes",
    caminho: /^\/artigos\/([^/]+)\/opcoes$/,
    sessao: true,
    titulo: "opcoesTitulo",
    exemplo: `/artigos/${PRD}/opcoes`,
  },
  {
    nome: "varianteNova",
    caminho: /^\/artigos\/([^/]+)\/variantes\/nova$/,
    sessao: true,
    titulo: "varianteNovaTitulo",
    exemplo: `/artigos/${PRD}/variantes/nova`,
  },
  {
    nome: "variante",
    caminho: /^\/artigos\/([^/]+)\/variantes\/([^/]+)$/,
    sessao: true,
    titulo: "varianteEditarTitulo",
    exemplo: `/artigos/${PRD}/variantes/${VAR}`,
  },
  {
    nome: "preco",
    caminho: /^\/artigos\/([^/]+)\/precos\/([^/]+)\/([^/]+)$/,
    sessao: true,
    titulo: "precoTitulo",
    exemplo: `/artigos/${PRD}/precos/prl_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d/${VAR}`,
  },
  {
    nome: "publicar",
    caminho: /^\/artigos\/([^/]+)\/publicacoes\/([^/]+)\/([^/]+)$/,
    sessao: true,
    titulo: "publicarTitulo",
    exemplo: `/artigos/${PRD}/publicacoes/chn_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e/mkt_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5f`,
  },
  {
    nome: "aDecidir",
    caminho: "/a-decidir",
    sessao: true,
    titulo: "decidirTitulo",
    exemplo: "/a-decidir",
  },
  {
    nome: "faturacao",
    caminho: "/faturacao",
    sessao: true,
    titulo: "faturacaoTitulo",
    exemplo: "/faturacao",
  },
  {
    nome: "moloni",
    caminho: "/faturacao/moloni",
    sessao: true,
    titulo: "moloniTitulo",
    exemplo: "/faturacao/moloni",
  },
  {
    nome: "configurarFaturacao",
    caminho: "/faturacao/configurar",
    sessao: true,
    titulo: "configurarTitulo",
    exemplo: "/faturacao/configurar",
  },
  {
    nome: "oss",
    caminho: "/faturacao/oss",
    sessao: true,
    titulo: "ossTitulo",
    exemplo: "/faturacao/oss",
  },
  {
    nome: "envios",
    caminho: "/envios",
    sessao: true,
    titulo: "enviosTitulo",
    exemplo: "/envios",
  },
  {
    nome: "envioNova",
    caminho: "/envios/nova",
    sessao: true,
    titulo: "enviosNovaTitulo",
    exemplo: "/envios/nova",
  },
  {
    nome: "envioConta",
    caminho: /^\/envios\/(cac_[^/]+)$/,
    sessao: true,
    titulo: "enviosContaTitulo",
    exemplo: "/envios/cac_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60",
  },
  {
    nome: "metodos",
    caminho: "/envios/metodos",
    sessao: true,
    titulo: "metodosTitulo",
    exemplo: "/envios/metodos",
  },
  {
    nome: "metodoNovo",
    caminho: "/envios/metodos/novo",
    sessao: true,
    titulo: "metodosNovoTitulo",
    exemplo: "/envios/metodos/novo",
  },
  {
    nome: "metodo",
    caminho: /^\/envios\/metodos\/(shm_[^/]+)$/,
    sessao: true,
    titulo: "metodosMetodoTitulo",
    exemplo: "/envios/metodos/shm_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61",
  },
  {
    nome: "embalagem",
    caminho: "/envios/embalagem",
    sessao: true,
    titulo: "embalagemTitulo",
    exemplo: "/envios/embalagem",
  },
  {
    nome: "expedir",
    caminho: "/expedir",
    sessao: true,
    titulo: "expedirTitulo",
    exemplo: "/expedir",
  },
  {
    nome: "expedirEncomenda",
    caminho: /^\/expedir\/(ord_[^/]+)$/,
    sessao: true,
    titulo: "expedirEncomendaTitulo",
    exemplo: "/expedir/ord_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62",
  },
  {
    nome: "devolucoes",
    caminho: "/devolucoes",
    sessao: true,
    titulo: "devolucoesTitulo",
    exemplo: "/devolucoes",
  },
  {
    nome: "devolucao",
    caminho: /^\/devolucoes\/(rma_[^/]+)$/,
    sessao: true,
    titulo: "devolucaoTitulo",
    exemplo: "/devolucoes/rma_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a70",
  },
  {
    nome: "chaves",
    caminho: "/chaves",
    sessao: true,
    titulo: "chavesTitulo",
    exemplo: "/chaves",
  },
  {
    nome: "conta",
    caminho: "/conta",
    sessao: true,
    titulo: "contaTitulo",
    exemplo: "/conta",
  },
] as const satisfies readonly DefinicaoDePagina[];

export type NomeDaPagina = (typeof PAGINAS)[number]["nome"];

export interface PaginaAberta {
  nome: NomeDaPagina;
  sessao: boolean;
  titulo: ChaveDeTexto;
  /** As partes do caminho (os identificadores), pela ordem. */
  partes: string[];
}

/**
 * A página de um caminho, ou `null` se nenhuma serve: o App mostra então o
 * início, sem «Conta» nem «Sair» e com o título do início (como antes).
 */
export function paginaDe(caminho: string): PaginaAberta | null {
  for (const p of PAGINAS) {
    if (typeof p.caminho === "string") {
      if (p.caminho === caminho) {
        return { nome: p.nome, sessao: p.sessao, titulo: p.titulo, partes: [] };
      }
      continue;
    }
    const m = p.caminho.exec(caminho);
    if (m !== null) {
      return {
        nome: p.nome,
        sessao: p.sessao,
        titulo: p.titulo,
        partes: m.slice(1),
      };
    }
  }
  return null;
}
