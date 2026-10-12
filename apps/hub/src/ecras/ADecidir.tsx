import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ErroHub, type Eu, type Membros, type Papel } from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { entradaDe } from "../modulos";
import {
  consultaDe,
  curto,
  DECIDE_A_FILA,
  doEndereco,
  enderecoDe,
  FILAS_TAREFAS,
  FILTROS_TAREFAS,
  horasDesde,
  instanteDe,
  limiteDoPrazo,
  motivoDe,
  relogioDe,
  type CasoTarefa,
  type FilaTarefa,
  type FiltroTarefas,
  type PaginaTarefas,
  type PassoTarefa,
  type Tarefa,
} from "../tarefas";
import { preencher, TAG_LINGUA } from "../textos";
import { Copiar } from "./Copiar";

// O ecrã «A decidir» (docs/22 §28; decisão Q1 A): os casos que esperam por
// uma pessoa, das filas que o papel lê, com quem decide e até quando. A
// tarefa não decide o caso (docs/33 R1): enquanto as filas não têm ecrã, a
// linha mostra o identificador e diz que se decide pela integração. Quem
// vê, quem atribui e quem pode ser responsável decide-o a API e a base; o
// ecrã só não oferece o que elas recusam.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;

type Modo = "atribuir" | "prazo" | "historico";

interface Aberto {
  caso: string;
  modo: Modo;
}

export function ADecidir({
  comerciante,
  consulta,
}: {
  comerciante: string | null;
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const [iniciais] = useState(() => doEndereco(consulta));
  const [filtro, setFiltro] = useState<FiltroTarefas>(iniciais.filtro);
  const [fila, setFila] = useState<FilaTarefa | null>(iniciais.fila);
  const [eu, setEu] = useState<Eu | null>(null);
  const [membros, setMembros] = useState<Membros["membros"]>([]);
  const [pagina, setPagina] = useState<PaginaTarefas | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [falhaMais, setFalhaMais] = useState<unknown>(null);
  const [aCarregarMais, setACarregarMais] = useState(false);
  const [aberto, setAberto] = useState<Aberto | null>(null);
  // O aviso da última acção, junto da linha dela.
  const [aviso, setAviso] = useState<{ caso: string; texto: string } | null>(
    null,
  );
  const ultimo = useRef(0);

  const carregar = useCallback(
    async (f: FiltroTarefas, q: FilaTarefa | null) => {
      if (!valido) return;
      const este = ++ultimo.current;
      setFalha(null);
      setFalhaMais(null);
      setACarregarMais(false);
      setPagina(null);
      setAberto(null);
      setAviso(null);
      try {
        const [quem, equipa, p] = await Promise.all([
          api.eu(),
          api.membros(comerciante),
          api.tarefas(comerciante, consultaDe(f, q, null)),
        ]);
        if (este !== ultimo.current) return;
        setEu(quem);
        setMembros(equipa.membros);
        setPagina(p);
      } catch (e) {
        if (este !== ultimo.current) return;
        if (semSessao(e)) {
          navegar("/entrar", { substituir: true });
          return;
        }
        setFalha(e);
      }
    },
    [valido, comerciante, navegar],
  );

  useEffect(() => {
    void carregar(iniciais.filtro, iniciais.fila);
  }, [carregar, iniciais]);

  function escolher(f: FiltroTarefas, q: FilaTarefa | null) {
    setFiltro(f);
    setFila(q);
    if (valido) {
      window.history.replaceState(null, "", enderecoDe(comerciante, f, q));
    }
    void carregar(f, q);
  }

  async function verMais() {
    if (!valido || pagina?.cursor_seguinte == null || aCarregarMais) return;
    const este = ultimo.current;
    setACarregarMais(true);
    setFalhaMais(null);
    try {
      const p = await api.tarefas(
        comerciante,
        consultaDe(filtro, fila, pagina.cursor_seguinte),
      );
      if (este !== ultimo.current) return;
      setPagina({ ...p, dados: [...pagina.dados, ...p.dados] });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaMais(e);
    } finally {
      if (este === ultimo.current) setACarregarMais(false);
    }
  }

  /** Relê o caso e troca a linha (ou tira-a, se já não está por decidir). */
  async function reler(caso: Tarefa): Promise<Tarefa | null> {
    if (!valido) return null;
    try {
      const r = await api.tarefa(comerciante, caso.fila, caso.caso);
      setPagina((p) =>
        p === null
          ? p
          : {
              ...p,
              dados: p.dados.map((x) => (x.caso === caso.caso ? r.tarefa : x)),
            },
      );
      return r.tarefa;
    } catch (e) {
      if (e instanceof ErroHub && e.codigo === "tasks.not_found") {
        setPagina((p) =>
          p === null
            ? p
            : { ...p, dados: p.dados.filter((x) => x.caso !== caso.caso) },
        );
      }
      return null;
    }
  }

  /**
   * Grava e relê a linha. Uma resposta perdida relê o caso e dá-o por feito
   * se já tem o que se pediu (docs/22 §28.2).
   */
  async function gravar(
    caso: Tarefa,
    pedido: () => Promise<unknown>,
    feito: (lida: Tarefa) => boolean,
  ): Promise<boolean> {
    try {
      await pedido();
      await reler(caso);
      setAviso({ caso: caso.caso, texto: t.decidirGuardado });
      setAberto(null);
      return true;
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return false;
      }
      const lida = await reler(caso);
      if (e instanceof ErroHub && e.estado === 0) {
        if (lida !== null && lida.versao !== caso.versao && feito(lida)) {
          setAviso({ caso: caso.caso, texto: t.decidirGuardado });
          setAberto(null);
          return true;
        }
        setAviso({ caso: caso.caso, texto: t.decidirNaoEncontreiMudanca });
        return false;
      }
      setAviso({
        caso: caso.caso,
        texto: mensagemDeErro(e, t, lingua).texto,
      });
      return false;
    }
  }

  if (!valido) {
    return (
      <section aria-labelledby="titulo">
        <h1 id="titulo">{t.decidirTitulo}</h1>
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      </section>
    );
  }

  const meu = eu?.comerciantes.find((c) => c.comerciante === comerciante);
  const ambitos = meu?.ambitos ?? [];
  const euId = eu === null ? null : `per_${eu.pessoa.replace(/^per_/, "")}`;
  const fuso = pagina?.fuso ?? "UTC";
  const nomes = new Map(membros.map((m) => [m.pessoa, m]));
  const nomeDe = (pessoa: string | null) =>
    pessoa === null
      ? t.decidirSemResponsavel
      : pessoa === euId
        ? t.decidirEu
        : (nomes.get(pessoa)?.nome ?? t.decidirPessoaDesconhecida);
  const quemFez = (quem: string) =>
    quem.startsWith("pessoa:per_")
      ? nomeDe(quem.slice("pessoa:".length))
      : quem.startsWith("sistema:")
        ? t.decidirSistema
        : quem;
  const dataHora = (iso: string | null) =>
    iso === null
      ? "—"
      : new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: fuso,
        }).format(new Date(iso));
  const dia = (d: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${d}T00:00:00Z`));
  const haQuanto = (desde: string) => {
    const h = horasDesde(desde, Date.now());
    if (h < 1) return t.decidirHaMenosDeUmaHora;
    if (h < 24) {
      return h === 1
        ? t.decidirHaUmaHora
        : preencher(t.decidirHaHoras, { n: h });
    }
    const d = Math.floor(h / 24);
    return d === 1 ? t.decidirHaUmDia : preencher(t.decidirHaDias, { n: d });
  };

  const decide = (f: FilaTarefa) => ambitos.includes(DECIDE_A_FILA[f]);
  const atribui = ambitos.includes("tasks:assign");
  const total =
    pagina === null
      ? 0
      : Object.entries(pagina.totais)
          .filter(([f]) => fila === null || f === fila)
          .reduce((n, [, v]) => n + v, 0);

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.decidirTitulo}
        {meu === undefined ? "" : ` — ${meu.nome}`}
      </h1>
      <p className="secundario">{t.decidirExplicacao}</p>
      <p className="aviso">{t.decidirSemEcra}</p>
      <div role="group" aria-label={t.decidirFiltros}>
        <div className="grupo-filtros">
          {FILTROS_TAREFAS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => {
                escolher(f, fila);
              }}
            >
              {t[`decidirFiltro_${f}`]}
            </button>
          ))}
        </div>
        <div className="campo">
          <label htmlFor="filtro-fila">{t.decidirFila}</label>
          <select
            id="filtro-fila"
            value={fila ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              escolher(filtro, FILAS_TAREFAS.find((x) => x === v) ?? null);
            }}
          >
            <option value="">{t.decidirTodasAsFilas}</option>
            {(pagina?.filas ?? FILAS_TAREFAS).map((f) => (
              <option key={f} value={f}>
                {t[`fila_${f}`]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {falha instanceof ErroHub &&
      falha.estado === 403 &&
      falha.codigo === "tasks.forbidden" &&
      fila === null ? (
        <CaixaDeErro erro={{ texto: t.decidirSemFilas }} />
      ) : falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar(filtro, fila)}
        />
      ) : pagina === null ? (
        <ACarregar />
      ) : (
        <>
          {pagina.filas.length < FILAS_TAREFAS.length ? (
            <p className="secundario">
              {preencher(t.decidirVeFilas, { n: pagina.filas.length })}
            </p>
          ) : null}
          <p className="secundario" role="status">
            {total === 1
              ? t.decidirContagemUm
              : preencher(t.decidirContagem, { n: total })}
          </p>
          {pagina.dados.length === 0 ? (
            filtro === "todos" && fila === null ? (
              <p>{t.decidirVazioTotal}</p>
            ) : (
              <>
                <p>{t.decidirVazioFiltro}</p>
                <button
                  type="button"
                  onClick={() => {
                    escolher("todos", null);
                  }}
                >
                  {t.decidirVerTodos}
                </button>
              </>
            )
          ) : (
            <>
              <table className="tabela-larga">
                <thead>
                  <tr>
                    <th scope="col">{t.colunaFila}</th>
                    <th scope="col">{t.colunaCaso}</th>
                    <th scope="col">{t.colunaMotivo}</th>
                    <th scope="col">{t.colunaNaFila}</th>
                    <th scope="col">{t.colunaResponsavel}</th>
                    <th scope="col">{t.colunaPrazo}</th>
                    <th scope="col">{t.colunaAccoes}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.dados.map((x) => (
                    <Linha
                      key={x.caso}
                      tarefa={x}
                      comerciante={comerciante}
                      fuso={fuso}
                      aberto={aberto?.caso === x.caso ? aberto.modo : null}
                      abrir={(modo) => {
                        setAviso(null);
                        setAberto(
                          modo === null ? null : { caso: x.caso, modo },
                        );
                      }}
                      aviso={aviso?.caso === x.caso ? aviso.texto : null}
                      // Tirar o caso a outra pessoa pede tasks:assign (R3;
                      // revisão do #396, P2-1).
                      podeFicar={
                        decide(x.fila) &&
                        x.responsavel !== euId &&
                        (x.responsavel === null || atribui)
                      }
                      podeAtribuir={decide(x.fila) && atribui}
                      ficar={() =>
                        gravar(
                          x,
                          () =>
                            api.atribuirTarefa(
                              comerciante,
                              x.fila,
                              x.caso,
                              euId,
                              x.versao,
                            ),
                          (lida) => lida.responsavel === euId,
                        )
                      }
                      gravar={(pedido, feito) => gravar(x, pedido, feito)}
                      nomeDe={nomeDe}
                      papelDe={(p) => nomes.get(p)?.papel ?? null}
                      quemFez={quemFez}
                      dataHora={dataHora}
                      dia={dia}
                      haQuanto={haQuanto}
                    />
                  ))}
                </tbody>
              </table>
              {falhaMais === null ? null : (
                <CaixaDeErro
                  erro={mensagemDeErro(falhaMais, t, lingua)}
                  aoTentar={() => void verMais()}
                />
              )}
              {pagina.cursor_seguinte === null || falhaMais !== null ? null : (
                <p>
                  <button
                    type="button"
                    disabled={aCarregarMais}
                    onClick={() => void verMais()}
                  >
                    {aCarregarMais ? t.aCarregar : t.decidirMais}
                  </button>
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function Linha({
  tarefa: x,
  comerciante,
  fuso,
  aberto,
  abrir,
  aviso,
  podeFicar,
  podeAtribuir,
  ficar,
  gravar,
  nomeDe,
  papelDe,
  quemFez,
  dataHora,
  dia,
  haQuanto,
}: {
  tarefa: Tarefa;
  comerciante: string;
  fuso: string;
  aberto: Modo | null;
  abrir: (modo: Modo | null) => void;
  aviso: string | null;
  podeFicar: boolean;
  podeAtribuir: boolean;
  ficar: () => Promise<boolean>;
  gravar: (
    pedido: () => Promise<unknown>,
    feito: (lida: Tarefa) => boolean,
  ) => Promise<boolean>;
  nomeDe: (pessoa: string | null) => string;
  papelDe: (pessoa: string) => Papel | null;
  quemFez: (quem: string) => string;
  dataHora: (iso: string | null) => string;
  dia: (d: string) => string;
  haQuanto: (desde: string) => string;
}) {
  const { t } = useHub();
  const [aGuardar, setAGuardar] = useState(false);
  const painel = `painel-${x.caso}`;
  // O foco não se perde quando o painel fecha ou o botão desaparece
  // (revisão do #396, P2-2): vai para o aviso da linha, se houver, ou para o
  // botão que abriu o painel.
  const botoes = useRef<Partial<Record<Modo, HTMLButtonElement | null>>>({});
  const avisoRef = useRef<HTMLParagraphElement>(null);
  const antes = useRef<Modo | null>(aberto);
  useLayoutEffect(() => {
    const anterior = antes.current;
    antes.current = aberto;
    if (aviso !== null) {
      avisoRef.current?.focus();
    } else if (anterior !== null && aberto === null) {
      botoes.current[anterior]?.focus();
    }
  }, [aberto, aviso]);
  const correr = async (fn: () => Promise<boolean>) => {
    setAGuardar(true);
    try {
      await fn();
    } finally {
      setAGuardar(false);
    }
  };
  const alternar = (modo: Modo) => {
    abrir(aberto === modo ? null : modo);
  };
  return (
    <>
      <tr>
        <td data-rotulo={t.colunaFila}>{t[`fila_${x.fila}`]}</td>
        <td data-rotulo={t.colunaCaso}>
          <span translate="no" title={x.caso}>
            {curto(x.caso)}
          </span>{" "}
          <Copiar
            texto={x.caso}
            rotulo={preencher(t.decidirCopiarCaso, { caso: curto(x.caso) })}
          />
          {x.encomenda === null ? null : (
            <>
              <br />
              <span className="secundario" translate="no" title={x.encomenda}>
                {preencher(t.decidirEncomenda, { id: curto(x.encomenda) })}
              </span>
            </>
          )}
        </td>
        <td data-rotulo={t.colunaMotivo}>{motivoDe(t, x.motivo)}</td>
        <td data-rotulo={t.colunaNaFila}>{haQuanto(x.entrou_em)}</td>
        <td data-rotulo={t.colunaResponsavel}>{nomeDe(x.responsavel)}</td>
        <td data-rotulo={t.colunaPrazo}>
          {dataHora(x.prazo)}
          {x.vencida ? (
            <>
              {" "}
              <span className="tarefa-vencida">{t.decidirVencida}</span>
            </>
          ) : null}
          {x.prazo_legal === null ? null : (
            <>
              <br />
              <span className="secundario">
                {preencher(t.decidirPrazoLegal, { data: dia(x.prazo_legal) })}
              </span>
            </>
          )}
        </td>
        <td data-rotulo={t.colunaAccoes}>
          <div className="accoes-tarefa">
            {podeFicar ? (
              <button
                type="button"
                disabled={aGuardar}
                onClick={() => void correr(ficar)}
              >
                {t.decidirFicar}
              </button>
            ) : null}
            {podeAtribuir ? (
              <>
                <button
                  type="button"
                  aria-expanded={aberto === "atribuir"}
                  {...(aberto === null ? {} : { "aria-controls": painel })}
                  ref={(b) => {
                    botoes.current.atribuir = b;
                  }}
                  onClick={() => {
                    alternar("atribuir");
                  }}
                >
                  {t.decidirAtribuir}
                </button>
                <button
                  type="button"
                  aria-expanded={aberto === "prazo"}
                  {...(aberto === null ? {} : { "aria-controls": painel })}
                  ref={(b) => {
                    botoes.current.prazo = b;
                  }}
                  onClick={() => {
                    alternar("prazo");
                  }}
                >
                  {t.decidirMudarPrazo}
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-expanded={aberto === "historico"}
              {...(aberto === null ? {} : { "aria-controls": painel })}
              ref={(b) => {
                botoes.current.historico = b;
              }}
              onClick={() => {
                alternar("historico");
              }}
            >
              {t.decidirHistorico}
            </button>
          </div>
          {aviso === null ? null : (
            <p
              className="secundario"
              role="status"
              tabIndex={-1}
              ref={avisoRef}
            >
              {aviso}
            </p>
          )}
        </td>
      </tr>
      {aberto === null ? null : (
        <tr>
          <td colSpan={7}>
            <div className="painel-tarefa" id={painel}>
              <Painel
                modo={aberto}
                tarefa={x}
                comerciante={comerciante}
                fuso={fuso}
                fechar={() => {
                  abrir(null);
                }}
                gravar={gravar}
                nomeDe={nomeDe}
                papelDe={papelDe}
                quemFez={quemFez}
                dataHora={dataHora}
                dia={dia}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Painel({
  modo,
  tarefa: x,
  comerciante,
  fuso,
  fechar,
  gravar,
  nomeDe,
  papelDe,
  quemFez,
  dataHora,
  dia,
}: {
  modo: Modo;
  tarefa: Tarefa;
  comerciante: string;
  fuso: string;
  fechar: () => void;
  gravar: (
    pedido: () => Promise<unknown>,
    feito: (lida: Tarefa) => boolean,
  ) => Promise<boolean>;
  nomeDe: (pessoa: string | null) => string;
  papelDe: (pessoa: string) => Papel | null;
  quemFez: (quem: string) => string;
  dataHora: (iso: string | null) => string;
  dia: (d: string) => string;
}) {
  const { t, lingua } = useHub();
  const [caso, setCaso] = useState<CasoTarefa | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [escolhido, setEscolhido] = useState<string>(x.responsavel ?? "");
  const [prazo, setPrazo] = useState(() => relogioDe(x.prazo, fuso));
  const [motivo, setMotivo] = useState("");
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  // Relê o caso depois de uma recusa (ex.: a pessoa mudou de papel: a lista
  // de quem pode ser responsável muda; revisão do #396, P3-4).
  const [releitura, setReleitura] = useState(0);
  const titulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titulo.current?.focus();
  }, [modo]);

  useEffect(() => {
    if (modo === "prazo") return;
    let vivo = true;
    setCaso(null);
    setFalha(null);
    api.tarefa(comerciante, x.fila, x.caso).then(
      (r) => {
        if (vivo) setCaso(r);
      },
      (e: unknown) => {
        if (vivo) setFalha(e);
      },
    );
    return () => {
      vivo = false;
    };
  }, [modo, comerciante, x.fila, x.caso, x.versao, releitura]);

  const fecharBotao = (
    <button type="button" onClick={fechar}>
      {t.decidirFechar}
    </button>
  );

  if (modo === "historico") {
    return (
      <>
        <h2 tabIndex={-1} ref={titulo}>
          {t.decidirHistorico}
        </h2>
        {falha !== null ? (
          <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
        ) : caso === null ? (
          <ACarregar />
        ) : caso.historico.length === 0 ? (
          <p>{t.decidirHistoricoVazio}</p>
        ) : (
          <ol>
            {caso.historico.map((h, i) => (
              <li key={`${h.em} ${String(i)}`}>
                <span className="secundario">{dataHora(h.em)}</span> —{" "}
                {textoDoPasso(h)}
                {h.motivo === null ? null : (
                  <>
                    <br />
                    <span className="secundario">
                      {preencher(t.decidirPassoMotivo, { motivo: h.motivo })}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        {fecharBotao}
      </>
    );
  }

  function textoDoPasso(h: PassoTarefa) {
    const quem = quemFez(h.quem);
    if (h.acto === "atribuida") {
      return preencher(t.decidirActo_atribuida, {
        quem,
        para: nomeDe(h.responsavel_depois),
      });
    }
    if (h.acto === "retirada") {
      return preencher(t.decidirActo_retirada, {
        quem,
        de: nomeDe(h.responsavel_antes),
      });
    }
    if (h.acto === "prazo_mudado") {
      return preencher(t.decidirActo_prazo_mudado, {
        quem,
        de: dataHora(h.prazo_antes),
        para: dataHora(h.prazo_depois),
      });
    }
    return preencher(t.decidirActo_vencida, {
      de: dataHora(h.prazo_depois),
    });
  }

  if (modo === "atribuir") {
    const pessoas = caso?.pode_ser_responsavel ?? [];
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (caso === null) return;
          const novo = escolhido === "" ? null : escolhido;
          setAGuardar(true);
          void gravar(
            () =>
              api.atribuirTarefa(
                comerciante,
                x.fila,
                x.caso,
                novo,
                caso.tarefa.versao,
              ),
            (lida) => lida.responsavel === novo,
          )
            .then((feito) => {
              if (!feito) setReleitura((n) => n + 1);
            })
            .finally(() => {
              setAGuardar(false);
            });
        }}
      >
        <h2 tabIndex={-1} ref={titulo}>
          {preencher(t.decidirAtribuirTitulo, { caso: curto(x.caso) })}
        </h2>
        {falha !== null ? (
          <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
        ) : caso === null ? (
          <ACarregar />
        ) : (
          <fieldset>
            <legend className="so-leitores">{t.colunaResponsavel}</legend>
            {pessoas.length === 0 ? <p>{t.decidirNinguemPode}</p> : null}
            {pessoas.map((p) => {
              const papel = papelDe(p);
              return (
                <div key={p}>
                  <label>
                    <input
                      type="radio"
                      name={`responsavel-${x.caso}`}
                      value={p}
                      checked={escolhido === p}
                      onChange={() => {
                        setEscolhido(p);
                      }}
                    />{" "}
                    {nomeDe(p)}
                    {papel === null ? "" : ` (${t[`papel_${papel}`]})`}
                  </label>
                </div>
              );
            })}
            <div>
              <label>
                <input
                  type="radio"
                  name={`responsavel-${x.caso}`}
                  value=""
                  checked={escolhido === ""}
                  onChange={() => {
                    setEscolhido("");
                  }}
                />{" "}
                {t.decidirNinguem}
              </label>
            </div>
          </fieldset>
        )}
        <div className="accoes-tarefa">
          <button type="submit" disabled={caso === null || aGuardar}>
            {aGuardar ? t.aCarregar : t.decidirGuardar}
          </button>
          {fecharBotao}
        </div>
      </form>
    );
  }

  const limite = limiteDoPrazo(x.prazo_legal);
  const ajuda = `ajuda-${x.caso}`;
  const erroId = `erro-${x.caso}`;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const instante = instanteDe(prazo, fuso);
        if (instante === null) {
          setErroCampo(t.decidirPrazoEmFalta);
          return;
        }
        if (motivo.trim() === "") {
          setErroCampo(t.decidirMotivoObrigatorio);
          return;
        }
        setErroCampo(null);
        setAGuardar(true);
        void gravar(
          () =>
            api.mudarPrazoTarefa(
              comerciante,
              x.fila,
              x.caso,
              instante,
              motivo.trim(),
              x.versao,
            ),
          (lida) => lida.prazo === instante,
        ).finally(() => {
          setAGuardar(false);
        });
      }}
    >
      <h2 tabIndex={-1} ref={titulo}>
        {preencher(t.decidirPrazoTitulo, { caso: curto(x.caso) })}
      </h2>
      <div className="campo">
        <label htmlFor={`prazo-${x.caso}`}>{t.decidirNovoPrazo}</label>
        <input
          id={`prazo-${x.caso}`}
          type="datetime-local"
          value={prazo}
          {...(limite === null ? {} : { max: limite })}
          aria-describedby={`${ajuda}-hora ${erroCampo === null ? "" : erroId}`}
          onChange={(e) => {
            setPrazo(e.target.value);
          }}
        />
        <p className="secundario" id={`${ajuda}-hora`}>
          {preencher(t.decidirHoraDe, { fuso })}
          {x.prazo_legal === null
            ? ""
            : ` ${preencher(t.decidirAteAoPrazoLegal, { data: dia(x.prazo_legal) })}`}
        </p>
      </div>
      <div className="campo">
        <label htmlFor={`motivo-${x.caso}`}>{t.decidirMotivo}</label>
        <textarea
          id={`motivo-${x.caso}`}
          maxLength={500}
          rows={2}
          value={motivo}
          aria-describedby={`${ajuda} ${erroCampo === null ? "" : erroId}`}
          onChange={(e) => {
            setMotivo(e.target.value);
          }}
        />
        <p className="secundario" id={ajuda}>
          {t.decidirMotivoAjuda}
        </p>
      </div>
      {erroCampo === null ? null : (
        <CaixaDeErro erro={{ texto: erroCampo }} id={erroId} />
      )}
      <div className="accoes-tarefa">
        <button type="submit" disabled={aGuardar}>
          {aGuardar ? t.aCarregar : t.decidirGuardar}
        </button>
        {fecharBotao}
      </div>
    </form>
  );
}
