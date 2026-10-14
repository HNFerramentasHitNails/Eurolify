import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  api,
  ErroHub,
  type Devolucao,
  type DevolucaoNaLista,
  type EstadoDevolucao,
  type EtiquetaDevolucao,
  type Eu,
  type ServicosDaDevolucao,
} from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import {
  accoesDaEtiqueta,
  erroDaDevolucao,
  ESTADOS_DEVOLUCAO,
  estadoDoFiltro,
  contagemDaLista,
  idCurto,
  TEXTO_DA_ORIGEM,
  TEXTO_DO_ESTADO_DA_DEVOLUCAO,
} from "../devolucoes";
import {
  ErroDoEcra,
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { TEXTO_DO_ESTADO_DA_ETIQUETA } from "../expedir";
import { entradaDe } from "../modulos";
import { preencher, TAG_LINGUA, type Textos } from "../textos";

// As devoluções no Hub (docs/36 §22.10; Diogo, 14/10/2026: «sim, aprovo;
// avança com o código»): a lista e a página de cada devolução, só leitura,
// e a etiqueta de devolução pela transportadora. A recepção, a inspecção e
// a decisão continuam pela API. O motivo escrito pelo cliente só aparece na
// página da devolução, nunca na lista nem no título da janela.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_DEVOLUCAO = /^rma_[0-9a-f-]{36}$/;

const enderecoDe = (
  comerciante: string,
  caminho = "/devolucoes",
  extra: Record<string, string> = {},
) => `${caminho}?${new URLSearchParams({ comerciante, ...extra }).toString()}`;

/** A data e a hora, ou só o dia (AAAA-MM-DD), na língua escolhida. */
function useDatas() {
  const { lingua } = useHub();
  return {
    hora: (iso: string) =>
      new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)),
    dia: (aaaammdd: string) =>
      new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${aaaammdd}T00:00:00Z`)),
  };
}

const ambitoDe = (eu: Eu | undefined, comerciante: string, ambito: string) =>
  eu?.comerciantes
    .find((c) => c.comerciante === comerciante)
    ?.ambitos.includes(ambito) === true;

function EstadoDaDevolucao({ estado }: { estado: EstadoDevolucao }) {
  const { t } = useHub();
  return (
    <span className="estado-devolucao" data-estado={estado}>
      {t[TEXTO_DO_ESTADO_DA_DEVOLUCAO[estado]]}
    </span>
  );
}

/** O prazo do reembolso, com os dias que faltam (só na livre resolução). */
function Prazo({ d }: { d: DevolucaoNaLista }) {
  const { t } = useHub();
  const { dia } = useDatas();
  // Fechada ou cancelada, já não há prazo a correr.
  if (
    d.reembolsar_ate === null ||
    d.estado === "fechada" ||
    d.estado === "cancelada"
  ) {
    return <>{t.metodosNada}</>;
  }
  const dias = d.dias_para_reembolsar;
  return (
    <>
      {dia(d.reembolsar_ate)}
      {dias === null ? null : (
        <span className="secundario">
          {" "}
          (
          {dias < 0
            ? t.devolucaoPrazoPassado
            : dias === 1
              ? t.devolucaoPrazoUmDia
              : preencher(t.devolucaoPrazoDias, { n: dias })}
          )
        </span>
      )}
    </>
  );
}

// ----------------------------------------------------------------- A lista

export function Devolucoes({
  comerciante,
  consulta,
}: {
  comerciante: string | null;
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const { hora } = useDatas();
  const estado = estadoDoFiltro(new URLSearchParams(consulta).get("estado"));
  const [dados, setDados] = useState<{
    eu: Eu;
    devolucoes: DevolucaoNaLista[];
    limite: number;
  } | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const c = comerciante ?? "";
  const idFiltro = useId();

  // Outro filtro: a lista anterior sai e mostra-se «a carregar», sem
  // desmontar o campo do filtro, que fica com o foco (revisão, P2-3).
  useEffect(() => {
    setDados(null);
  }, [estado]);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, lista] = await Promise.all([
        api.eu(),
        api.devolucoes(c, estado),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, devolucoes: lista.dados, limite: lista.limite });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, c, estado, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const nome = dados?.eu.comerciantes.find((x) => x.comerciante === c)?.nome;
  const n = dados?.devolucoes.length ?? 0;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.devolucoesTitulo}
        {nome === undefined ? "" : ` — ${nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <p>{t.devolucoesExplicacao}</p>
          <div className="campo">
            <label htmlFor={idFiltro}>{t.devolucoesFiltroEstado}</label>
            <select
              id={idFiltro}
              value={estado ?? ""}
              onChange={(ev) => {
                const v = estadoDoFiltro(ev.target.value);
                navegar(
                  enderecoDe(c, "/devolucoes", v === null ? {} : { estado: v }),
                );
              }}
            >
              <option value="">{t.devolucoesFiltroTodos}</option>
              {ESTADOS_DEVOLUCAO.map((e) => (
                <option key={e} value={e}>
                  {t[TEXTO_DO_ESTADO_DA_DEVOLUCAO[e]]}
                </option>
              ))}
            </select>
          </div>
          {erro !== null && dados === null ? (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          ) : dados === null ? (
            <ACarregar />
          ) : (
            <>
              {erro === null ? null : (
                <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
              )}
              <p className="secundario" role="status">
                {(() => {
                  const k = contagemDaLista(n, dados.limite, estado !== null);
                  return preencher(t[k], { n });
                })()}
              </p>
              {n === 0 ? null : (
                <table className="tabela-larga">
                  <thead>
                    <tr>
                      <th scope="col">{t.devolucoesColunaDevolucao}</th>
                      <th scope="col">{t.devolucoesColunaEncomenda}</th>
                      <th scope="col">{t.devolucoesColunaEstado}</th>
                      <th scope="col">{t.devolucoesColunaOrigem}</th>
                      <th scope="col">{t.devolucoesColunaPrazo}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.devolucoes.map((d) => (
                      <tr key={d.id}>
                        <td data-rotulo={t.devolucoesColunaDevolucao}>
                          <LigacaoInterna
                            href={enderecoDe(c, `/devolucoes/${d.id}`)}
                            // Duas no mesmo minuto não se confundem: a
                            // encomenda vai no nome da ligação (revisão, P2-3).
                            aria-label={preencher(t.devolucaoDeEncomenda, {
                              data: hora(d.criada_em),
                              id: idCurto(d.encomenda),
                            })}
                          >
                            {preencher(t.devolucaoDe, {
                              data: hora(d.criada_em),
                            })}
                          </LigacaoInterna>
                        </td>
                        <td data-rotulo={t.devolucoesColunaEncomenda}>
                          <code translate="no">…{idCurto(d.encomenda)}</code>
                        </td>
                        <td data-rotulo={t.devolucoesColunaEstado}>
                          <EstadoDaDevolucao estado={d.estado} />
                        </td>
                        <td data-rotulo={t.devolucoesColunaOrigem}>
                          {t[TEXTO_DA_ORIGEM[d.origem]]}
                        </td>
                        <td data-rotulo={t.devolucoesColunaPrazo}>
                          <Prazo d={d} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------ A devolução

export function DevolucaoPagina({
  comerciante,
  devolucao: idDevolucao,
}: {
  comerciante: string | null;
  devolucao: string;
}) {
  const { t, lingua, navegar } = useHub();
  const { hora } = useDatas();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_DEVOLUCAO.test(idDevolucao);
  const c = comerciante ?? "";
  const [dados, setDados] = useState<{ eu: Eu; d: Devolucao } | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, d] = await Promise.all([
        api.eu(),
        api.devolucao(c, idDevolucao),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, d });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(erroDaDevolucao(e));
    }
  }, [valido, c, idDevolucao, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const d = dados?.d;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={enderecoDe(c)}>
          {t.devolucoesVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {d === undefined
          ? t.devolucaoTitulo
          : preencher(t.devolucaoDe, { data: hora(d.criada_em) })}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && d === undefined ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : d === undefined || dados === null ? (
        <ACarregar />
      ) : (
        <>
          {erro === null ? null : (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          )}
          <p>
            <EstadoDaDevolucao estado={d.estado} />
          </p>
          <dl>
            <dt>{t.devolucoesColunaOrigem}</dt>
            <dd>{t[TEXTO_DA_ORIGEM[d.origem]]}</dd>
            <dt>{t.devolucoesColunaPrazo}</dt>
            <dd>
              <Prazo d={d} />
            </dd>
            <dt>{t.devolucaoTransportadora}</dt>
            <dd>{d.transportadora ?? t.metodosNada}</dd>
            <dt>{t.etiquetaSeguimento}</dt>
            <dd>
              {d.seguimento === null ? (
                t.metodosNada
              ) : (
                <code translate="no">{d.seguimento}</code>
              )}
            </dd>
            <dt>{t.devolucaoMotivo}</dt>
            <dd>{d.motivo ?? t.metodosNada}</dd>
          </dl>

          <h2>{t.devolucaoArtigos}</h2>
          <table className="tabela-larga">
            <thead>
              <tr>
                <th scope="col">{t.devolucaoColunaArtigo}</th>
                <th scope="col">{t.devolucaoColunaPedida}</th>
                <th scope="col">{t.devolucaoColunaRecebida}</th>
                <th scope="col">{t.devolucaoColunaAceite}</th>
              </tr>
            </thead>
            <tbody>
              {d.linhas.map((l) => (
                <tr key={l.linha}>
                  <td data-rotulo={t.devolucaoColunaArtigo}>
                    {l.nome}{" "}
                    <code translate="no" className="secundario">
                      {l.sku}
                    </code>
                  </td>
                  <td data-rotulo={t.devolucaoColunaPedida}>{l.pedida}</td>
                  <td data-rotulo={t.devolucaoColunaRecebida}>
                    {l.recebida ?? t.metodosNada}
                  </td>
                  <td data-rotulo={t.devolucaoColunaAceite}>
                    {l.aceite ?? t.metodosNada}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="secundario">{t.devolucaoSoLeitura}</p>

          <EtiquetaDaDevolucao
            comerciante={c}
            devolucao={d}
            escreve={ambitoDe(dados.eu, c, "returns:write")}
            depois={carregar}
          />
        </>
      )}
    </section>
  );
}

// --------------------------------------------------- A etiqueta de devolução

function EtiquetaDaDevolucao({
  comerciante,
  devolucao: d,
  escreve,
  depois,
}: {
  comerciante: string;
  devolucao: Devolucao;
  escreve: boolean;
  depois: () => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const { hora } = useDatas();
  const id = useId();
  // undefined: a ler; null: ainda sem etiqueta.
  const [etiqueta, setEtiqueta] = useState<
    EtiquetaDevolucao | null | undefined
  >(undefined);
  const [servicos, setServicos] = useState<ServicosDaDevolucao | null>(null);
  const [escolha, setEscolha] = useState("");
  const [motivo, setMotivo] = useState("");
  const [confirmei, setConfirmei] = useState(false);
  const [invalido, setInvalido] = useState<keyof Textos | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [sucesso, setSucesso] = useState<keyof Textos | null>(null);
  const [ocupado, setOcupado] = useState<"pedir" | "anular" | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (falha !== null || sucesso !== null) caixa.current?.focus();
  }, [falha, sucesso]);

  const ultimo = useRef(0);
  const ler = useCallback(
    async (limparErro = false) => {
      // Só a última leitura conta (revisão, P3-2).
      const este = ++ultimo.current;
      try {
        let e: EtiquetaDevolucao | null;
        try {
          e = await api.etiquetaDevolucao(comerciante, d.id);
        } catch (x) {
          // Sem etiqueta ainda: um 404 de envios.
          if (x instanceof ErroHub && x.codigo === "shipping.not_found")
            e = null;
          else throw x;
        }
        if (este !== ultimo.current) return;
        // «Tentar outra vez»: a leitura correu bem, o erro sai (revisão, P2-1).
        if (limparErro) setFalha(null);
        setEtiqueta(e);
        setAgora(Date.now());
        const a = accoesDaEtiqueta(d.estado, e, escreve, Date.now());
        if (a.pedir) {
          const s = await api.servicosDaDevolucao(comerciante, d.id);
          if (este !== ultimo.current) return;
          setServicos(s);
          const [unica] = s.opcoes;
          if (s.opcoes.length === 1 && unica !== undefined) {
            setEscolha(`${unica.conta}|${unica.servico}`);
          }
        } else {
          setServicos(null);
        }
      } catch (x) {
        if (este !== ultimo.current) return;
        if (semSessao(x)) {
          navegar("/entrar", { substituir: true });
          return;
        }
        setFalha(erroDaDevolucao(x));
      }
    },
    [comerciante, d.id, d.estado, escreve, navegar],
  );
  useEffect(() => {
    void ler();
  }, [ler, d.versao]);

  const accoes =
    etiqueta === undefined
      ? null
      : accoesDaEtiqueta(d.estado, etiqueta, escreve, agora);

  /** Uma acção: o erro fica junto, e tudo se relê no fim. */
  const correr = async (
    qual: "pedir" | "anular",
    fn: () => Promise<keyof Textos | null>,
  ) => {
    setOcupado(qual);
    setFalha(null);
    setSucesso(null);
    try {
      setSucesso(await fn());
    } catch (e) {
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(erroDaDevolucao(mostrar));
    } finally {
      setOcupado(null);
      await depois();
      await ler();
    }
  };

  function aoPedir(ev: SyntheticEvent) {
    ev.preventDefault();
    const [conta, servico] = escolha.split("|");
    if (conta === undefined || servico === undefined || conta === "") {
      setInvalido("etiquetaDevolucaoEscolherServico");
      return;
    }
    void correr("pedir", async () => {
      const r = await api.pedirEtiquetaDevolucao(comerciante, d.id, {
        conta,
        servico,
      });
      // Incerta ou recusada é um aviso com foco, não silêncio: pode haver uma
      // etiqueta paga (revisão, P2-2).
      if (r.estado === "incerta") {
        throw new ErroDoEcra("etiquetaDevolucaoFicouIncerta");
      }
      if (r.estado === "recusada") {
        throw new ErroDoEcra("etiquetaDevolucaoFoiRecusada");
      }
      return r.estado === "emitida" ? "etiquetaDevolucaoPedidaAgora" : null;
    });
  }

  function aoAnular(ev: SyntheticEvent) {
    ev.preventDefault();
    if (motivo.trim().length < 3) {
      setInvalido("etiquetaDevolucaoMotivoEmFalta");
      return;
    }
    if (!confirmei) {
      setInvalido("etiquetaDevolucaoConfirmarPainel");
      return;
    }
    void correr("anular", async () => {
      await api.anularEtiquetaDevolucao(comerciante, d.id, motivo.trim());
      setMotivo("");
      setConfirmei(false);
      return "etiquetaDevolucaoAnuladaAgora";
    });
  }

  async function descarregar() {
    try {
      const bytes = await api.ficheiroEtiquetaDevolucao(comerciante, d.id);
      const url = URL.createObjectURL(bytes);
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiqueta-devolucao-${d.id}.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
      // O ficheiro tem dados pessoais: o endereço não fica vivo.
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      // O ficheiro apaga-se 30 dias depois de a devolução acabar.
      setFalha(
        e instanceof ErroHub && e.codigo === "shipping.not_found"
          ? new ErroDoEcra("etiquetaDevolucaoFicheiroJaNao")
          : erroDaDevolucao(e),
      );
    }
  }

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const titulo = `${id}-titulo`;

  return (
    <section aria-labelledby={titulo} className="cartao etiqueta-devolucao">
      <h2 id={titulo}>
        {t.etiquetaDevolucaoTitulo}
        {etiqueta === undefined || etiqueta === null ? null : (
          <>
            {" "}
            <span className="estado-etiqueta" data-estado={etiqueta.estado}>
              {t[TEXTO_DO_ESTADO_DA_ETIQUETA[etiqueta.estado]]}
            </span>
          </>
        )}
      </h2>
      <div ref={caixa} tabIndex={-1}>
        {erro === null ? null : (
          <CaixaDeErro erro={erro} aoTentar={() => void ler(true)} />
        )}
        {sucesso === null ? null : (
          <p className="sucesso" role="status">
            {t[sucesso]}
          </p>
        )}
      </div>
      {etiqueta === undefined ? (
        erro === null ? (
          <ACarregar />
        ) : null
      ) : (
        <>
          {etiqueta === null ? (
            <p className="secundario">
              {d.estado !== "a_aguardar"
                ? t.etiquetaDevolucaoSoAAguardar
                : escreve
                  ? t.etiquetaDevolucaoNenhuma
                  : t.etiquetaDevolucaoSemPermissao}
            </p>
          ) : (
            <>
              {etiqueta.estado === "incerta" ? (
                <p className="aviso" role="note">
                  {t.etiquetaDevolucaoIncertaExplicacao}
                </p>
              ) : null}
              {etiqueta.estado === "recusada" && etiqueta.motivo !== null ? (
                <p className="aviso" role="note">
                  {preencher(t.etiquetaMotivo, { motivo: etiqueta.motivo })}
                </p>
              ) : null}
              <dl>
                <dt>{t.etiquetaDevolucaoServico}</dt>
                <dd>
                  <code translate="no">{etiqueta.servico}</code>
                </dd>
                <dt>{t.etiquetaPeso}</dt>
                <dd>{preencher(t.etiquetaGramas, { g: etiqueta.peso_g })}</dd>
                {etiqueta.seguimento === null ? null : (
                  <>
                    <dt>{t.etiquetaSeguimento}</dt>
                    <dd>
                      {etiqueta.url_seguimento === null ||
                      !etiqueta.url_seguimento.startsWith("https://") ? (
                        <code translate="no">{etiqueta.seguimento}</code>
                      ) : (
                        <a
                          href={etiqueta.url_seguimento}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {etiqueta.seguimento}
                        </a>
                      )}
                    </dd>
                  </>
                )}
                <dt>{t.etiquetaDevolucaoEm}</dt>
                <dd>{hora(etiqueta.em)}</dd>
              </dl>
              {accoes?.descarregar === true ? (
                <div className="accoes">
                  <button type="button" onClick={() => void descarregar()}>
                    {t.etiquetaDevolucaoDescarregar}
                  </button>
                </div>
              ) : null}
            </>
          )}

          {accoes?.pedir === true ? (
            <form noValidate aria-labelledby={`${id}-pedir`} onSubmit={aoPedir}>
              <h3 id={`${id}-pedir`}>
                {etiqueta === null
                  ? t.etiquetaDevolucaoPedir
                  : t.etiquetaDevolucaoPedirOutra}
              </h3>
              {servicos === null ? (
                erro === null ? (
                  <ACarregar />
                ) : null
              ) : servicos.peso_g === null ? (
                <p className="aviso" role="note">
                  {t.etiquetaDevolucaoSemPeso}
                </p>
              ) : servicos.opcoes.length === 0 ? (
                <p>{t.etiquetaDevolucaoSemServicos}</p>
              ) : (
                <>
                  <fieldset
                    {...(invalido === "etiquetaDevolucaoEscolherServico"
                      ? { "aria-describedby": `${id}-erro` }
                      : {})}
                  >
                    <legend>{t.etiquetaDevolucaoServicoAEscolher}</legend>
                    {servicos.opcoes.map((o) => {
                      const valor = `${o.conta}|${o.servico}`;
                      const nome =
                        o.nome[lingua] ??
                        o.nome["pt"] ??
                        Object.values(o.nome)[0];
                      return (
                        <div key={valor}>
                          <label className="opcao">
                            <input
                              type="radio"
                              name={`${id}-servico`}
                              value={valor}
                              checked={escolha === valor}
                              onChange={() => {
                                setEscolha(valor);
                                setInvalido(null);
                              }}
                            />
                            <span>
                              {o.conta_nome} — {nome ?? o.servico}{" "}
                              <code translate="no">{o.servico}</code>
                            </span>
                          </label>
                        </div>
                      );
                    })}
                  </fieldset>
                  <p className="secundario">
                    {preencher(t.etiquetaDevolucaoPesoDaCaixa, {
                      g: preencher(t.etiquetaGramas, { g: servicos.peso_g }),
                    })}
                  </p>
                  <p className="aviso" role="note">
                    {t.etiquetaDevolucaoCusto}
                  </p>
                  {invalido === "etiquetaDevolucaoEscolherServico" ? (
                    <p id={`${id}-erro`} className="erro-campo" role="alert">
                      {t[invalido]}
                    </p>
                  ) : null}
                  <div className="accoes">
                    <button
                      type="submit"
                      className="principal"
                      disabled={ocupado !== null}
                    >
                      {ocupado === "pedir"
                        ? t.etiquetaAPedir
                        : t.etiquetaDevolucaoPedirBotao}
                    </button>
                  </div>
                </>
              )}
            </form>
          ) : null}

          {accoes?.anular === true ? (
            <form
              noValidate
              aria-labelledby={`${id}-anular`}
              onSubmit={aoAnular}
            >
              <h3 id={`${id}-anular`}>{t.etiquetaDevolucaoAnular}</h3>
              <p className="secundario">{t.etiquetaDevolucaoAnularAjuda}</p>
              {accoes.anularAPartirDe === null ? null : (
                <p className="aviso" role="note">
                  {preencher(t.etiquetaDevolucaoAnularAPartirDe, {
                    hora: hora(accoes.anularAPartirDe.toISOString()),
                  })}
                </p>
              )}
              <div className="campo">
                <label htmlFor={`${id}-motivo`}>
                  {t.etiquetaDevolucaoMotivoAnular}
                </label>
                <textarea
                  id={`${id}-motivo`}
                  maxLength={500}
                  rows={2}
                  value={motivo}
                  {...(invalido === "etiquetaDevolucaoMotivoEmFalta"
                    ? {
                        "aria-invalid": true,
                        "aria-describedby": `${id}-erro-anular`,
                      }
                    : {})}
                  onChange={(ev) => {
                    setMotivo(ev.target.value);
                    setInvalido(null);
                  }}
                />
              </div>
              <div className="campo">
                <label className="opcao">
                  <input
                    type="checkbox"
                    checked={confirmei}
                    {...(invalido === "etiquetaDevolucaoConfirmarPainel"
                      ? {
                          "aria-invalid": true,
                          "aria-describedby": `${id}-erro-anular`,
                        }
                      : {})}
                    onChange={(ev) => {
                      setConfirmei(ev.target.checked);
                      setInvalido(null);
                    }}
                  />
                  <span>{t.etiquetaDevolucaoConfirmeiNoPainel}</span>
                </label>
              </div>
              {invalido === "etiquetaDevolucaoMotivoEmFalta" ||
              invalido === "etiquetaDevolucaoConfirmarPainel" ? (
                <p id={`${id}-erro-anular`} className="erro-campo" role="alert">
                  {t[invalido]}
                </p>
              ) : null}
              <div className="accoes">
                <button type="submit" disabled={ocupado !== null}>
                  {ocupado === "anular"
                    ? t.aCarregar
                    : t.etiquetaDevolucaoAnularBotao}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
