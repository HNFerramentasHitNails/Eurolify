import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ErroHub, type FichaArtigo } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import {
  moverNaLista,
  valoresDoTexto,
  variantesIncompletas,
  type OpcaoArtigo,
} from "../opcoes";
import { preencher } from "../textos";

// Editar as opções do artigo (docs/22 §21.3), pelos caminhos /hub/ da §21.2.
// Num rascunho: criar, mudar o nome e os valores, apagar e dar valores às
// variantes. Em qualquer estado: acrescentar valores e mudar a ordem. O ecrã
// só esconde o que a API recusaria; quem decide é a API (as recusas dela
// aparecem como vêm). Uma acção de cada vez; depois de cada uma, as opções
// relêem-se. Com a `versao` antiga (outra pessoa mudou a opção), o ecrã
// di-lo, relê e deixa o texto escrito à vista.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ARTIGO =
  /^prd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAXIMO_TEXTO = 100;

type Aviso = "guardado" | "conflito" | null;

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
  const [falha, setFalha] = useState<unknown>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, setOcupado] = useState(false);
  // O que se está a escrever, por id: fica depois de uma recusa.
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
      // Os campos de cada opção começam no que está guardado; o que a
      // pessoa escreveu e não gravou fica (só se acrescenta o que falta).
      setNomes((antes) =>
        Object.fromEntries(o.map((x) => [x.id, antes[x.id] ?? x.nome])),
      );
      setTextos((antes) =>
        Object.fromEntries(
          o
            .flatMap((x) => x.valores)
            .map((v) => [v.id, antes[v.id] ?? v.valor]),
        ),
      );
      setEscolhas(
        Object.fromEntries(
          f.variantes.map((v) => [
            v.id,
            Object.fromEntries(
              o.map((x) => [x.id, valorIdDaVariante(x, v.id)]),
            ),
          ]),
        ),
      );
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaCarga(e);
    }
  }, [valido, c, artigo, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O aviso ou o erro de uma acção recebem o foco: o botão usado pode ter
  // saído do ecrã (como na ficha, §13.4).
  const mensagemRef = useRef<HTMLDivElement>(null);
  const porFocar = useRef(false);
  useLayoutEffect(() => {
    if (!porFocar.current || mensagemRef.current === null) return;
    porFocar.current = false;
    mensagemRef.current.focus();
  }, [aviso, falha]);

  /** Corre uma escrita e relê as opções; o conflito de versão relê e diz. */
  async function agir(
    escrita: () => Promise<unknown>,
    depois?: () => void,
  ): Promise<void> {
    if (!valido || ocupado) return;
    setOcupado(true);
    setFalha(null);
    setAviso(null);
    try {
      await escrita();
      if (!montado.current) return;
      depois?.();
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
        setFalha(e);
      }
      await carregar();
    } finally {
      if (montado.current) setOcupado(false);
    }
  }

  const naoExiste =
    !valido ||
    (falhaCarga instanceof ErroHub &&
      falhaCarga.estado === 404 &&
      ficha === null);
  const rascunho = ficha?.estado === "rascunho";
  const activas = ficha?.variantes.filter((v) => v.estado === "activa") ?? [];
  const incompletas =
    opcoes === null ? [] : variantesIncompletas(opcoes, activas);

  function moverOpcao(i: number, passo: -1 | 1) {
    if (opcoes === null) return;
    const ordem = moverNaLista(
      opcoes.map((o) => o.id),
      i,
      passo,
    );
    if (ordem === null) return;
    void agir(() => api.ordenarOpcoes(c, artigo, ordem));
  }

  function moverValor(o: OpcaoArtigo, i: number, passo: -1 | 1) {
    const ordem = moverNaLista(
      o.valores.map((v) => v.id),
      i,
      passo,
    );
    if (ordem === null) return;
    void agir(() => api.ordenarValores(c, o.id, ordem, o.versao));
  }

  function apagarOpcao(o: OpcaoArtigo) {
    const pergunta = preencher(t.opcoesConfirmarApagarOpcao, {
      nome: o.nome,
      n: activas.length,
    });
    if (!window.confirm(pergunta)) return;
    void agir(() => api.apagarOpcao(c, o.id, o.versao));
  }

  function apagarValor(o: OpcaoArtigo, v: { id: string; valor: string }) {
    const pergunta = preencher(t.opcoesConfirmarApagarValor, {
      valor: v.valor,
      nome: o.nome,
    });
    if (!window.confirm(pergunta)) return;
    void agir(() => api.apagarValor(c, o.id, v.id, o.versao));
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
            {falha === null ? null : (
              <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
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
                    const nome = (nomes[o.id] ?? "").trim();
                    if (nome === "") return;
                    void agir(() =>
                      api.mudarNomeDaOpcao(c, o.id, {
                        nome,
                        versao: o.versao,
                      }),
                    );
                  }}
                >
                  <div className="campo">
                    <label htmlFor={`nome-${o.id}`}>{t.opcoesNome}</label>
                    <input
                      id={`nome-${o.id}`}
                      maxLength={MAXIMO_TEXTO}
                      value={nomes[o.id] ?? o.nome}
                      onChange={(e) => {
                        setNomes({ ...nomes, [o.id]: e.target.value });
                      }}
                    />
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
                  aria-label={`${t.opcoesMoverAntes}: ${o.nome}`}
                  onClick={() => {
                    moverOpcao(i, -1);
                  }}
                >
                  {t.opcoesMoverAntes}
                </button>
                <button
                  type="button"
                  disabled={ocupado || i === opcoes.length - 1}
                  aria-label={`${t.opcoesMoverDepois}: ${o.nome}`}
                  onClick={() => {
                    moverOpcao(i, 1);
                  }}
                >
                  {t.opcoesMoverDepois}
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
                {o.valores.map((v, j) => (
                  <li key={v.id}>
                    {rascunho ? (
                      <form
                        className="linha"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const valor = (textos[v.id] ?? "").trim();
                          if (valor === "") return;
                          void agir(() =>
                            api.mudarTextoDoValor(c, o.id, v.id, {
                              valor,
                              versao: o.versao,
                            }),
                          );
                        }}
                      >
                        <input
                          aria-label={`${t.opcoesValor} ${v.valor}`}
                          maxLength={MAXIMO_TEXTO}
                          value={textos[v.id] ?? v.valor}
                          onChange={(e) => {
                            setTextos({ ...textos, [v.id]: e.target.value });
                          }}
                        />
                        <button
                          type="submit"
                          disabled={ocupado}
                          aria-label={`${t.opcoesGuardar} ${v.valor}`}
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
                        aria-label={`${t.opcoesMoverAntes}: ${v.valor}`}
                        onClick={() => {
                          moverValor(o, j, -1);
                        }}
                      >
                        {t.opcoesMoverAntes}
                      </button>
                      <button
                        type="button"
                        disabled={ocupado || j === o.valores.length - 1}
                        aria-label={`${t.opcoesMoverDepois}: ${v.valor}`}
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
                          aria-label={`${t.opcoesApagarValor} ${v.valor}`}
                          onClick={() => {
                            apagarValor(o, v);
                          }}
                        >
                          {t.opcoesApagarValor}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="linha"
                onSubmit={(e) => {
                  e.preventDefault();
                  const valor = (novos[o.id] ?? "").trim();
                  if (valor === "") return;
                  void agir(
                    () =>
                      api.acrescentarValor(c, o.id, {
                        valor,
                        versao: o.versao,
                      }),
                    () => {
                      setNovos({ ...novos, [o.id]: "" });
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
                    maxLength={MAXIMO_TEXTO}
                    value={novos[o.id] ?? ""}
                    onChange={(e) => {
                      setNovos({ ...novos, [o.id]: e.target.value });
                    }}
                  />
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
              onSubmit={(e) => {
                e.preventDefault();
                const nome = nova.nome.trim();
                const valores = valoresDoTexto(nova.valores);
                if (nome === "" || valores.length === 0) return;
                void agir(
                  () => api.criarOpcao(c, artigo, { nome, valores }),
                  () => {
                    setNova({ nome: "", valores: "" });
                  },
                );
              }}
            >
              <h2>{t.opcoesCriar}</h2>
              <div className="campo">
                <label htmlFor="opcao-nova-nome">{t.opcoesNovaNome}</label>
                <input
                  id="opcao-nova-nome"
                  maxLength={MAXIMO_TEXTO}
                  value={nova.nome}
                  onChange={(e) => {
                    setNova({ ...nova, nome: e.target.value });
                  }}
                />
              </div>
              <div className="campo">
                <label htmlFor="opcao-nova-valores">
                  {t.opcoesNovaValores}
                </label>
                <textarea
                  id="opcao-nova-valores"
                  rows={4}
                  value={nova.valores}
                  onChange={(e) => {
                    setNova({ ...nova, valores: e.target.value });
                  }}
                />
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
                            value={
                              escolhas[v.id]?.[o.id] ??
                              valorIdDaVariante(o, v.id)
                            }
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
                          disabled={ocupado}
                          onClick={() => {
                            const valores = opcoes
                              .map(
                                (o) =>
                                  escolhas[v.id]?.[o.id] ??
                                  valorIdDaVariante(o, v.id),
                              )
                              .filter((x) => x !== "");
                            void agir(() =>
                              api.valoresDaVariante(c, v.id, valores),
                            );
                          }}
                        >
                          {preencher(t.opcoesGuardarVariante, { sku: v.sku })}
                        </button>
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

/** O id do valor da variante nesta opção, ou "" (sem valor). */
function valorIdDaVariante(o: OpcaoArtigo, variante: string): string {
  return o.valores.find((v) => v.variantes.includes(variante))?.id ?? "";
}
