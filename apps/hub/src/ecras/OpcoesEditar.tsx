import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ErroHub, type FichaArtigo } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { ErroDoEcra, mensagemDeErro, semSessao } from "../erros";
import {
  MAXIMO_TEXTO_OPCAO,
  moverNaLista,
  valoresDoTexto,
  variantesComValor,
  variantesIncompletas,
  type OpcaoArtigo,
} from "../opcoes";
import { preencher } from "../textos";

// Editar as opções do artigo (docs/22 §21.3), pelos caminhos /hub/ da §21.2.
// Num rascunho: criar, mudar o nome e os valores, apagar e dar valores às
// variantes. Em qualquer estado: acrescentar valores e mudar a ordem. O ecrã
// só esconde o que a API recusaria; quem decide é a API (as recusas dela
// aparecem ao lado do campo ou da linha onde nasceram). Uma acção de cada
// vez; depois de cada uma, as opções relêem-se. Só o que a pessoa escreveu
// e ainda não gravou fica por cima do que está guardado (revisão do #297,
// P2-1 e P2-2): um campo que ninguém mexeu mostra sempre o da base. Com a
// `versao` antiga (outra pessoa mudou a opção), o ecrã di-lo, relê e deixa
// o texto escrito à vista.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ARTIGO =
  /^prd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Aviso = "guardado" | "conflito" | null;

/** Uma falha e onde nasceu (o id do campo ou do botão), ou no topo. */
interface Falha {
  onde: string | null;
  erro: unknown;
}

/** Tira uma chave de um registo (o campo voltou ao que está guardado). */
function sem<T>(registo: Record<string, T>, chave: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(registo).filter(([k]) => k !== chave),
  );
}

export function OpcoesEditar({
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
  // O comerciante já conferido (os pedidos só correm com `valido`).
  const c = comerciante ?? "";
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ARTIGO.test(artigo);
  const [ficha, setFicha] = useState<FichaArtigo | null>(null);
  const [opcoes, setOpcoes] = useState<OpcaoArtigo[] | null>(null);
  const [podeEscrever, setPodeEscrever] = useState(false);
  const [falhaCarga, setFalhaCarga] = useState<unknown>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, setOcupado] = useState(false);
  // Só o que a pessoa escreveu e não gravou, por id.
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [novos, setNovos] = useState<Record<string, string>>({});
  const [nova, setNova] = useState({ nome: "", valores: "" });
  const [escolhas, setEscolhas] = useState<
    Record<string, Record<string, string>>
  >({});
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
    setFalhaCarga(null);
    try {
      const [f, o, eu] = await Promise.all([
        api.artigo(c, artigo),
        api.opcoesDoArtigo(c, artigo),
        api.eu(),
      ]);
      if (!montado.current) return;
      setPodeEscrever(
        eu.comerciantes
          .find((x) => x.comerciante === comerciante)
          ?.ambitos.includes("catalog:write") === true,
      );
      setFicha(f);
      setOpcoes(o);
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaCarga(e);
    }
  }, [valido, c, comerciante, artigo, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O aviso ou o erro de uma acção recebem o foco: o do topo, ou o campo
  // onde nasceu o erro (o erro dele está ligado por aria-describedby).
  const mensagemRef = useRef<HTMLDivElement>(null);
  const porFocar = useRef(false);
  useLayoutEffect(() => {
    if (!porFocar.current) return;
    porFocar.current = false;
    const campo =
      falha?.onde === null || falha === null
        ? null
        : document.getElementById(falha.onde);
    (campo ?? mensagemRef.current)?.focus();
  }, [aviso, falha]);

  /**
   * Corre uma escrita e relê as opções; o conflito de versão relê e diz.
   * `onde`: o id do campo ou do botão que a pediu (o erro aparece ali).
   * `gravado`: o que fazer depois de gravar (tirar o que estava escrito).
   */
  async function agir(
    escrita: () => Promise<unknown>,
    onde: string | null,
    gravado?: () => void,
  ): Promise<void> {
    if (!valido || ocupado) return;
    setOcupado(true);
    setFalha(null);
    setAviso(null);
    try {
      await escrita();
      if (!montado.current) return;
      gravado?.();
      porFocar.current = true;
      setAviso("guardado");
      await carregar();
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      porFocar.current = true;
      if (e instanceof ErroHub && e.codigo === "catalog.version_conflict") {
        setAviso("conflito");
      } else {
        setFalha({ onde, erro: e });
      }
      await carregar();
    } finally {
      if (montado.current) setOcupado(false);
    }
  }

  /** Um campo por preencher: diz-se ao lado dele, sem pedir à API. */
  function recusar(
    onde: string,
    chave: "opcoesNomeVazio" | "opcoesValoresVazios" | "opcoesValorLongo",
  ) {
    porFocar.current = true;
    setAviso(null);
    setFalha({ onde, erro: new ErroDoEcra(chave) });
  }

  /** O erro de um campo, ao lado dele (com o id para aria-describedby). */
  function erroDe(onde: string) {
    if (falha === null || falha.onde !== onde) return null;
    return (
      <p id={`${onde}-erro`} className="erro-campo" role="alert">
        {mensagemDeErro(falha.erro, t, lingua).texto}
      </p>
    );
  }
  const comErro = (onde: string) =>
    falha?.onde === onde
      ? { "aria-invalid": true, "aria-describedby": `${onde}-erro` }
      : {};

  const naoExiste =
    !valido ||
    (falhaCarga instanceof ErroHub &&
      falhaCarga.estado === 404 &&
      ficha === null);
  const rascunho = ficha?.estado === "rascunho";
  const activas = ficha?.variantes.filter((v) => v.estado === "activa") ?? [];
  const incompletas =
    opcoes === null ? [] : variantesIncompletas(opcoes, activas);
  const idDoValor = (o: OpcaoArtigo, variante: string) =>
    escolhas[variante]?.[o.id] ??
    o.valores.find((x) => x.variantes.includes(variante))?.id ??
    "";

  function moverOpcao(i: number, passo: -1 | 1) {
    if (opcoes === null) return;
    const ordem = moverNaLista(
      opcoes.map((o) => o.id),
      i,
      passo,
    );
    if (ordem === null) return;
    void agir(() => api.ordenarOpcoes(c, artigo, ordem), null);
  }

  function moverValor(o: OpcaoArtigo, i: number, passo: -1 | 1) {
    const ordem = moverNaLista(
      o.valores.map((v) => v.id),
      i,
      passo,
    );
    if (ordem === null) return;
    void agir(() => api.ordenarValores(c, o.id, ordem, o.versao), null);
  }

  function apagarOpcao(o: OpcaoArtigo) {
    const n = variantesComValor(o, activas).length;
    const pergunta =
      n === 0
        ? preencher(t.opcoesConfirmarApagarOpcaoNenhuma, { nome: o.nome })
        : n === 1
          ? preencher(t.opcoesConfirmarApagarOpcaoUma, { nome: o.nome })
          : preencher(t.opcoesConfirmarApagarOpcao, { nome: o.nome, n });
    if (!window.confirm(pergunta)) return;
    void agir(() => api.apagarOpcao(c, o.id, o.versao), null);
  }

  function apagarValor(o: OpcaoArtigo, v: { id: string; valor: string }) {
    const pergunta = preencher(t.opcoesConfirmarApagarValor, {
      valor: v.valor,
      nome: o.nome,
    });
    if (!window.confirm(pergunta)) return;
    void agir(
      () => api.apagarValor(c, o.id, v.id, o.versao),
      null,
      () => {
        setTextos((x) => sem(x, v.id));
      },
    );
  }

  function guardarVariante(variante: string) {
    if (opcoes === null) return;
    const valores = opcoes
      .map((o) => idDoValor(o, variante))
      .filter((x) => x !== "");
    void agir(
      () => api.valoresDaVariante(c, variante, valores),
      `guardar-${variante}`,
      () => {
        // Só esta linha volta ao que está guardado; as outras ficam como a
        // pessoa as deixou (revisão do #297, P2-2).
        setEscolhas((x) => sem(x, variante));
      },
    );
  }

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
      <h1 id="titulo">{t.opcoesTitulo}</h1>
      {naoExiste ? (
        <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />
      ) : (ficha === null || opcoes === null) && falhaCarga !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falhaCarga, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : ficha === null || opcoes === null ? (
        <ACarregar />
      ) : !podeEscrever ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : ficha.origem === "externo" ? (
        <p className="secundario">{t.artigoExternoAviso}</p>
      ) : (
        <>
          {rascunho ? null : <p className="secundario">{t.opcoesSoRascunho}</p>}
          <div tabIndex={-1} ref={mensagemRef} className="falha-accao">
            {aviso === "guardado" ? (
              <p className="secundario" role="status">
                {t.opcoesGuardado}
              </p>
            ) : aviso === "conflito" ? (
              <p className="erro-campo" role="alert">
                {t.opcoesConflito}
              </p>
            ) : null}
            {falha === null || falha.onde !== null ? null : (
              <CaixaDeErro erro={mensagemDeErro(falha.erro, t, lingua)} />
            )}
            {falhaCarga === null ? null : (
              // A leitura depois de uma acção falhou: o que se vê pode estar
              // atrasado (revisão do #297, P3-3).
              <CaixaDeErro
                erro={mensagemDeErro(falhaCarga, t, lingua)}
                aoTentar={() => void carregar()}
              />
            )}
          </div>
          {opcoes.length === 0 ? (
            <p className="secundario">{t.opcoesSemOpcoes}</p>
          ) : null}
          {opcoes.map((o, i) => (
            <fieldset className="opcao-editar" key={o.id}>
              <legend>{o.nome}</legend>
              {rascunho ? (
                <form
                  className="linha"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const onde = `nome-${o.id}`;
                    const nome = (nomes[o.id] ?? o.nome).trim();
                    if (nome === "") {
                      recusar(onde, "opcoesNomeVazio");
                      return;
                    }
                    void agir(
                      () =>
                        api.mudarNomeDaOpcao(c, o.id, {
                          nome,
                          versao: o.versao,
                        }),
                      onde,
                      () => {
                        setNomes((x) => sem(x, o.id));
                      },
                    );
                  }}
                >
                  <div className="campo">
                    <label htmlFor={`nome-${o.id}`}>{t.opcoesNome}</label>
                    <input
                      id={`nome-${o.id}`}
                      maxLength={MAXIMO_TEXTO_OPCAO}
                      value={nomes[o.id] ?? o.nome}
                      {...comErro(`nome-${o.id}`)}
                      onChange={(e) => {
                        setNomes({ ...nomes, [o.id]: e.target.value });
                      }}
                    />
                    {erroDe(`nome-${o.id}`)}
                  </div>
                  <button type="submit" disabled={ocupado}>
                    {t.opcoesGuardarNome}
                  </button>
                </form>
              ) : null}
              <div className="accoes-artigo">
                <button
                  type="button"
                  disabled={ocupado || i === 0}
                  aria-label={`${t.opcoesMoverOpcaoAntes}: ${o.nome}`}
                  onClick={() => {
                    moverOpcao(i, -1);
                  }}
                >
                  {t.opcoesMoverOpcaoAntes}
                </button>
                <button
                  type="button"
                  disabled={ocupado || i === opcoes.length - 1}
                  aria-label={`${t.opcoesMoverOpcaoDepois}: ${o.nome}`}
                  onClick={() => {
                    moverOpcao(i, 1);
                  }}
                >
                  {t.opcoesMoverOpcaoDepois}
                </button>
                {rascunho ? (
                  <button
                    type="button"
                    disabled={ocupado}
                    aria-label={`${t.opcoesApagarOpcao} ${o.nome}`}
                    onClick={() => {
                      apagarOpcao(o);
                    }}
                  >
                    {t.opcoesApagarOpcao}
                  </button>
                ) : null}
              </div>
              <ul
                className="valores-opcao"
                aria-label={preencher(t.opcoesValoresDe, { nome: o.nome })}
              >
                {o.valores.map((v, j) => {
                  // O nome da opção no nome dos botões: duas opções podem ter
                  // um valor com o mesmo texto (revisão do #297, P3-6).
                  const deQuem = `${o.nome} ${v.valor}`;
                  const onde = `valor-${v.id}`;
                  return (
                    <li key={v.id}>
                      {rascunho ? (
                        <form
                          className="linha"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const valor = (textos[v.id] ?? v.valor).trim();
                            if (valor === "") {
                              recusar(onde, "opcoesValoresVazios");
                              return;
                            }
                            void agir(
                              () =>
                                api.mudarTextoDoValor(c, o.id, v.id, {
                                  valor,
                                  versao: o.versao,
                                }),
                              onde,
                              () => {
                                setTextos((x) => sem(x, v.id));
                              },
                            );
                          }}
                        >
                          <div className="campo">
                            <input
                              id={onde}
                              aria-label={`${t.opcoesValor}: ${deQuem}`}
                              maxLength={MAXIMO_TEXTO_OPCAO}
                              value={textos[v.id] ?? v.valor}
                              {...comErro(onde)}
                              onChange={(e) => {
                                setTextos({
                                  ...textos,
                                  [v.id]: e.target.value,
                                });
                              }}
                            />
                            {erroDe(onde)}
                          </div>
                          <button
                            type="submit"
                            disabled={ocupado}
                            aria-label={`${t.opcoesGuardar}: ${deQuem}`}
                          >
                            {t.opcoesGuardar}
                          </button>
                        </form>
                      ) : (
                        <span className="valor-opcao">{v.valor}</span>
                      )}
                      <div className="accoes-imagem">
                        <button
                          type="button"
                          disabled={ocupado || j === 0}
                          aria-label={`${t.opcoesMoverAntes}: ${deQuem}`}
                          onClick={() => {
                            moverValor(o, j, -1);
                          }}
                        >
                          {t.opcoesMoverAntes}
                        </button>
                        <button
                          type="button"
                          disabled={ocupado || j === o.valores.length - 1}
                          aria-label={`${t.opcoesMoverDepois}: ${deQuem}`}
                          onClick={() => {
                            moverValor(o, j, 1);
                          }}
                        >
                          {t.opcoesMoverDepois}
                        </button>
                        {rascunho ? (
                          <button
                            type="button"
                            disabled={ocupado}
                            aria-label={`${t.opcoesApagarValor}: ${deQuem}`}
                            onClick={() => {
                              apagarValor(o, v);
                            }}
                          >
                            {t.opcoesApagarValor}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <form
                className="linha"
                onSubmit={(e) => {
                  e.preventDefault();
                  const onde = `novo-${o.id}`;
                  const valor = (novos[o.id] ?? "").trim();
                  if (valor === "") {
                    recusar(onde, "opcoesValoresVazios");
                    return;
                  }
                  void agir(
                    () =>
                      api.acrescentarValor(c, o.id, {
                        valor,
                        versao: o.versao,
                      }),
                    onde,
                    () => {
                      setNovos((x) => sem(x, o.id));
                    },
                  );
                }}
              >
                <div className="campo">
                  <label htmlFor={`novo-${o.id}`}>
                    {preencher(t.opcoesNovoValor, { nome: o.nome })}
                  </label>
                  <input
                    id={`novo-${o.id}`}
                    maxLength={MAXIMO_TEXTO_OPCAO}
                    value={novos[o.id] ?? ""}
                    {...comErro(`novo-${o.id}`)}
                    onChange={(e) => {
                      setNovos({ ...novos, [o.id]: e.target.value });
                    }}
                  />
                  {erroDe(`novo-${o.id}`)}
                </div>
                <button type="submit" disabled={ocupado}>
                  {t.opcoesAcrescentarValor}
                </button>
              </form>
            </fieldset>
          ))}
          {rascunho ? (
            <form
              className="opcao-editar"
              aria-labelledby="opcao-nova-titulo"
              onSubmit={(e) => {
                e.preventDefault();
                const nome = nova.nome.trim();
                const valores = valoresDoTexto(nova.valores);
                if (nome === "") {
                  recusar("opcao-nova-nome", "opcoesNomeVazio");
                  return;
                }
                if (valores.length === 0) {
                  recusar("opcao-nova-valores", "opcoesValoresVazios");
                  return;
                }
                if (valores.some((v) => v.length > MAXIMO_TEXTO_OPCAO)) {
                  recusar("opcao-nova-valores", "opcoesValorLongo");
                  return;
                }
                void agir(
                  () => api.criarOpcao(c, artigo, { nome, valores }),
                  "opcao-nova-nome",
                  () => {
                    setNova({ nome: "", valores: "" });
                  },
                );
              }}
            >
              <h2 id="opcao-nova-titulo">{t.opcoesCriar}</h2>
              <div className="campo">
                <label htmlFor="opcao-nova-nome">{t.opcoesNovaNome}</label>
                <input
                  id="opcao-nova-nome"
                  maxLength={MAXIMO_TEXTO_OPCAO}
                  value={nova.nome}
                  {...comErro("opcao-nova-nome")}
                  onChange={(e) => {
                    setNova({ ...nova, nome: e.target.value });
                  }}
                />
                {erroDe("opcao-nova-nome")}
              </div>
              <div className="campo">
                <label htmlFor="opcao-nova-valores">
                  {t.opcoesNovaValores}
                </label>
                <textarea
                  id="opcao-nova-valores"
                  rows={4}
                  value={nova.valores}
                  {...comErro("opcao-nova-valores")}
                  onChange={(e) => {
                    setNova({ ...nova, valores: e.target.value });
                  }}
                />
                {erroDe("opcao-nova-valores")}
              </div>
              <button type="submit" disabled={ocupado}>
                {t.opcoesCriar}
              </button>
            </form>
          ) : null}
          {rascunho && opcoes.length > 0 && activas.length > 0 ? (
            <>
              <h2>{t.opcoesVariantes}</h2>
              {incompletas.length === 0 ? null : (
                <p className="secundario">
                  {incompletas.length === 1
                    ? t.opcoesIncompleta
                    : preencher(t.opcoesIncompletas, {
                        n: incompletas.length,
                      })}
                </p>
              )}
              <table className="tabela-larga variantes-artigo">
                <thead>
                  <tr>
                    <th scope="col">{t.artigosSku}</th>
                    {opcoes.map((o) => (
                      <th scope="col" key={o.id}>
                        {o.nome}
                      </th>
                    ))}
                    <th scope="col">{t.colunaAccoes}</th>
                  </tr>
                </thead>
                <tbody>
                  {activas.map((v) => (
                    <tr key={v.id}>
                      <td data-rotulo={t.artigosSku}>
                        <code translate="no">{v.sku}</code>
                      </td>
                      {opcoes.map((o) => (
                        <td data-rotulo={o.nome} key={o.id}>
                          <select
                            aria-label={`${o.nome}: ${v.sku}`}
                            value={idDoValor(o, v.id)}
                            onChange={(e) => {
                              setEscolhas({
                                ...escolhas,
                                [v.id]: {
                                  ...(escolhas[v.id] ?? {}),
                                  [o.id]: e.target.value,
                                },
                              });
                            }}
                          >
                            <option value="">—</option>
                            {o.valores.map((x) => (
                              <option value={x.id} key={x.id}>
                                {x.valor}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                      <td data-rotulo={t.colunaAccoes}>
                        <button
                          type="button"
                          id={`guardar-${v.id}`}
                          disabled={ocupado}
                          {...comErro(`guardar-${v.id}`)}
                          onClick={() => {
                            guardarVariante(v.id);
                          }}
                        >
                          {preencher(t.opcoesGuardarVariante, { sku: v.sku })}
                        </button>
                        {erroDe(`guardar-${v.id}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
