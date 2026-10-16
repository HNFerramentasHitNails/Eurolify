import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  api,
  ErroHub,
  type Encomenda,
  type EncomendaNaLista,
  type Eu,
  type Membros,
  type TransicaoDaEncomenda,
} from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import {
  contactoDe,
  contagemDaLista,
  dataLimiteDe,
  emCentimos,
  enderecoEncomenda,
  enderecoEncomendas,
  ESTADOS_ENCOMENDA,
  estadoDoFiltro,
  idCurto,
  ivaDaLinha,
  moradaDe,
  nomeDoMetodo,
  perfilDe,
  quemFez,
  taxaEmTexto,
  TEXTO_DO_DOCUMENTO,
  TEXTO_DO_EMISSOR,
  textoDoEstado,
  totalDosPortes,
} from "../encomendas";
import {
  ErroDoEcra,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { entradaDe } from "../modulos";
import { preencher, TAG_LINGUA, type Lingua } from "../textos";

// As encomendas no Hub (docs/22 §35; issue #475): a lista e a ficha, só
// leitura. O estado, os totais e a decisão de IVA vêm da API e mostram-se
// como vêm; nenhuma acção de negócio nova. Os dados pessoais só na ficha, a
// quem a API os dá (orders:read), e nunca na lista nem no título da janela.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ENCOMENDA = /^ord_[0-9a-f-]{36}$/;

function useDatas() {
  const { lingua } = useHub();
  return (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
}

const ambitoDe = (eu: Eu | undefined, comerciante: string, ambito: string) =>
  eu?.comerciantes
    .find((c) => c.comerciante === comerciante)
    ?.ambitos.includes(ambito) === true;

/** O estado, com o nome e a cor, nunca só a cor. */
function Estado({ estado }: { estado: string }) {
  const { t } = useHub();
  return (
    <span className="estado-encomenda" data-estado={estado}>
      {textoDoEstado(t, estado)}
    </span>
  );
}

// ----------------------------------------------------------------- A lista

export function Encomendas({
  comerciante,
  consulta,
}: {
  comerciante: string | null;
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const hora = useDatas();
  const tag = TAG_LINGUA[lingua];
  const estado = estadoDoFiltro(new URLSearchParams(consulta).get("estado"));
  const [dados, setDados] = useState<{
    eu: Eu;
    lista: EncomendaNaLista[];
    limite: number;
  } | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const c = comerciante ?? "";
  const idFiltro = useId();

  // Outro filtro: a lista anterior sai e mostra-se «a carregar», sem
  // desmontar o campo do filtro, que fica com o foco.
  useEffect(() => {
    setDados(null);
  }, [estado]);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, r] = await Promise.all([api.eu(), api.encomendas(c, estado)]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, lista: r.dados, limite: r.limite });
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
  const n = dados?.lista.length ?? 0;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.encomendasTitulo}
        {nome === undefined ? "" : ` — ${nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <p>{t.encomendasExplicacao}</p>
          <div className="campo">
            <label htmlFor={idFiltro}>{t.encomendasFiltroEstado}</label>
            <select
              id={idFiltro}
              value={estado ?? ""}
              onChange={(ev) => {
                navegar(enderecoEncomendas(c, estadoDoFiltro(ev.target.value)));
              }}
            >
              <option value="">{t.encomendasFiltroTodos}</option>
              {ESTADOS_ENCOMENDA.map((e) => (
                <option key={e} value={e}>
                  {textoDoEstado(t, e)}
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
                {preencher(
                  t[contagemDaLista(n, dados.limite, estado !== null)],
                  {
                    n,
                  },
                )}
              </p>
              {n === 0 ? null : (
                <table className="tabela-larga">
                  <thead>
                    <tr>
                      <th scope="col">{t.encomendasColunaEncomenda}</th>
                      <th scope="col">{t.encomendasColunaEstado}</th>
                      <th scope="col">{t.encomendasColunaTotal}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.lista.map((e) => (
                      <tr key={e.id}>
                        <td data-rotulo={t.encomendasColunaEncomenda}>
                          <LigacaoInterna
                            href={enderecoEncomenda(c, e.id)}
                            // Duas no mesmo minuto não se confundem: o fim
                            // do identificador vai no nome da ligação.
                            aria-label={preencher(t.encomendaDeComId, {
                              data: hora(e.criada_em),
                              id: idCurto(e.id),
                            })}
                          >
                            {preencher(t.encomendaDe, {
                              data: hora(e.criada_em),
                            })}
                          </LigacaoInterna>{" "}
                          <code translate="no" className="secundario">
                            …{idCurto(e.id)}
                          </code>
                        </td>
                        <td data-rotulo={t.encomendasColunaEstado}>
                          <Estado estado={e.estado} />
                        </td>
                        <td data-rotulo={t.encomendasColunaTotal}>
                          {emCentimos(e.total, e.moeda, tag)}
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

// ------------------------------------------------------------- A ficha

/** Um 404 diz-se com palavras; o resto segue o caminho comum. */
const erroDaFicha = (e: unknown): unknown =>
  e instanceof ErroHub && e.estado === 404
    ? new ErroDoEcra("encomendaNaoExiste")
    : e;

export function EncomendaPagina({
  comerciante,
  encomenda: idEncomenda,
}: {
  comerciante: string | null;
  encomenda: string;
}) {
  const { t, lingua, navegar } = useHub();
  const hora = useDatas();
  const tag = TAG_LINGUA[lingua];
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ENCOMENDA.test(idEncomenda);
  const c = comerciante ?? "";
  const [dados, setDados] = useState<{ eu: Eu; e: Encomenda } | null>(null);
  const [rasto, setRasto] = useState<TransicaoDaEncomenda[] | null>(null);
  const [rastoFalhou, setRastoFalhou] = useState(false);
  const [membros, setMembros] = useState<Membros["membros"]>([]);
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, e] = await Promise.all([
        api.eu(),
        api.encomenda(c, idEncomenda),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, e });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(erroDaFicha(e));
      return;
    }
    // O rasto e os nomes não travam a ficha: se falharem, diz-se.
    try {
      const r = await api.rastoDaEncomenda(c, idEncomenda);
      if (este === ultimo.current) {
        setRasto(r.dados);
        setRastoFalhou(false);
      }
    } catch {
      if (este === ultimo.current) setRastoFalhou(true);
    }
    try {
      const m = await api.membros(c);
      if (este === ultimo.current) setMembros(m.membros);
    } catch {
      // sem nomes, diz-se «uma pessoa da equipa»
    }
  }, [valido, c, idEncomenda, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const e = dados?.e;
  const vistaDoArmazem = ambitoDe(dados?.eu, c, "fulfilment:read");

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={enderecoEncomendas(c)}>
          {t.encomendasVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {e === undefined
          ? t.encomendaTitulo
          : preencher(t.encomendaDe, { data: hora(e.criada_em) })}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && e === undefined ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : e === undefined ? (
        <ACarregar />
      ) : (
        <>
          {erro === null ? null : (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          )}
          <p>
            <Estado estado={e.estado} />{" "}
            <code translate="no" className="secundario" title={e.id}>
              …{idCurto(e.id)}
            </code>
          </p>
          {vistaDoArmazem ? (
            <p>
              <LigacaoInterna
                href={`/expedir/${e.id}?${new URLSearchParams({ comerciante: c }).toString()}`}
              >
                {t.encomendaVerExpedicao}
              </LigacaoInterna>
            </p>
          ) : null}

          <Linhas e={e} tag={tag} />
          <Totais e={e} tag={tag} />
          <Destino e={e} lingua={lingua} />
          <Faturacao e={e} />
          <Rasto
            rasto={rasto}
            falhou={rastoFalhou}
            membros={membros}
            eu={dados?.eu}
            hora={hora}
          />
        </>
      )}
    </section>
  );
}

function Linhas({ e, tag }: { e: Encomenda; tag: string }) {
  const { t } = useHub();
  return (
    <section className="cartao" aria-labelledby="titulo-linhas">
      <h2 id="titulo-linhas">{t.encomendaLinhas}</h2>
      <table className="tabela-larga">
        <thead>
          <tr>
            <th scope="col">{t.encomendaColunaArtigo}</th>
            <th scope="col">{t.encomendaColunaQuantidade}</th>
            <th scope="col">{t.encomendaColunaPreco}</th>
            <th scope="col">{t.encomendaColunaIva}</th>
            <th scope="col">{t.encomendaColunaTotal}</th>
          </tr>
        </thead>
        <tbody>
          {e.linhas.map((l) => {
            const iva = ivaDaLinha(l.decisao_iva);
            return (
              <tr key={l.id}>
                <td data-rotulo={t.encomendaColunaArtigo}>
                  {l.nome}{" "}
                  <code translate="no" className="secundario">
                    {l.sku}
                  </code>
                  {l.selado_por_higiene ? (
                    <>
                      <br />
                      <span className="secundario">
                        {t.encomendaSeladoPorHigiene}
                      </span>
                    </>
                  ) : null}
                </td>
                <td data-rotulo={t.encomendaColunaQuantidade}>
                  {l.quantidade}
                </td>
                <td data-rotulo={t.encomendaColunaPreco}>
                  {emCentimos(l.preco_unitario, e.moeda, tag)}
                </td>
                <td data-rotulo={t.encomendaColunaIva}>
                  {iva.tipo === "tributada"
                    ? preencher(t.encomendaIvaTaxa, {
                        taxa: taxaEmTexto(iva.taxa, tag),
                        valor: emCentimos(l.iva, e.moeda, tag),
                      })
                    : iva.tipo === "isenta"
                      ? preencher(t.encomendaIvaIsenta, {
                          valor: emCentimos(l.iva, e.moeda, tag),
                        })
                      : iva.tipo === "bloqueada"
                        ? t.encomendaIvaBloqueada
                        : t.encomendaIvaDesconhecida}
                </td>
                <td data-rotulo={t.encomendaColunaTotal}>
                  {emCentimos(l.total, e.moeda, tag)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Totais({ e, tag }: { e: Encomenda; tag: string }) {
  const { t } = useHub();
  const portes = totalDosPortes(e.portes);
  const dinheiro = (x: number) => emCentimos(x, e.moeda, tag);
  return (
    <section className="cartao" aria-labelledby="titulo-totais">
      <h2 id="titulo-totais">{t.encomendaTotais}</h2>
      <dl>
        <dt>{t.encomendaBase}</dt>
        <dd>{dinheiro(e.totais.base)}</dd>
        <dt>{t.encomendaIva}</dt>
        <dd>{dinheiro(e.totais.iva)}</dd>
        {portes === null ? null : (
          <>
            <dt>{t.encomendaPortes}</dt>
            <dd>{dinheiro(portes)}</dd>
          </>
        )}
        <dt>{t.encomendaTotal}</dt>
        <dd>
          <strong>{dinheiro(e.totais.total)}</strong>
        </dd>
      </dl>
      <p className="secundario">
        {e.preco_inclui_iva ? t.encomendaPrecosComIva : t.encomendaPrecosSemIva}
      </p>
      <p>
        {t.encomendaPagamento}{" "}
        {e.metodo_pagamento === null
          ? t.metodosNada
          : ((t as Record<string, string>)[
              `metodoPagamento_${e.metodo_pagamento}`
            ] ?? e.metodo_pagamento)}
      </p>
    </section>
  );
}

function Destino({ e, lingua }: { e: Encomenda; lingua: Lingua }) {
  const { t } = useHub();
  const morada = moradaDe(e.entrega);
  const contacto = contactoDe(e.contacto);
  const metodo = nomeDoMetodo(e.metodo_entrega, lingua);
  const limite = dataLimiteDe(e.metodo_entrega);
  return (
    <section className="cartao" aria-labelledby="titulo-destino">
      <h2 id="titulo-destino">{t.encomendaEntrega}</h2>
      {metodo === null ? null : <p>{metodo}</p>}
      {limite === null ? null : (
        <p className="secundario">
          {preencher(t.encomendaDataLimite, {
            data: new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(new Date(`${limite}T00:00:00Z`)),
          })}
        </p>
      )}
      {morada === null ? (
        <p>{t.encomendaSemMorada}</p>
      ) : (
        <address className="morada">
          {morada.ponto === null ? null : (
            <>
              <strong>{t.expedirPontoRecolha}</strong> {morada.ponto}
              <br />
            </>
          )}
          {morada.linhas.map((x, i) => (
            <span key={x}>
              {i === 0 ? "" : <br />}
              {x}
            </span>
          ))}
        </address>
      )}
      {contacto === null ? null : (
        <>
          <h3>{t.encomendaContacto}</h3>
          <p>
            {contacto.nome ?? ""}
            {contacto.email === null ? null : (
              <>
                <br />
                <a href={`mailto:${contacto.email}`}>{contacto.email}</a>
              </>
            )}
            {contacto.telefone === null ? null : (
              <>
                <br />
                <a href={`tel:${contacto.telefone}`}>{contacto.telefone}</a>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function Faturacao({ e }: { e: Encomenda }) {
  const { t } = useHub();
  const perfil = perfilDe(e.perfil_copia);
  const emissor = TEXTO_DO_EMISSOR[e.emissor_fiscal];
  const documento =
    e.documento === null ? undefined : TEXTO_DO_DOCUMENTO[e.documento.estado];
  return (
    <section className="cartao" aria-labelledby="titulo-faturacao">
      <h2 id="titulo-faturacao">{t.encomendaFaturacao}</h2>
      <dl>
        <dt>{t.encomendaEmissor}</dt>
        <dd>{emissor === undefined ? e.emissor_fiscal : t[emissor]}</dd>
        <dt>{t.encomendaDocumento}</dt>
        <dd>
          {e.documento === null
            ? t.encomendaSemDocumento
            : documento === undefined
              ? e.documento.estado
              : t[documento]}
        </dd>
        <dt>{t.encomendaPerfil}</dt>
        <dd>
          {perfil === null ? (
            e.perfil_copia === null && e.guardado_por_obrigacao_fiscal ? (
              t.encomendaPerfilReservado
            ) : (
              t.metodosNada
            )
          ) : (
            <>
              {perfil.nome ?? ""}
              {perfil.nif === null ? null : (
                <>
                  {" · "}
                  <code translate="no">{perfil.nif}</code>
                </>
              )}
            </>
          )}
        </dd>
      </dl>
      <p className="secundario">{t.encomendaDocumentoAviso}</p>
    </section>
  );
}

function Rasto({
  rasto,
  falhou,
  membros,
  eu,
  hora,
}: {
  rasto: TransicaoDaEncomenda[] | null;
  falhou: boolean;
  membros: Membros["membros"];
  eu: Eu | undefined;
  hora: (iso: string) => string;
}) {
  const { t } = useHub();
  const euId = eu === undefined ? null : eu.pessoa.replace(/^per_/, "");
  const nomeDe = (q: ReturnType<typeof quemFez>): string => {
    switch (q.tipo) {
      case "pessoa":
        if (q.pessoa !== null && q.pessoa === euId) return t.encomendaPorSi;
        return (
          membros.find((m) => m.pessoa === q.pessoa)?.nome ??
          t.diferencaPessoaDesconhecida
        );
      case "chave":
        return t.historicoChaveSemNome;
      case "sistema":
        return t.historicoAutomatico;
      case "consumidor":
        return t.rastoAutor_consumidor;
      case "prestador":
        return t.rastoAutor_prestador;
      case "operador":
        return t.rastoAutor_operador;
      default:
        return t.encomendaQuemDesconhecido;
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-rasto">
      <h2 id="titulo-rasto">{t.encomendaRasto}</h2>
      {falhou ? (
        <p className="secundario" role="status">
          {t.encomendaRastoFalhou}
        </p>
      ) : rasto === null ? (
        <ACarregar />
      ) : rasto.length === 0 ? (
        <p className="secundario">{t.encomendaRastoVazio}</p>
      ) : (
        <ol className="eventos">
          {rasto.map((x, i) => (
            <li key={`${x.em}-${String(i)}`}>
              <time dateTime={x.em}>{hora(x.em)}</time>
              {" — "}
              {x.de === null
                ? textoDoEstado(t, x.para)
                : preencher(t.encomendaDePara, {
                    de: textoDoEstado(t, x.de),
                    para: textoDoEstado(t, x.para),
                  })}
              {" · "}
              {nomeDe(quemFez(x))}
              {x.motivo === null ? null : (
                <>
                  <br />
                  <span className="secundario">{x.motivo}</span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
