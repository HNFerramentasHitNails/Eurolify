import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  ErroHub,
  type AlteracaoArtigo,
  type AutorAlteracao,
  type FichaArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { preencher, TAG_LINGUA, type Lingua, type Textos } from "../textos";
import { textoDe } from "./Artigo";

// O histórico do artigo (docs/22 §16): quem mudou o quê e quando, da
// alteração mais recente para a mais antiga, 25 de cada vez. Só lê. Quem
// fez vem do servidor (o `autor`, §16.2); o ecrã só o diz. As partes e os
// campos que o ecrã conhece vão em linguagem comum (§16.4); os outros, com o
// nome técnico, sem se inventar o que significam.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ARTIGO =
  /^prd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Acima disto, um texto mostra o começo e «Ver tudo» (§16.4). */
const TEXTO_CURTO = 160;

/** As entradas da mesma transacção, juntas numa alteração (§16.3). */
interface Grupo {
  transacao: string;
  primeira: string;
  em: string;
  autor: AutorAlteracao;
  origem: string | null;
  entradas: AlteracaoArtigo[];
}

/** Junta as entradas seguidas com a mesma `transacao`. */
function agrupar(entradas: AlteracaoArtigo[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const e of entradas) {
    const ultimo = grupos.at(-1);
    if (ultimo?.transacao === e.transacao) {
      ultimo.entradas.push(e);
    } else {
      grupos.push({
        transacao: e.transacao,
        primeira: e.id,
        em: e.em,
        autor: e.autor,
        origem: e.origem,
        entradas: [e],
      });
    }
  }
  return grupos;
}

/** O nome de cada campo que o ecrã conhece (§16.4). */
const NOME_DO_CAMPO: Record<string, keyof Textos> = {
  nome: "colunaNome",
  descricao: "artigoDescricao",
  marca: "colunaMarca",
  estado: "colunaEstado",
  tipo: "colunaTipo",
  sku: "artigosSku",
  gtin: "colunaGtin",
  gtin_origem: "artigoNovoGtinOrigem",
  unidade_de_venda: "colunaUnidade",
  conteudo_quantidade: "artigoNovoQuantidade",
  conteudo_unidade: "artigoNovoUnidadeConteudo",
  peso_g: "artigoNovoPeso",
  comprimento_mm: "artigoNovoComprimento",
  largura_mm: "artigoNovoLargura",
  altura_mm: "artigoNovoAltura",
  texto_alternativo: "artigoTextoAlternativo",
  principal: "artigoImagemPrincipal",
  posicao: "historicoPosicao",
  motivo_arquivo: "colunaMotivo",
};

/** O prefixo dos textos de um valor com nome, por campo e parte. */
function prefixoDoValor(entidade: string, campo: string): string | null {
  if (campo === "estado") {
    if (entidade === "artigo") return "estadoArtigo_";
    if (entidade === "variante") return "estadoVariante_";
    if (entidade === "publicacao") return "estadoPublicacao_";
    return null;
  }
  if (campo === "tipo" && entidade === "artigo") return "tipoArtigo_";
  if (campo === "unidade_de_venda") return "unidade_";
  if (campo === "gtin_origem") return "gtinOrigem_";
  if (campo === "motivo_arquivo") return "motivoArquivo_";
  return null;
}

function Valor({
  entidade,
  campo,
  valor,
}: {
  entidade: string;
  campo: string;
  valor: unknown;
}) {
  const { t, lingua } = useHub();
  if (valor === null || valor === undefined) {
    return <em className="secundario">{t.historicoValorVazio}</em>;
  }
  if (typeof valor === "boolean") {
    return <>{valor ? t.historicoSim : t.historicoNao}</>;
  }
  if (typeof valor === "number") {
    return <>{new Intl.NumberFormat(TAG_LINGUA[lingua]).format(valor)}</>;
  }
  if (typeof valor === "string") {
    const prefixo = prefixoDoValor(entidade, campo);
    if (prefixo !== null) return <>{textoDe(t, prefixo + valor, valor)}</>;
    if (valor.length <= TEXTO_CURTO) {
      return <span className="valor-historico">{valor}</span>;
    }
    return (
      <details className="valor-historico">
        <summary>
          {valor.slice(0, TEXTO_CURTO)}… <span>{t.historicoVerTudo}</span>
        </summary>
        <span>{valor}</span>
      </details>
    );
  }
  // JSON: como está guardado (§16.4).
  return <code>{JSON.stringify(valor)}</code>;
}

/** «Ana Teste», «Chave «Escrita»», «Automático» (§16.2). */
function nomeDoAutor(autor: AutorAlteracao, quem: string, t: Textos): string {
  switch (autor.tipo) {
    case "pessoa":
      return autor.nome ?? t.historicoPessoaDeFora;
    case "chave":
      return autor.nome === null
        ? t.historicoChaveSemNome
        : preencher(t.historicoChave, { nome: autor.nome });
    case "sistema":
      return t.historicoAutomatico;
    default:
      return quem;
  }
}

/** «alterou o artigo», «criou a variante GEL-15». */
function frase(
  e: AlteracaoArtigo,
  skus: Map<string, string>,
  t: Textos,
): string {
  const verbo =
    e.operacao === "criado"
      ? t.historicoCriou
      : e.operacao === "apagado"
        ? t.historicoApagou
        : t.historicoAlterou;
  let parte: string;
  if (e.entidade === "variante") {
    const daFicha =
      e.entidade_id === null ? undefined : skus.get(e.entidade_id);
    const doRegisto = e.campos["sku"]?.depois ?? e.campos["sku"]?.antes;
    const sku =
      daFicha ?? (typeof doRegisto === "string" ? doRegisto : undefined);
    parte =
      sku === undefined
        ? t.historicoParte_varianteSemSku
        : preencher(t.historicoParte_variante, { sku });
  } else {
    parte = textoDe(t, `historicoParte_${e.entidade}`, e.entidade);
  }
  return `${verbo} ${parte}`;
}

export function Historico({
  comerciante,
  artigo,
  consulta,
}: {
  comerciante: string | null;
  artigo: string;
  /** A consulta da página: o comerciante e os filtros da lista. */
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ARTIGO.test(artigo);
  const [ficha, setFicha] = useState<FichaArtigo | null>(null);
  const [entradas, setEntradas] = useState<AlteracaoArtigo[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [falhaMais, setFalhaMais] = useState<unknown>(null);
  const [aCarregarMais, setACarregarMais] = useState(false);
  const focarDepois = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const destinoFicha = `/artigos/${artigo}?${consulta.replace(/^\?/, "")}`;

  const carregar = useCallback(async () => {
    if (!valido) return;
    setFalha(null);
    try {
      const [dados, pagina] = await Promise.all([
        api.artigo(comerciante, artigo),
        api.historicoDoArtigo(comerciante, artigo, null),
      ]);
      if (!montado.current) return;
      setFicha(dados);
      setEntradas(pagina.dados);
      setCursor(pagina.ha_mais ? pagina.cursor_seguinte : null);
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, artigo, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O foco muda antes de pintar (como na ficha, revisão do #223).
  useLayoutEffect(() => {
    if (focarDepois.current === null) return;
    document.getElementById(focarDepois.current)?.focus();
    focarDepois.current = null;
  }, [entradas, falhaMais]);

  async function mostrarMais() {
    if (!valido || cursor === null || aCarregarMais) return;
    setACarregarMais(true);
    setFalhaMais(null);
    try {
      const pagina = await api.historicoDoArtigo(comerciante, artigo, cursor);
      if (!montado.current) return;
      const primeira = pagina.dados[0];
      if (primeira !== undefined) {
        // A primeira nova pode continuar a última alteração já à vista.
        const antes = entradas?.at(-1);
        focarDepois.current =
          antes?.transacao === primeira.transacao
            ? `alteracao-${grupoDe(antes.id)}`
            : `alteracao-${primeira.id}`;
      }
      setEntradas([...(entradas ?? []), ...pagina.dados]);
      setCursor(pagina.ha_mais ? pagina.cursor_seguinte : null);
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaMais(e);
      focarDepois.current = "historico-falha-mais";
    } finally {
      if (montado.current) setACarregarMais(false);
    }
  }

  const grupos = agrupar(entradas ?? []);
  // O grupo de uma entrada (o id da primeira entrada dele).
  function grupoDe(id: string): string {
    return (
      grupos.find((g) => g.entradas.some((e) => e.id === id))?.primeira ?? id
    );
  }
  const skus = new Map(
    (ficha?.variantes ?? []).map((v) => [v.id, v.sku] as const),
  );

  const naoExiste =
    !valido || (falha instanceof ErroHub && falha.estado === 404);
  const semPermissao = falha instanceof ErroHub && falha.estado === 403;

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoFicha}
          onClick={(e) => {
            e.preventDefault();
            navegar(destinoFicha);
          }}
        >
          {ficha === null ? t.artigoVoltar : ficha.nome}
        </a>
      </p>
      <h1 id="titulo">{t.historicoTitulo}</h1>
      {naoExiste ? (
        <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />
      ) : semPermissao ? (
        <CaixaDeErro erro={{ texto: t.historicoSemPermissao }} />
      ) : falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : entradas === null ? (
        <ACarregar />
      ) : (
        <>
          <p className="secundario">{t.historicoComeco}</p>
          {grupos.length === 0 ? (
            <p>{t.historicoVazio}</p>
          ) : (
            <ol className="historico">
              {grupos.map((g) => (
                <Alteracao
                  key={g.primeira}
                  grupo={g}
                  skus={skus}
                  lingua={lingua}
                />
              ))}
            </ol>
          )}
          {falhaMais === null ? null : (
            <div id="historico-falha-mais" tabIndex={-1}>
              <CaixaDeErro
                erro={mensagemDeErro(falhaMais, t, lingua)}
                aoTentar={() => void mostrarMais()}
              />
            </div>
          )}
          {cursor === null ? null : (
            <p>
              <button
                type="button"
                disabled={aCarregarMais}
                onClick={() => void mostrarMais()}
              >
                {aCarregarMais ? t.aCarregar : t.historicoMostrarMais}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Alteracao({
  grupo,
  skus,
  lingua,
}: {
  grupo: Grupo;
  skus: Map<string, string>;
  lingua: Lingua;
}) {
  const { t } = useHub();
  const quando = new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(grupo.em));
  const quem = nomeDoAutor(grupo.autor, grupo.entradas[0]?.quem ?? "", t);
  return (
    <li>
      <h2 id={`alteracao-${grupo.primeira}`} tabIndex={-1}>
        <time dateTime={grupo.em}>{quando}</time>
        {" — "}
        {quem}
        {grupo.origem?.startsWith("importacao:") === true ? (
          <span className="secundario">
            {" · "}
            {t.historicoPelaImportacao}
          </span>
        ) : null}
      </h2>
      <ul>
        {grupo.entradas.map((e) => (
          <li key={e.id}>
            {frase(e, skus, t)}
            {e.operacao !== "alterado" ? null : (
              <dl className="campos-historico">
                {Object.entries(e.campos).map(([campo, { antes, depois }]) => {
                  const nome = NOME_DO_CAMPO[campo];
                  return (
                    <div key={campo}>
                      <dt>
                        {nome === undefined ? <code>{campo}</code> : t[nome]}
                      </dt>
                      <dd>
                        <Valor
                          entidade={e.entidade}
                          campo={campo}
                          valor={antes}
                        />
                        {" → "}
                        <Valor
                          entidade={e.entidade}
                          campo={campo}
                          valor={depois}
                        />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
