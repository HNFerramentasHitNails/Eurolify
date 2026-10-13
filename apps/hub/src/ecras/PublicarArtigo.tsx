import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ErroHub,
  type FichaArtigo,
  type ParDeVenda,
  type PublicacaoArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { ErroDoEcra, mensagemDeErro, semSessao } from "../erros";
import {
  celulaDoCanal,
  celulaDoMercado,
  type LinhaDePublicacao,
} from "../publicacoes";
import {
  chaveDaEscolha,
  escolhaDepoisDeRecarregar,
  escolhaInicial,
  marcaDaVariante,
  variantesQueApareceram,
  linhasDosImpedimentos,
  podePublicar,
  publicacaoConfere,
  publicacaoDoPar,
  respostaPerdida,
  textoDaCelula,
  variantesActivas,
  variantesFora,
  verificacaoDesactualizada,
  type Verificada,
} from "../publicar";
import { preencher } from "../textos";
import { textoDe } from "./Artigo";

// Publicar um artigo num canal × mercado (docs/22 §27.3): escolher as
// variantes à venda, verificar («pode publicar?», C2, do servidor) e
// publicar sobre a versão lida da publicação. O Hub não decide nada de
// publicar: mostra a verificação do servidor e só oferece «Publicar» depois
// de uma verificação sem impedimentos com as mesmas escolhas.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ARTIGO = new RegExp(`^prd_${UUID}$`);
const FORMATO_CANAL = new RegExp(`^chn_${UUID}$`);
const FORMATO_MERCADO = new RegExp(`^mkt_${UUID}$`);

/** O que a página leu: a ficha, as publicações do artigo e os pares. */
interface Lido {
  ficha: FichaArtigo;
  publicacoes: PublicacaoArtigo[];
  pares: ParDeVenda[];
}

/** A última verificação: a do botão, ou a de uma publicação recusada. */
interface Resultado extends Verificada {
  naoVerificado: readonly string[];
  /** Veio de «Publicar» (publicada: false) e não de «Verificar». */
  aoPublicar: boolean;
}

export function PublicarArtigo({
  comerciante,
  artigo,
  canal,
  mercado,
  consulta,
}: {
  comerciante: string | null;
  artigo: string;
  canal: string;
  mercado: string;
  /** A consulta da página: o comerciante e os filtros da lista. */
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ARTIGO.test(artigo) &&
    FORMATO_CANAL.test(canal) &&
    FORMATO_MERCADO.test(mercado);
  const [lido, setLido] = useState<Lido | null>(null);
  const [ambitos, setAmbitos] = useState<{
    publicar: boolean;
    escrever: boolean;
    precos: boolean;
  } | null>(null);
  const [marcadas, setMarcadas] = useState<string[] | null>(null);
  // As que apareceram ao reler (criadas com o ecrã aberto): dizem «nova».
  const [apareceram, setApareceram] = useState<string[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [listaBase, setListaBase] = useState<string | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [recusa, setRecusa] = useState<"conflito" | "semResposta" | null>(null);
  const [aVerificar, setAVerificar] = useState(false);
  const [aPublicar, setAPublicar] = useState(false);
  // O trinco: dois Enter antes de o ecrã se actualizar mandavam dois pedidos.
  const ocupadoAgora = useRef(false);
  const focarDepois = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const aindaAqui = () => montado.current;

  useEffect(() => {
    const id = focarDepois.current;
    if (id === null) return;
    focarDepois.current = null;
    document.getElementById(id)?.focus();
  });

  const destinoFicha = `/artigos/${artigo}?${consulta.replace(/^\?/, "")}`;

  /** Lê a ficha, as publicações e os pares agora. */
  const ler = useCallback(async (): Promise<Lido | null> => {
    if (!valido) return null;
    const [ficha, pubs, pares] = await Promise.all([
      api.artigo(comerciante, artigo),
      api.publicacoesDoArtigo(comerciante, artigo),
      api.paresDeVenda(comerciante),
    ]);
    return { ficha, publicacoes: pubs.dados, pares: pares.dados };
  }, [valido, comerciante, artigo]);

  const [falhaDeLeitura, setFalhaDeLeitura] = useState<unknown>(null);
  const carregar = useCallback(async () => {
    if (!valido) return;
    setFalhaDeLeitura(null);
    try {
      const [agora, eu] = await Promise.all([ler(), api.eu()]);
      if (!montado.current || agora === null) return;
      const lista =
        eu.comerciantes.find((c) => c.comerciante === comerciante)?.ambitos ??
        [];
      setAmbitos({
        publicar: lista.includes("catalog:publish"),
        escrever: lista.includes("catalog:write"),
        precos: lista.includes("prices:write"),
      });
      setLido(agora);
      setMarcadas(
        escolhaInicial(
          variantesActivas(agora.ficha.variantes),
          publicacaoDoPar(agora.publicacoes, canal, mercado),
        ),
      );
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaDeLeitura(e);
    }
  }, [valido, comerciante, ler, navegar, canal, mercado]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const publicacao =
    lido === null ? null : publicacaoDoPar(lido.publicacoes, canal, mercado);
  const par =
    lido?.pares.find((p) => p.canal === canal && p.mercado === mercado) ?? null;
  const activas = lido === null ? [] : variantesActivas(lido.ficha.variantes);
  const fora = variantesFora(activas, marcadas ?? []);
  const chaveActual = chaveDaEscolha(canal, mercado, fora);
  const publicada = publicacao?.estado === "publicado";
  const mostrarPublicar = podePublicar(resultado, chaveActual);
  const desactualizada = verificacaoDesactualizada(resultado, chaveActual);

  /** O nome do par, com a loja quando o nome se repete (§19.2). */
  const linhas: LinhaDePublicacao[] = lido?.pares ?? [];
  const celulaCanal = par === null ? null : celulaDoCanal(linhas, par);
  const celulaMercado = par === null ? null : celulaDoMercado(linhas, par);

  function entrar() {
    navegar("/entrar", { substituir: true });
  }

  /** A lista base do mercado, para a ligação do preço em falta (§25). */
  async function acharListaBase() {
    if (comerciante === null || ambitos?.precos !== true) return;
    try {
      let cursor: string | null = null;
      do {
        const pagina = await api.precosDoArtigo(comerciante, artigo, cursor);
        const achada = pagina.dados.find(
          (l) => l.lista.tipo === "base" && l.mercado.id === mercado,
        );
        if (achada !== undefined) {
          if (aindaAqui()) setListaBase(achada.lista.id);
          return;
        }
        cursor = pagina.ha_mais ? pagina.cursor_seguinte : null;
      } while (cursor !== null);
    } catch {
      // Sem a lista, o impedimento fica sem ligação: a frase basta.
    }
  }

  function mudarMarca(variante: string, marcada: boolean) {
    setMarcadas((m) => {
      const actual = m ?? [];
      return marcada
        ? [...actual.filter((x) => x !== variante), variante]
        : actual.filter((x) => x !== variante);
    });
    setRecusa(null);
  }

  /** Volta à ficha com o aviso de que publicou. */
  function abrirFicha() {
    if (par === null) return;
    const q = new URLSearchParams(consulta);
    q.set("publicado", "1");
    q.set("canalPub", textoDaCelula(celulaDoCanal(linhas, par)));
    q.set("mercadoPub", textoDaCelula(celulaDoMercado(linhas, par)));
    navegar(`/artigos/${artigo}?${q.toString()}`, { substituir: true });
  }

  async function verificar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (
      lido === null ||
      par === null ||
      comerciante === null ||
      ocupadoAgora.current
    ) {
      return;
    }
    ocupadoAgora.current = true;
    setAVerificar(true);
    setFalha(null);
    setRecusa(null);
    const chave = chaveActual;
    try {
      const r = await api.verificarPublicacao(comerciante, artigo, {
        canal,
        mercado,
        variantes_fora: fora,
      });
      if (!aindaAqui()) return;
      setResultado({
        chave,
        impedimentos: r.impedimentos,
        naoVerificado: r.nao_verificado,
        aoPublicar: false,
      });
      // Sem impedimentos, o foco vai para «Publicar» (o resultado está depois
      // dos botões e o status anuncia-o); com impedimentos, para a lista.
      focarDepois.current =
        r.impedimentos.length === 0
          ? "publicar-publicar"
          : "publicar-resultado";
      if (r.impedimentos.some((i) => i.codigo === "preco_em_falta")) {
        void acharListaBase();
      }
    } catch (erro) {
      if (!aindaAqui()) return;
      if (semSessao(erro)) {
        entrar();
        return;
      }
      setResultado(null);
      setFalha(erro);
      focarDepois.current = "publicar-falha";
    } finally {
      ocupadoAgora.current = false;
      if (aindaAqui()) setAVerificar(false);
    }
  }

  /** O estado relido, com as variantes que apareceram entretanto. */
  function reler(agora: Lido) {
    if (lido !== null) {
      const antes = variantesActivas(lido.ficha.variantes);
      setApareceram((a) =>
        variantesQueApareceram(
          a,
          antes,
          variantesActivas(agora.ficha.variantes),
        ),
      );
    }
    setLido(agora);
  }

  /** As escolhas da pessoa, sobre o estado de agora. */
  function aceitarEstado(agora: Lido) {
    reler(agora);
    setMarcadas((m) =>
      escolhaDepoisDeRecarregar(
        m ?? [],
        variantesActivas(agora.ficha.variantes),
      ),
    );
    // A verificação era do estado de antes.
    setResultado(null);
  }

  async function depoisDaFalha(
    erro: unknown,
    pedidas: string[],
    versaoLida: number | null,
  ) {
    if (semSessao(erro)) {
      entrar();
      return;
    }
    const perdida =
      erro instanceof ErroHub
        ? respostaPerdida(erro.estado, erro.codigo)
        : true;
    const conflito =
      erro instanceof ErroHub && erro.codigo === "catalog.version_conflict";
    if (!perdida && !conflito) {
      setFalha(erro);
      focarDepois.current = "publicar-falha";
      return;
    }
    try {
      const agora = await ler();
      if (!aindaAqui() || agora === null) return;
      // Só a resposta perdida se dá por feita ao reler: um 409 garante que
      // nada se gravou (como no preço, §25.2).
      if (
        perdida &&
        publicacaoConfere(
          publicacaoDoPar(agora.publicacoes, canal, mercado),
          pedidas,
          versaoLida,
        )
      ) {
        abrirFicha();
        return;
      }
      aceitarEstado(agora);
      setRecusa(conflito ? "conflito" : "semResposta");
      focarDepois.current = "publicar-recusa";
    } catch (e2) {
      if (!aindaAqui()) return;
      if (semSessao(e2)) {
        entrar();
        return;
      }
      if (perdida) {
        setRecusa("semResposta");
        focarDepois.current = "publicar-recusa";
        return;
      }
      setFalha(e2);
      focarDepois.current = "publicar-falha";
    }
  }

  async function publicar() {
    if (
      !mostrarPublicar ||
      lido === null ||
      par === null ||
      comerciante === null ||
      ocupadoAgora.current
    ) {
      return;
    }
    ocupadoAgora.current = true;
    setAPublicar(true);
    setFalha(null);
    setRecusa(null);
    const pedidas = fora;
    const versaoLida = publicacao?.versao ?? null;
    try {
      const r = await api.publicar(comerciante, artigo, {
        canal,
        mercado,
        variantes_fora: pedidas,
        versao: versaoLida,
        // As que o ecrã mostrou: uma criada entretanto dá conflito e o ecrã
        // relê (§27.2).
        variantes_vistas: activas,
      });
      if (!aindaAqui()) return;
      // Lê-se sempre `publicada`, nunca só o estado HTTP (§27.2).
      if (r.publicada) {
        abrirFicha();
        return;
      }
      if (r.verificacao.impedimentos.length === 0) {
        // Sem publicar e sem motivo: não se mostra «Pode publicar».
        setResultado(null);
        setFalha(new ErroDoEcra("erroGenerico"));
        focarDepois.current = "publicar-falha";
        return;
      }
      setResultado({
        chave: chaveActual,
        impedimentos: r.verificacao.impedimentos,
        naoVerificado: r.verificacao.nao_verificado,
        aoPublicar: true,
      });
      focarDepois.current = "publicar-resultado";
      if (
        r.verificacao.impedimentos.some((i) => i.codigo === "preco_em_falta")
      ) {
        void acharListaBase();
      }
      // A verificação guardada pode ter mudado a versão: relê-a, para a
      // próxima tentativa não receber um conflito sem motivo.
      try {
        const agora = await ler();
        if (aindaAqui() && agora !== null) reler(agora);
      } catch {
        // Fica o que se leu: o conflito, se vier, diz-o.
      }
    } catch (erro) {
      if (!aindaAqui()) return;
      await depoisDaFalha(erro, pedidas, versaoLida);
    } finally {
      ocupadoAgora.current = false;
      if (aindaAqui()) setAPublicar(false);
    }
  }

  const naoExiste = !valido;
  const fichaNaoExiste =
    falhaDeLeitura instanceof ErroHub && falhaDeLeitura.estado === 404;
  const ocupado = aVerificar || aPublicar;

  const impedimentos =
    resultado === null || lido === null || par === null
      ? []
      : linhasDosImpedimentos(
          resultado.impedimentos,
          {
            artigo,
            consulta: consulta.replace(/^\?/, ""),
            mercadoNome: par.mercado_nome,
            variantes: lido.ficha.variantes,
            listaBase,
            podeEscrever: ambitos?.escrever === true,
            podeEscreverPrecos: ambitos?.precos === true,
            externo: lido.ficha.origem === "externo",
          },
          (chave) => t[chave],
        );

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoFicha}
          onClick={(e) => {
            e.preventDefault();
            // A publicar, não se sai: a publicação ficava feita sem aviso.
            if (aPublicar) return;
            navegar(destinoFicha, { substituir: true });
          }}
        >
          {lido === null ? t.artigoVoltar : lido.ficha.nome}
        </a>
      </p>
      <h1 id="titulo">{t.publicarTitulo}</h1>
      {naoExiste || fichaNaoExiste ? (
        <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />
      ) : lido === null && falhaDeLeitura !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falhaDeLeitura, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : lido === null || ambitos === null || marcadas === null ? (
        <ACarregar />
      ) : !ambitos.publicar ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : par === null || celulaCanal === null || celulaMercado === null ? (
        <div id="publicar-aviso" tabIndex={-1}>
          <CaixaDeErro erro={{ texto: t.publicarParNaoExiste }} />
        </div>
      ) : (
        <>
          <dl className="valores-actuais">
            <dt>{t.colunaCanal}</dt>
            <dd>{textoDaCelula(celulaCanal)}</dd>
            <dt>{t.colunaMercado}</dt>
            <dd>{textoDaCelula(celulaMercado)}</dd>
            <dt>{t.colunaEstado}</dt>
            <dd>
              {publicacao === null
                ? t.publicarSemPublicacao
                : textoDe(
                    t,
                    `estadoPublicacao_${publicacao.estado}`,
                    publicacao.estado,
                  )}
            </dd>
          </dl>
          {recusa === null ? null : (
            <div
              className="erro"
              role="alert"
              id="publicar-recusa"
              tabIndex={-1}
            >
              {recusa === "conflito" ? (
                <>
                  <p>
                    <strong>{t.publicarConflito}</strong>
                  </p>
                  <p>{t.publicarConflitoActual}</p>
                </>
              ) : (
                <p>{t.publicarSemResposta}</p>
              )}
            </div>
          )}
          {falha === null ? null : (
            <div id="publicar-falha" tabIndex={-1}>
              <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
            </div>
          )}
          <form onSubmit={(e) => void verificar(e)} noValidate>
            <fieldset className="variantes-a-venda">
              <legend>{t.publicarVariantes}</legend>
              <p id="publicar-ajuda" className="secundario">
                {t.publicarVariantesAjuda}
              </p>
              {activas.length === 0 ? (
                <p className="secundario">{t.publicarSemVariantes}</p>
              ) : (
                lido.ficha.variantes
                  .filter((v) => v.estado === "activa")
                  .map((v) => {
                    const marca = apareceram.includes(v.id)
                      ? "nova"
                      : marcaDaVariante(v, publicacao);
                    const estaFora = marca !== null;
                    return (
                      <div className="variante-escolha" key={v.id}>
                        <label className="opcao">
                          <input
                            type="checkbox"
                            id={`publicar-${v.id}`}
                            checked={marcadas.includes(v.id)}
                            disabled={ocupado}
                            aria-describedby={
                              estaFora
                                ? `publicar-${v.id}-fora publicar-ajuda`
                                : "publicar-ajuda"
                            }
                            onChange={(ev) => {
                              mudarMarca(v.id, ev.target.checked);
                            }}
                          />
                          <code translate="no">{v.sku}</code>
                        </label>
                        {estaFora ? (
                          <span
                            id={`publicar-${v.id}-fora`}
                            className="secundario"
                          >
                            {marca === "nova"
                              ? t.publicarNovaMarca
                              : t.publicarForaMarca}
                          </span>
                        ) : null}
                      </div>
                    );
                  })
              )}
            </fieldset>
            <div className="accoes-artigo">
              <button type="submit" disabled={ocupado}>
                {aVerificar ? t.publicarAVerificar : t.publicarVerificar}
              </button>
              {mostrarPublicar ? (
                <button
                  id="publicar-publicar"
                  type="button"
                  className="principal"
                  disabled={ocupado}
                  onClick={() => void publicar()}
                >
                  {aPublicar
                    ? t.publicarAPublicar
                    : publicada
                      ? t.publicarPublicarOutraVez
                      : t.publicarPublicar}
                </button>
              ) : null}
              <button
                type="button"
                disabled={aPublicar}
                onClick={() => {
                  navegar(destinoFicha, { substituir: true });
                }}
              >
                {t.cancelar}
              </button>
            </div>
          </form>
          <div aria-live="polite">
            {desactualizada ? (
              <p className="secundario">{t.publicarPedirOutra}</p>
            ) : null}
          </div>
          {resultado === null || desactualizada ? null : (
            <div
              id="publicar-resultado"
              tabIndex={-1}
              role="status"
              aria-label={t.publicarResultado}
              className={
                resultado.impedimentos.length === 0 ? "sucesso" : "aviso"
              }
            >
              {resultado.aoPublicar ? (
                <p>
                  <strong>{t.publicarNovosImpedimentos}</strong>
                </p>
              ) : null}
              {resultado.impedimentos.length === 0 ? (
                <p>
                  <strong>{t.publicarPodePublicar}</strong>
                </p>
              ) : (
                <>
                  <p>{t.publicarImpedimentos}</p>
                  <ul>
                    {impedimentos.map((i, n) => (
                      <li key={`${i.codigo}-${String(n)}`}>
                        {preencher(t[i.texto], i.valores)}
                        {i.ligacao === null ? null : (
                          <>
                            {" "}
                            <a
                              href={i.ligacao.destino}
                              onClick={(e) => {
                                e.preventDefault();
                                if (i.ligacao !== null) {
                                  navegar(i.ligacao.destino);
                                }
                              }}
                            >
                              {preencher(t[i.ligacao.texto], i.ligacao.valores)}
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="secundario">{t.publicarConformidade}</p>
              {resultado.naoVerificado.includes(
                "traducao_do_texto_alternativo",
              ) ? (
                <p className="secundario">{t.publicarTraducaoMedia}</p>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
