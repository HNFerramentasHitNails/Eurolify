import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  api,
  ErroHub,
  type EncomendaParaExpedir,
  type Eu,
  type EtiquetaExpedicao,
  type CorrecaoExpedicao,
  type EventoSeguimento,
  type ExpedicaoResumo,
  type ServicosDaExpedicao,
} from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import {
  ErroDoEcra,
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import {
  accoesDaExpedicao,
  comEtiqueta,
  conferirQuantidades,
  erroDeExpedir,
  maxVolumesDaEtiqueta,
  motivoServe,
  nomeDoMetodo,
  pesoDoTexto,
  porExpedir,
  quantidadesPorOmissao,
  TEXTO_DO_ESTADO_DA_ENCOMENDA,
  TEXTO_DO_ESTADO_DA_ETIQUETA,
  TEXTO_DO_ESTADO_DA_EXPEDICAO,
  totalPorExpedir,
  volumesDoTexto,
} from "../expedir";
import { entradaDe } from "../modulos";
import { preencher, TAG_LINGUA, type Textos } from "../textos";

// O ecrã «Expedir» do Hub (docs/22 §33; Diogo, 13/10/2026: «sim, aprovo;
// avança com o código»): o trabalho do armazém, da encomenda paga à caixa
// com a etiqueta. O dono, o gestor e o armazém expedem (`fulfilment:write`);
// o apoio só vê. A vista não tem preços, NIF nem e-mail; o nome, o telefone
// e a morada de quem recebe ficam só na página, nunca no título da janela.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ENCOMENDA = /^ord_[0-9a-f-]{36}$/;
/** O máximo que a API dá de cada vez (`GET /hub/fulfilment/orders`). */
const MAXIMO_DA_LISTA = 100;

const enderecoDe = (comerciante: string, caminho = "/expedir") =>
  `${caminho}?${new URLSearchParams({ comerciante }).toString()}`;

/** A data e a hora, na língua escolhida. */
function useData() {
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

const textoDoEstado = (t: Textos, estado: string) => {
  const chave = TEXTO_DO_ESTADO_DA_ENCOMENDA[estado];
  return chave === undefined ? estado : t[chave];
};

// ----------------------------------------------------------------- A lista

export function Expedir({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const data = useData();
  const [dados, setDados] = useState<{
    eu: Eu;
    encomendas: EncomendaParaExpedir[];
  } | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const c = comerciante ?? "";

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, lista] = await Promise.all([api.eu(), api.paraExpedir(c)]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, encomendas: lista.dados });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, c, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const nome = dados?.eu.comerciantes.find((x) => x.comerciante === c)?.nome;
  const n = dados?.encomendas.length ?? 0;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.expedirTitulo}
        {nome === undefined ? "" : ` — ${nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && dados === null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : dados === null ? (
        <ACarregar />
      ) : (
        <>
          {erro === null ? null : (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          )}
          <p>{t.expedirExplicacao}</p>
          <p className="secundario" role="status">
            {n === 0
              ? t.expedirVazio
              : n === 1
                ? t.expedirContagemUm
                : n >= MAXIMO_DA_LISTA
                  ? preencher(t.expedirContagemMaximo, { n })
                  : preencher(t.expedirContagem, { n })}
          </p>
          {n === 0 ? null : (
            <table className="tabela-larga">
              <thead>
                <tr>
                  <th scope="col">{t.expedirColunaEncomenda}</th>
                  <th scope="col">{t.expedirColunaEstado}</th>
                  <th scope="col">{t.expedirColunaMetodo}</th>
                  <th scope="col">{t.expedirColunaPorExpedir}</th>
                  <th scope="col">{t.expedirColunaLocalidade}</th>
                </tr>
              </thead>
              <tbody>
                {dados.encomendas.map((e) => (
                  <tr key={e.id}>
                    <td data-rotulo={t.expedirColunaEncomenda}>
                      <LigacaoInterna href={enderecoDe(c, `/expedir/${e.id}`)}>
                        {preencher(t.expedirEncomendaDe, {
                          data: data(e.criada_em),
                        })}
                      </LigacaoInterna>
                    </td>
                    <td data-rotulo={t.expedirColunaEstado}>
                      <span className="estado-encomenda" data-estado={e.estado}>
                        {textoDoEstado(t, e.estado)}
                      </span>
                    </td>
                    <td data-rotulo={t.expedirColunaMetodo}>
                      {nomeDoMetodo(e.metodo_entrega, lingua)}
                    </td>
                    <td data-rotulo={t.expedirColunaPorExpedir}>
                      {totalPorExpedir(e)}
                    </td>
                    <td data-rotulo={t.expedirColunaLocalidade}>
                      {e.entrega?.localidade ?? t.metodosNada}
                      {e.entrega?.ponto === undefined
                        ? ""
                        : ` (${t.expedirParaPonto})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------ A encomenda

type Encomenda = EncomendaParaExpedir & { expedicoes: ExpedicaoResumo[] };

export function ExpedirEncomenda({
  comerciante,
  encomenda: idEncomenda,
}: {
  comerciante: string | null;
  encomenda: string;
}) {
  const { t, lingua, navegar } = useHub();
  const data = useData();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ENCOMENDA.test(idEncomenda);
  const c = comerciante ?? "";
  const [dados, setDados] = useState<{ eu: Eu; encomenda: Encomenda } | null>(
    null,
  );
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);
  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, encomenda] = await Promise.all([
        api.eu(),
        api.encomendaParaExpedir(c, idEncomenda),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, encomenda });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, c, idEncomenda, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(erroDeExpedir(falha), t, lingua);
  const expede = ambitoDe(dados?.eu, c, "fulfilment:write");
  // Mudar o serviço muda o custo e a transportadora: o dono e o gestor
  // (shipping:write; docs/36 §19).
  const mudaServico = ambitoDe(dados?.eu, c, "shipping:write");
  const e = dados?.encomenda;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={valido ? enderecoDe(c) : "/"}>
          {t.expedirVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {e === undefined
          ? t.expedirEncomendaTitulo
          : preencher(t.expedirEncomendaDe, { data: data(e.criada_em) })}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && dados === null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : e === undefined ? (
        <ACarregar />
      ) : (
        <>
          {erro === null ? null : (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          )}
          <p>
            <span className="estado-encomenda" data-estado={e.estado}>
              {textoDoEstado(t, e.estado)}
            </span>{" "}
            · {nomeDoMetodo(e.metodo_entrega, lingua)}
            {comEtiqueta(e.metodo_entrega) ? "" : ` (${t.metodosManual})`}
          </p>
          {!expede ? <p className="secundario">{t.expedirSoVer}</p> : null}
          <section className="cartao" aria-labelledby="titulo-destino">
            <h2 id="titulo-destino">{t.expedirQuemRecebe}</h2>
            <address className="morada">
              {e.destinatario.nome ?? ""}
              {e.entrega === null ? null : (
                <>
                  {e.entrega.ponto === undefined ? null : (
                    <>
                      <br />
                      <strong>{t.expedirPontoRecolha}</strong>{" "}
                      {e.entrega.ponto.nome}
                    </>
                  )}
                  <br />
                  {e.entrega.linha1 ?? ""}
                  {e.entrega.linha2 === undefined ||
                  e.entrega.linha2 === "" ? null : (
                    <>
                      <br />
                      {e.entrega.linha2}
                    </>
                  )}
                  <br />
                  {`${e.entrega.codigo_postal ?? ""} ${e.entrega.localidade ?? ""}`}
                  <br />
                  {e.entrega.pais ?? ""}
                </>
              )}
            </address>
            {e.entrega?.ponto === undefined ? null : (
              <p className="secundario">{t.expedirPontoAjuda}</p>
            )}
            {e.destinatario.telefone === null ? null : (
              <p>
                {t.expedirTelefone}{" "}
                <a href={`tel:${e.destinatario.telefone}`}>
                  {e.destinatario.telefone}
                </a>
              </p>
            )}
          </section>
          <NovaExpedicao
            key={e.expedicoes.map((x) => `${x.id}:${String(x.versao)}`).join()}
            comerciante={c}
            encomenda={e}
            expede={expede}
            depois={carregar}
          />
          <section aria-labelledby="titulo-expedicoes">
            <h2 id="titulo-expedicoes">{t.expedirExpedicoes}</h2>
            {e.expedicoes.length === 0 ? (
              <p>{t.expedirSemExpedicoes}</p>
            ) : (
              <ul className="lista-expedicoes">
                {e.expedicoes.map((x, i) => (
                  <Expedicao
                    key={x.id}
                    comerciante={c}
                    numero={i + 1}
                    expedicao={x}
                    comConta={comEtiqueta(e.metodo_entrega)}
                    expede={expede}
                    mudaServico={mudaServico}
                    depois={carregar}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------- Criar uma expedição

function NovaExpedicao({
  comerciante,
  encomenda,
  expede,
  depois,
}: {
  comerciante: string;
  encomenda: Encomenda;
  expede: boolean;
  depois: () => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const [quantidades, setQuantidades] = useState(() =>
    quantidadesPorOmissao(encomenda),
  );
  const [invalida, setInvalida] = useState<string | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (falha !== null) caixa.current?.focus();
  }, [falha]);
  const faltam = encomenda.linhas.filter((l) => porExpedir(l) > 0);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);

  function aoCriar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (ocupado) return;
    const r = conferirQuantidades(encomenda, quantidades);
    if (r.linhas === null) {
      setInvalida(r.falta.linha);
      setFalha(new ErroDoEcra(r.falta.texto));
      return;
    }
    setInvalida(null);
    setFalha(null);
    setOcupado(true);
    void (async () => {
      try {
        await api.criarExpedicao(comerciante, encomenda.id, r.linhas);
      } catch (e) {
        const mostrar = await falhaDeAccao(e);
        if (mostrar === null) {
          navegar("/entrar", { substituir: true });
          return;
        }
        // Sem resposta, relê-se em vez de repetir. O servidor só recusa um
        // segundo pedido quando passa do que falta: uma expedição parcial
        // repetida seria aceite (docs/22 §33.2; revisão do #418, P2-2).
        setFalha(
          mostrar instanceof ErroHub &&
            (mostrar.estado === 0 || mostrar.estado >= 500)
            ? new ErroDoEcra("expedirTalvezCriada")
            : erroDeExpedir(mostrar),
        );
      } finally {
        setOcupado(false);
        await depois();
      }
    })();
  }

  return (
    <section className="cartao" aria-labelledby="titulo-linhas">
      <h2 id="titulo-linhas">{t.expedirLinhas}</h2>
      {erro === null ? null : (
        <div ref={caixa} tabIndex={-1}>
          <CaixaDeErro erro={erro} id="erro-nova-expedicao" />
        </div>
      )}
      <form onSubmit={aoCriar} noValidate>
        <table className="tabela-larga">
          <thead>
            <tr>
              <th scope="col">{t.expedirColunaArtigo}</th>
              <th scope="col">{t.expedirColunaQuantidade}</th>
              <th scope="col">{t.expedirColunaJaSaiu}</th>
              {expede && faltam.length > 0 ? (
                <th scope="col">{t.expedirColunaNestaExpedicao}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {encomenda.linhas.map((l) => (
              <tr key={l.id}>
                <td data-rotulo={t.expedirColunaArtigo}>
                  {l.nome}
                  <br />
                  <code className="secundario" translate="no">
                    {l.sku}
                  </code>
                </td>
                <td data-rotulo={t.expedirColunaQuantidade}>{l.quantidade}</td>
                <td data-rotulo={t.expedirColunaJaSaiu}>{l.expedida}</td>
                {expede && faltam.length > 0 ? (
                  <td data-rotulo={t.expedirColunaNestaExpedicao}>
                    {porExpedir(l) === 0 ? (
                      t.metodosNada
                    ) : (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={porExpedir(l)}
                        aria-label={preencher(t.expedirQuantidadeDe, {
                          nome: l.nome,
                        })}
                        value={quantidades[l.id] ?? ""}
                        disabled={ocupado}
                        {...(invalida === l.id
                          ? {
                              "aria-invalid": true,
                              "aria-describedby": "erro-nova-expedicao",
                            }
                          : {})}
                        onChange={(ev) => {
                          setQuantidades((q) => ({
                            ...q,
                            [l.id]: ev.target.value,
                          }));
                          if (invalida === l.id) setInvalida(null);
                        }}
                      />
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {faltam.length === 0 ? (
          <p className="secundario">{t.expedirTudoSaiu}</p>
        ) : expede ? (
          <button type="submit" className="principal" disabled={ocupado}>
            {t.expedirCriar}
          </button>
        ) : null}
      </form>
    </section>
  );
}

// ------------------------------------------------------ Uma expedição

function Expedicao({
  comerciante,
  numero,
  expedicao: x,
  comConta,
  expede,
  mudaServico,
  depois,
}: {
  comerciante: string;
  numero: number;
  expedicao: ExpedicaoResumo;
  comConta: boolean;
  expede: boolean;
  mudaServico: boolean;
  depois: () => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const data = useData();
  const [etiqueta, setEtiqueta] = useState<EtiquetaExpedicao | null>(null);
  const [eventos, setEventos] = useState<EventoSeguimento[] | null>(null);
  const [correccoes, setCorreccoes] = useState<CorrecaoExpedicao[]>([]);
  const [falha, setFalha] = useState<unknown>(null);
  const [sucesso, setSucesso] = useState<keyof Textos | null>(null);
  const [conflito, setConflito] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [transportadora, setTransportadora] = useState(x.transportadora ?? "");
  const [seguimento, setSeguimento] = useState(x.seguimento ?? "");
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (falha !== null || sucesso !== null) caixa.current?.focus();
  }, [falha, sucesso]);

  const lerEtiqueta = useCallback(async () => {
    if (!comConta) return;
    try {
      const [e, ev, cr] = await Promise.all([
        api.etiqueta(comerciante, x.id),
        api.eventosSeguimento(comerciante, x.id),
        api.correcoesDaExpedicao(comerciante, x.id),
      ]);
      setEtiqueta(e);
      setEventos(ev.dados);
      setCorreccoes(cr.dados);
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(erroDeExpedir(e));
    }
  }, [comConta, comerciante, x.id, navegar]);
  useEffect(() => {
    void lerEtiqueta();
  }, [lerEtiqueta, x.versao]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const criada = x.estado === "criada";
  // Com conta e a etiqueta ainda por ler, nada se oferece até se saber.
  const accoes = accoesDaExpedicao(
    comConta ? (etiqueta?.etiqueta ?? "a_pedir") : null,
    x.estado,
  );
  const falhaDaEtiqueta = comConta && etiqueta === null && falha !== null;

  /** Uma acção: o erro fica junto, e tudo se relê no fim. */
  const correr = async (
    qual: string,
    fn: () => Promise<keyof Textos | null>,
  ) => {
    setOcupado(qual);
    setFalha(null);
    setSucesso(null);
    setConflito(false);
    try {
      setSucesso(await fn());
    } catch (e) {
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setConflito(
        mostrar instanceof ErroHub &&
          (mostrar.codigo === "inventory.version_conflict" ||
            mostrar.codigo === "shipping.version_conflict"),
      );
      setFalha(erroDeExpedir(mostrar));
    } finally {
      setOcupado(null);
      await depois();
      await lerEtiqueta();
    }
  };

  const mudarEstado = (
    estado:
      | "expedida"
      | "entregue"
      | "devolvida_ao_remetente"
      | "perdida"
      | "cancelada",
    confirmar: keyof Textos | null,
    feito: keyof Textos,
    extra: { transportadora?: string | null; seguimento?: string | null } = {},
  ) => {
    if (confirmar !== null && !window.confirm(t[confirmar])) return;
    void correr(estado, async () => {
      await api.mudarExpedicao(comerciante, x.id, {
        versao: x.versao,
        estado,
        ...extra,
      });
      return feito;
    });
  };

  const manualTexto = () => ({
    transportadora: transportadora.trim() === "" ? null : transportadora.trim(),
    seguimento: seguimento.trim() === "" ? null : seguimento.trim(),
  });

  async function descarregar(volume = 1) {
    try {
      const bytes = await api.ficheiroEtiqueta(comerciante, x.id, volume);
      const url = URL.createObjectURL(bytes);
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiqueta-${x.id}${volume === 1 ? "" : `-volume-${String(volume)}`}.${etiqueta?.ficheiro === "zpl" ? "zpl" : "pdf"}`;
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
      // O ficheiro apaga-se 30 dias depois de a expedição acabar.
      setFalha(
        e instanceof ErroHub && e.codigo === "shipping.not_found"
          ? new ErroDoEcra("etiquetaFicheiroJaNao")
          : erroDeExpedir(e),
      );
    }
  }

  const titulo = `titulo-expedicao-${x.id}`;
  return (
    <li className="cartao">
      <section aria-labelledby={titulo}>
        <h3 id={titulo}>
          {preencher(t.expedirExpedicaoNumero, { n: numero })}{" "}
          <span className="estado-expedicao" data-estado={x.estado}>
            {t[TEXTO_DO_ESTADO_DA_EXPEDICAO[x.estado]]}
          </span>
        </h3>
        {x.expedida_em === null ? null : (
          <p className="secundario">
            {preencher(t.expedirSaiuEm, { data: data(x.expedida_em) })}
          </p>
        )}
        <div ref={caixa} tabIndex={-1}>
          {erro === null ? null : (
            <CaixaDeErro
              erro={erro}
              {...(conflito
                ? { aoTentar: () => void depois() }
                : falhaDaEtiqueta
                  ? { aoTentar: () => void lerEtiqueta() }
                  : {})}
            />
          )}
          {sucesso === null ? null : (
            <p className="sucesso" role="status">
              {t[sucesso]}
            </p>
          )}
        </div>
        {comConta ? (
          etiqueta === null ? (
            erro === null ? (
              <ACarregar />
            ) : null
          ) : (
            <>
              <p>
                {t.etiquetaTitulo}{" "}
                <span
                  className="estado-etiqueta"
                  data-estado={etiqueta.etiqueta}
                >
                  {t[TEXTO_DO_ESTADO_DA_ETIQUETA[etiqueta.etiqueta]]}
                </span>
              </p>
              {etiqueta.etiqueta === "recusada" && etiqueta.motivo !== null ? (
                <p className="aviso" role="note">
                  {preencher(t.etiquetaMotivo, { motivo: etiqueta.motivo })}
                </p>
              ) : null}
              {etiqueta.etiqueta === "incerta" ? (
                <p className="aviso" role="note">
                  {t.etiquetaIncertaExplicacao}
                </p>
              ) : null}
              <dl>
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
                {etiqueta.peso_g === null ? null : (
                  <>
                    <dt>
                      {etiqueta.volumes == null
                        ? t.etiquetaPeso
                        : t.volumesPesoTotal}
                    </dt>
                    <dd>
                      {preencher(t.etiquetaGramas, { g: etiqueta.peso_g })}
                    </dd>
                  </>
                )}
              </dl>
              {etiqueta.peso_corrigido_g == null ? null : (
                <p className="secundario">{t.pesoCorrigidoNota}</p>
              )}
              {etiqueta.volumes == null ? null : (
                // Várias caixas (docs/36 §23): o peso, o seguimento e o
                // ficheiro de cada uma.
                <>
                  <h4>
                    {preencher(t.volumesContagem, {
                      n: etiqueta.volumes.length,
                    })}
                  </h4>
                  <ol className="eventos">
                    {etiqueta.volumes.map((v) => (
                      <li key={v.volume}>
                        {preencher(t.volumesLinha, {
                          n: v.volume,
                          g: preencher(t.etiquetaGramas, { g: v.peso_g }),
                        })}
                        {v.seguimento === null ? null : (
                          <>
                            {" — "}
                            <code translate="no">{v.seguimento}</code>
                          </>
                        )}
                        {v.ficheiro === null ? null : (
                          <>
                            {" "}
                            <button
                              type="button"
                              disabled={ocupado !== null}
                              onClick={() => void descarregar(v.volume)}
                            >
                              {preencher(t.volumesDescarregar, {
                                n: v.volume,
                              })}
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {etiqueta.escolhido == null ? null : (
                <p className="secundario">
                  {t.servicoEscolhidoNota}{" "}
                  <code translate="no">{etiqueta.escolhido.servico}</code>
                </p>
              )}
              <div className="accoes">
                {expede && accoes.pedir ? (
                  <button
                    type="button"
                    className="principal"
                    disabled={ocupado !== null}
                    onClick={() => {
                      void correr("pedir", async () => {
                        const r = await api.pedirEtiqueta(comerciante, x.id);
                        return r.etiqueta === "emitida"
                          ? "etiquetaPedidaAgora"
                          : null;
                      });
                    }}
                  >
                    {ocupado === "pedir" ? t.etiquetaAPedir : t.etiquetaPedir}
                  </button>
                ) : null}
                {etiqueta.ficheiro === null ||
                etiqueta.volumes != null ? null : (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => void descarregar()}
                  >
                    {t.etiquetaDescarregar}
                  </button>
                )}
                {expede && accoes.consultar ? (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => {
                      void correr("consultar", async () => {
                        await api.consultarTransportadora(comerciante, x.id);
                        return "etiquetaConsultadaAgora";
                      });
                    }}
                  >
                    {t.etiquetaConsultar}
                  </button>
                ) : null}
                {expede && accoes.anular ? (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => {
                      if (!window.confirm(t.etiquetaAnularConfirmar)) return;
                      void correr("anular", async () => {
                        await api.anularEtiqueta(comerciante, x.id);
                        return "etiquetaAnuladaAgora";
                      });
                    }}
                  >
                    {t.etiquetaAnular}
                  </button>
                ) : null}
              </div>
              {etiqueta.ficheiro === null ? null : (
                <p className="secundario">{t.etiquetaFicheiroApaga}</p>
              )}
              {expede && accoes.pedir ? (
                <Correccoes
                  comerciante={comerciante}
                  expedicao={x.id}
                  mudaServico={mudaServico}
                  ocupado={ocupado !== null}
                  concluido={async (texto) => {
                    setFalha(null);
                    setConflito(false);
                    setSucesso(texto);
                    await depois();
                    await lerEtiqueta();
                  }}
                />
              ) : null}
              {correccoes.length === 0 ? null : (
                <>
                  <h4>{t.correccoesTitulo}</h4>
                  <ol className="eventos">
                    {correccoes.map((cr, i) => (
                      <li key={`${cr.em}-${String(i)}`}>
                        {data(cr.em)} —{" "}
                        {cr.campo === "peso"
                          ? t.correccaoPeso
                          : cr.campo === "volumes"
                            ? t.correccaoVolumes
                            : t.correccaoServico}
                        :{" "}
                        {cr.depois === null
                          ? t.correccaoVoltou
                          : cr.campo === "peso"
                            ? preencher(t.etiquetaGramas, {
                                g: Number(cr.depois),
                              })
                            : cr.campo === "volumes" && Array.isArray(cr.depois)
                              ? (cr.depois as unknown[])
                                  .map((g) =>
                                    preencher(t.etiquetaGramas, {
                                      g: Number(g),
                                    }),
                                  )
                                  .join(" + ")
                              : String(
                                  (cr.depois as { servico?: string }).servico,
                                )}
                        {cr.motivo === null ? "" : ` (${cr.motivo})`}
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <h4>{t.etiquetaEventos}</h4>
              {eventos === null || eventos.length === 0 ? (
                <p className="secundario">{t.etiquetaSemEventos}</p>
              ) : (
                <ol className="eventos">
                  {eventos.map((ev, i) => (
                    <li key={`${ev.em}-${String(i)}`}>
                      {data(ev.em)} —{" "}
                      {ev.volume == null
                        ? ""
                        : `${preencher(t.volumesDoEvento, { n: ev.volume })}: `}
                      {ev.estado_transportadora}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )
        ) : (
          <>
            <div className="campo">
              <label htmlFor={`transportadora-${x.id}`}>
                {t.expedirTransportadora}
              </label>
              <input
                id={`transportadora-${x.id}`}
                autoComplete="off"
                maxLength={100}
                value={transportadora}
                disabled={!expede || ocupado !== null || !criada}
                onChange={(ev) => {
                  setTransportadora(ev.target.value);
                }}
              />
            </div>
            <div className="campo">
              <label htmlFor={`seguimento-${x.id}`}>
                {t.expedirSeguimento}
              </label>
              <input
                id={`seguimento-${x.id}`}
                autoComplete="off"
                maxLength={200}
                value={seguimento}
                disabled={!expede || ocupado !== null || !criada}
                onChange={(ev) => {
                  setSeguimento(ev.target.value);
                }}
              />
            </div>
          </>
        )}
        {expede && comConta && criada && etiqueta !== null && !accoes.marcar ? (
          <p className="secundario">{t.expedirPrimeiroAEtiqueta}</p>
        ) : null}
        {expede &&
        comConta &&
        criada &&
        etiqueta !== null &&
        !accoes.cancelar ? (
          <p className="secundario">{t.expedirAnularParaCancelar}</p>
        ) : null}
        {!expede ? null : (
          <div className="accoes">
            {accoes.marcar ? (
              <button
                type="button"
                className="principal"
                disabled={ocupado !== null}
                onClick={() => {
                  mudarEstado(
                    "expedida",
                    "expedirMarcarConfirmar",
                    "expedirMarcadaAgora",
                    comConta ? {} : manualTexto(),
                  );
                }}
              >
                {t.expedirMarcar}
              </button>
            ) : null}
            {accoes.cancelar ? (
              <button
                type="button"
                disabled={ocupado !== null}
                onClick={() => {
                  mudarEstado(
                    "cancelada",
                    "expedirCancelarConfirmar",
                    "expedirCanceladaAgora",
                  );
                }}
              >
                {t.expedirCancelar}
              </button>
            ) : null}
            {/* Com etiqueta, «entregue» é do seguimento (docs/36 §4.2). */}
            {!comConta && x.estado === "expedida" ? (
              <>
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => {
                    mudarEstado("entregue", null, "expedirEntregueAgora");
                  }}
                >
                  {t.expedirEntregue}
                </button>
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => {
                    mudarEstado(
                      "devolvida_ao_remetente",
                      "expedirDevolvidaConfirmar",
                      "expedirDevolvidaAgora",
                    );
                  }}
                >
                  {t.expedirDevolvida}
                </button>
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => {
                    mudarEstado(
                      "perdida",
                      "expedirPerdidaConfirmar",
                      "expedirPerdidaAgora",
                    );
                  }}
                >
                  {t.expedirPerdida}
                </button>
              </>
            ) : null}
          </div>
        )}
      </section>
    </li>
  );
}

// --------------------------- Corrigir o peso e mudar o serviço (§19)

/**
 * Antes de pedir a etiqueta: o peso que a balança diz e outro serviço, cada
 * um com motivo (docs/36 §19). A API decide que serviços servem a caixa; o
 * ecrã só mostra os que ela devolve.
 */
function Correccoes({
  comerciante,
  expedicao,
  mudaServico,
  ocupado,
  concluido,
}: {
  comerciante: string;
  expedicao: string;
  mudaServico: boolean;
  ocupado: boolean;
  /** Depois de gravar: o texto do sucesso, e a expedição relida. */
  concluido: (texto: keyof Textos) => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const [aGravar, setAGravar] = useState(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const [aberto, setAberto] = useState<"peso" | "servico" | "volumes" | null>(
    null,
  );
  const [info, setInfo] = useState<ServicosDaExpedicao | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [peso, setPeso] = useState("");
  const [servico, setServico] = useState("");
  // O peso de cada caixa, como se escreveu (docs/36 §23).
  const [pesos, setPesos] = useState<string[]>([]);
  const [motivo, setMotivo] = useState("");
  const [invalido, setInvalido] = useState<keyof Textos | null>(null);
  const id = `correccao-${expedicao}`;
  // Ao abrir, o foco vai para o título do formulário (o botão que o abriu
  // desaparece; revisão do #429, P3-4).
  useEffect(() => {
    if (aberto !== null) tituloRef.current?.focus();
  }, [aberto]);

  async function abrir(qual: "peso" | "servico" | "volumes") {
    setAberto(qual);
    setInfo(null);
    setFalha(null);
    setInvalido(null);
    setMotivo("");
    try {
      const r = await api.servicosDaExpedicao(comerciante, expedicao);
      setInfo(r);
      setPeso(r.peso_corrigido_g === null ? "" : String(r.peso_corrigido_g));
      setPesos(
        r.volumes_g === null || r.volumes_g === undefined
          ? ["", ""]
          : r.volumes_g.map(String),
      );
      const actual =
        r.opcoes.find((o) => o.escolhido) ?? r.opcoes.find((o) => o.vendido);
      setServico(
        actual === undefined ? "" : `${actual.conta}|${actual.servico}`,
      );
    } catch (e) {
      setFalha(erroDeExpedir(e));
    }
  }

  function fechar() {
    setAberto(null);
    setInfo(null);
  }

  /** Grava; numa recusa o formulário fica aberto, com o que se escreveu. */
  async function gravar(fn: () => Promise<unknown>, texto: keyof Textos) {
    setAGravar(true);
    setFalha(null);
    try {
      await fn();
      fechar();
      await concluido(texto);
    } catch (e) {
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(erroDeExpedir(mostrar));
    } finally {
      setAGravar(false);
    }
  }

  function guardar(evento: SyntheticEvent, voltar = false) {
    evento.preventDefault();
    if (info === null || aberto === null) return;
    if (!motivoServe(motivo)) {
      setInvalido("motivoEmFalta");
      return;
    }
    if (aberto === "volumes") {
      const v = voltar ? null : volumesDoTexto(pesos);
      if (!voltar && v === null) {
        setInvalido("volumesInvalidos");
        return;
      }
      void gravar(
        () =>
          api.mudarVolumes(comerciante, expedicao, {
            versao: info.versao,
            volumes_g: v,
            motivo: motivo.trim(),
          }),
        "volumesMudadosAgora",
      );
      return;
    }
    if (aberto === "peso") {
      const g = voltar ? null : pesoDoTexto(peso);
      if (!voltar && g === null) {
        setInvalido("pesoInvalido");
        return;
      }
      void gravar(
        () =>
          api.corrigirPeso(comerciante, expedicao, {
            versao: info.versao,
            peso_g: g,
            motivo: motivo.trim(),
          }),
        "pesoCorrigidoAgora",
      );
      return;
    }
    // O valor é «cac_…|CÓDIGO»; voltar ao vendido manda os dois a null.
    const barra = servico.indexOf("|");
    if (!voltar && barra <= 0) {
      setInvalido("servicoEmFalta");
      return;
    }
    const conta = voltar ? null : servico.slice(0, barra);
    const codigo = voltar ? null : servico.slice(barra + 1);
    void gravar(
      () =>
        api.mudarServico(comerciante, expedicao, {
          versao: info.versao,
          conta,
          servico: codigo,
          motivo: motivo.trim(),
        }),
      "servicoMudadoAgora",
    );
  }

  if (aberto === null) {
    return (
      <div className="accoes">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void abrir("peso")}
        >
          {t.corrigirPeso}
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void abrir("volumes")}
        >
          {t.volumesBotao}
        </button>
        {mudaServico ? (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void abrir("servico")}
          >
            {t.mudarServico}
          </button>
        ) : null}
      </div>
    );
  }

  const titulo =
    aberto === "peso"
      ? t.corrigirPeso
      : aberto === "volumes"
        ? t.volumesTitulo
        : t.mudarServico;
  const maxVolumes = info === null ? null : maxVolumesDaEtiqueta(info);
  return (
    <form
      className="cartao"
      aria-labelledby={`${id}-titulo`}
      onSubmit={(e) => {
        guardar(e);
      }}
    >
      <h4 id={`${id}-titulo`} ref={tituloRef} tabIndex={-1}>
        {titulo}
      </h4>
      {falha === null ? null : (
        <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
      )}
      {info === null ? (
        falha === null ? (
          <ACarregar />
        ) : null
      ) : aberto === "volumes" ? (
        <>
          <p className="secundario">{t.volumesAjuda}</p>
          {maxVolumes === null ? null : (
            <p className={maxVolumes > 1 ? "secundario" : "aviso"} role="note">
              {maxVolumes > 1
                ? preencher(t.volumesMaximoDoServico, { n: maxVolumes })
                : t.volumesServicoDeUmaCaixa}
            </p>
          )}
          <fieldset
            {...(invalido === "volumesInvalidos"
              ? { "aria-describedby": `${id}-erro` }
              : {})}
          >
            <legend>{t.volumesLegenda}</legend>
            {pesos.map((p, i) => (
              <div className="campo" key={String(i)}>
                <label htmlFor={`${id}-volume-${String(i + 1)}`}>
                  {preencher(t.volumesPesoDoVolume, { n: i + 1 })}
                </label>
                <input
                  id={`${id}-volume-${String(i + 1)}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1_000_000}
                  value={p}
                  {...(invalido === "volumesInvalidos" &&
                  pesoDoTexto(p) === null
                    ? { "aria-invalid": true }
                    : {})}
                  onChange={(ev) => {
                    const novo = [...pesos];
                    novo[i] = ev.target.value;
                    setPesos(novo);
                    setInvalido(null);
                  }}
                />
              </div>
            ))}
            <div className="accoes">
              {pesos.length < 15 ? (
                <button
                  type="button"
                  onClick={() => {
                    setPesos([...pesos, ""]);
                  }}
                >
                  {t.volumesAcrescentar}
                </button>
              ) : null}
              {pesos.length > 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    setPesos(pesos.slice(0, -1));
                  }}
                >
                  {t.volumesTirar}
                </button>
              ) : null}
            </div>
          </fieldset>
        </>
      ) : aberto === "peso" ? (
        <>
          <p className="secundario">
            {info.peso_calculado_g === null
              ? t.corrigirPesoSemCalculado
              : preencher(t.corrigirPesoAjuda, {
                  g: preencher(t.etiquetaGramas, { g: info.peso_calculado_g }),
                })}
          </p>
          <div className="campo">
            <label htmlFor={`${id}-peso`}>{t.pesoEmGramas}</label>
            <input
              id={`${id}-peso`}
              type="number"
              inputMode="numeric"
              min={1}
              max={1_000_000}
              value={peso}
              {...(invalido === "pesoInvalido"
                ? { "aria-invalid": true, "aria-describedby": `${id}-erro` }
                : {})}
              onChange={(ev) => {
                setPeso(ev.target.value);
                setInvalido(null);
              }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="secundario">{t.mudarServicoAjuda}</p>
          {info.escolhido_nao_serve === null ? null : (
            <p className="aviso" role="note">
              {t.escolhidoNaoServe}
            </p>
          )}
          <p className="aviso" role="note">
            {t.servicoPrazoAviso}
          </p>
          {info.opcoes.length === 0 ? (
            <p>{t.semOpcoesDeServico}</p>
          ) : (
            <fieldset
              {...(invalido === "servicoEmFalta"
                ? { "aria-describedby": `${id}-erro` }
                : {})}
            >
              <legend>{t.servicoAEscolher}</legend>
              {info.opcoes.map((o) => {
                const valor = `${o.conta}|${o.servico}`;
                const nome =
                  o.nome[lingua] ?? o.nome["pt"] ?? Object.values(o.nome)[0];
                return (
                  <div key={valor}>
                    <label className="opcao">
                      <input
                        type="radio"
                        name={`${id}-servico`}
                        value={valor}
                        checked={servico === valor}
                        onChange={() => {
                          setServico(valor);
                          setInvalido(null);
                        }}
                      />
                      <span>
                        {o.conta_nome} — {nome ?? o.servico}{" "}
                        <code translate="no">{o.servico}</code>
                        {o.vendido ? ` (${t.servicoVendidoMarca})` : ""}
                      </span>
                    </label>
                  </div>
                );
              })}
            </fieldset>
          )}
        </>
      )}
      {info === null ? null : (
        <div className="campo">
          <label htmlFor={`${id}-motivo`}>{t.motivoCorreccao}</label>
          <textarea
            id={`${id}-motivo`}
            maxLength={500}
            rows={2}
            value={motivo}
            aria-describedby={`${id}-motivo-ajuda${invalido === "motivoEmFalta" ? ` ${id}-erro` : ""}`}
            {...(invalido === "motivoEmFalta" ? { "aria-invalid": true } : {})}
            onChange={(ev) => {
              setMotivo(ev.target.value);
              setInvalido(null);
            }}
          />
          <p id={`${id}-motivo-ajuda`} className="secundario">
            {t.motivoCorreccaoAjuda}
          </p>
        </div>
      )}
      {invalido === null ? null : (
        <p id={`${id}-erro`} className="erro-campo" role="alert">
          {t[invalido]}
        </p>
      )}
      <div className="accoes">
        {info === null ? null : (
          <button type="submit" className="principal" disabled={aGravar}>
            {aGravar ? t.aCarregar : t.guardarCorreccao}
          </button>
        )}
        {info !== null &&
        ((aberto === "peso" && info.peso_corrigido_g !== null) ||
          (aberto === "volumes" &&
            info.volumes_g !== null &&
            info.volumes_g !== undefined) ||
          (aberto === "servico" && info.escolhido !== null)) ? (
          <button
            type="button"
            disabled={aGravar}
            onClick={(e) => {
              guardar(e, true);
            }}
          >
            {aberto === "peso"
              ? t.voltarAoCalculado
              : aberto === "volumes"
                ? t.voltarAUmaCaixa
                : t.voltarAoVendido}
          </button>
        ) : null}
        <button type="button" onClick={fechar}>
          {t.cancelarCorreccao}
        </button>
      </div>
    </form>
  );
}
