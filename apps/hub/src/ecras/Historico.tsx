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
  type FichaArtigo,
  type PublicacaoArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { IconeAviso } from "../icones";
import { linhaDoRasto } from "../rasto";
import { preencher, TAG_LINGUA, type Lingua, type Textos } from "../textos";
import { textoDe } from "./Artigo";

// O histórico do artigo (docs/22 §16): quem mudou o quê e quando, da
// alteração mais recente para a mais antiga, 25 de cada vez. Só lê. Quem
// fez vem do servidor (o `autor`, §16.2); o ecrã só o diz. As partes e os
// campos que o ecrã conhece vão em linguagem comum (§16.4); os outros, com o
// nome técnico, sem se inventar o que significam. Por baixo de quem e
// quando, as outras respostas do rasto: de onde veio, a IA, quem autorizou e
// o motivo (§26), também decididas no servidor.

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
  /** A primeira entrada: o rasto é o da transacção, igual em todas. */
  rasto: AlteracaoArtigo;
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
        rasto: e,
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

/** «Ana Teste», «Chave «Escrita»», «Automático» (§16.2), pelo tipo de autor do servidor (§26). */
function nomeDoAutor(e: AlteracaoArtigo, t: Textos): string {
  switch (e.tipo_de_autor) {
    case "pessoa":
      return e.autor.nome ?? t.historicoPessoaDeFora;
    case "chave":
    case "agente":
      return e.autor.nome === null
        ? t.historicoChaveSemNome
        : preencher(t.historicoChave, { nome: e.autor.nome });
    case "sistema":
      return t.historicoAutomatico;
    // O identificador guardado só quando o servidor não conhece a forma
    // (revisão do #359, P3-3): o login de quem opera não se mostra.
    case "operador":
      return t.rastoAutor_operador;
    case "consumidor":
      return t.rastoAutor_consumidor;
    case "prestador":
      return t.rastoAutor_prestador;
    default:
      return e.quem;
  }
}

/** «alterou o artigo», «criou a variante GEL-15». */
function frase(
  e: AlteracaoArtigo,
  skus: Map<string, string>,
  publicacoes: Map<string, PublicacaoArtigo>,
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
  } else if (e.entidade === "traducao") {
    // A língua e o campo só vêm na criação (não mudam depois; §16.4).
    const lingua = e.campos["lingua"]?.depois;
    const campo = e.campos["campo"]?.depois;
    parte =
      typeof lingua === "string" && typeof campo === "string"
        ? preencher(t.historicoParte_traducaoDe, { campo, lingua })
        : t.historicoParte_traducao;
  } else if (e.entidade === "publicacao") {
    // Canal e mercado pelo identificador, como a ficha (§12.2).
    const p =
      e.entidade_id === null ? undefined : publicacoes.get(e.entidade_id);
    parte =
      p === undefined
        ? t.historicoParte_publicacao
        : preencher(t.historicoParte_publicacaoEm, {
            canal: p.canal,
            mercado: p.mercado,
          });
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
  const [publicacoes, setPublicacoes] = useState<PublicacaoArtigo[]>([]);
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
      // As publicações só dão o canal e o mercado às linhas delas: se
      // falharem, a linha diz «uma publicação» e o resto fica.
      api.publicacoesDoArtigo(comerciante, artigo).then(
        (p) => {
          if (montado.current) setPublicacoes(p.dados);
        },
        () => undefined,
      );
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
    // O erro anterior e o «Tentar outra vez» ficam até à resposta: o foco
    // não cai na página enquanto se espera (revisão do #252, P3-8).
    try {
      const pagina = await api.historicoDoArtigo(comerciante, artigo, cursor);
      if (!montado.current) return;
      const primeira = pagina.dados[0];
      // O foco vai para a primeira entrada nova, também quando ela continua
      // a última alteração já à vista (revisão do #242, P3-6).
      if (primeira !== undefined)
        focarDepois.current = `entrada-${primeira.id}`;
      setFalhaMais(null);
      setEntradas((antes) => [...(antes ?? []), ...pagina.dados]);
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
  const skus = new Map(
    (ficha?.variantes ?? []).map((v) => [v.id, v.sku] as const),
  );
  const porPublicacao = new Map(publicacoes.map((p) => [p.id, p] as const));

  const naoExiste =
    !valido || (falha instanceof ErroHub && falha.estado === 404);
  // Só o papel sem catalog:history é «o seu papel não vê»; outro 403
  // (membro que saiu, comerciante suspenso) é o da ficha (P3-4).
  const semPapel =
    falha instanceof ErroHub &&
    falha.estado === 403 &&
    falha.codigo === "member.role_escalation";
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
          {t.historicoVoltarFicha}
        </a>
      </p>
      <h1 id="titulo">{t.historicoTitulo}</h1>
      {ficha === null ? null : <p className="secundario">{ficha.nome}</p>}
      {naoExiste ? (
        <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />
      ) : semPapel ? (
        <CaixaDeErro erro={{ texto: t.historicoSemPermissao }} />
      ) : semPermissao ? (
        <CaixaDeErro erro={{ texto: t.artigosSemPermissao }} />
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
                  publicacoes={porPublicacao}
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
                aria-disabled={aCarregarMais}
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
  publicacoes,
  lingua,
}: {
  grupo: Grupo;
  skus: Map<string, string>;
  publicacoes: Map<string, PublicacaoArtigo>;
  lingua: Lingua;
}) {
  const { t } = useHub();
  const quando = new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(grupo.em));
  const quem = nomeDoAutor(grupo.rasto, t);
  const rasto = linhaDoRasto(grupo.rasto, t);
  return (
    <li>
      <h2 id={`alteracao-${grupo.primeira}`} tabIndex={-1}>
        <time dateTime={grupo.em}>{quando}</time>
        {" — "}
        {quem}
      </h2>
      <p className="rasto-historico">
        {rasto.partes.join(" · ")}
        {" · "}
        {rasto.autorizacao.aviso ? (
          <strong className="aviso-texto">
            <IconeAviso /> {rasto.autorizacao.texto}
          </strong>
        ) : (
          <span>{rasto.autorizacao.texto}</span>
        )}
      </p>
      {rasto.motivo === null ? null : (
        // Um `div`: um motivo longo traz um `<details>`, que não cabe num
        // `<p>` (revisão do #359, P3-5).
        <div className="rasto-historico">
          {t.rastoMotivo}{" "}
          <Valor entidade="rasto" campo="motivo" valor={rasto.motivo} />
        </div>
      )}
      <ul>
        {grupo.entradas.map((e) => (
          <li key={e.id} id={`entrada-${e.id}`} tabIndex={-1}>
            {frase(e, skus, publicacoes, t)}
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
      {rasto.detalhes.length === 0 ? null : (
        <details className="detalhes-rasto">
          <summary>{t.rastoDetalhes}</summary>
          <ul>
            {rasto.detalhes.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
