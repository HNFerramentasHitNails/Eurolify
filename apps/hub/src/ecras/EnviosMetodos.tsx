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
  type ArmazemHub,
  type ContaTransportadora,
  type Eu,
  type MercadoHub,
  type MetodoEntrega,
  type ServicoConta,
} from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import {
  camposMudados,
  conferirMetodo,
  EMBALAGEM_MAXIMA_G,
  erroDoMetodo,
  metodosAMostrar,
  nomeNaLingua,
  servicosParaOMercado,
  textoDosPrefixos,
  type CampoMetodo,
  type FormularioMetodo,
} from "../envios-metodos";
import {
  ErroDoEcra,
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { montante } from "../faturacao";
import { entradaDe } from "../modulos";
import { casasDaMoeda, textoDosCentimos } from "../preco";
import { preencher, TAG_LINGUA, type Lingua, type Textos } from "../textos";

// Os métodos de entrega e o peso da embalagem no Hub (docs/22 §31; Diogo,
// 13/10/2026: «sim, aprovo; avança com o código»). O dono e o gestor mudam
// (`shipping:write`); o armazém e o apoio vêem. A API decide: se a conta e
// o serviço servem o mercado, o que o checkout oferece, o peso da caixa.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_METODO = /^shm_[0-9a-f-]{36}$/;

export const enderecoDosEnvios = (comerciante: string, caminho = "/envios") =>
  `${caminho}?${new URLSearchParams({ comerciante }).toString()}`;

/** Os três separadores do módulo «Envios» (§31.3). */
export function SeparadoresEnvios({
  comerciante,
  actual,
}: {
  comerciante: string;
  actual: "contas" | "metodos" | "embalagem";
}) {
  const { t } = useHub();
  const separadores: [typeof actual, string, keyof Textos][] = [
    ["contas", "/envios", "enviosSeparadorContas"],
    ["metodos", "/envios/metodos", "enviosSeparadorMetodos"],
    ["embalagem", "/envios/embalagem", "enviosSeparadorEmbalagem"],
  ];
  return (
    <nav aria-label={t.enviosSeparadores}>
      <ul className="separadores">
        {separadores.map(([id, caminho, texto]) => (
          <li key={id}>
            <LigacaoInterna
              href={enderecoDosEnvios(comerciante, caminho)}
              {...(id === actual ? { "aria-current": "page" as const } : {})}
            >
              {t[texto]}
            </LigacaoInterna>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Lê e relê, com as respostas fora de ordem ignoradas e sem sessão → entrar. */
function useLeitura<T>(ler: (() => Promise<T>) | null) {
  const { navegar } = useHub();
  const [dados, setDados] = useState<T | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);
  const carregar = useCallback(async () => {
    if (ler === null) return;
    const este = ++ultimo.current;
    try {
      const lidos = await ler();
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados(lidos);
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [ler, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { dados, falha, carregar };
}

const ambitoDe = (eu: Eu | undefined, comerciante: string, ambito: string) =>
  eu?.comerciantes
    .find((c) => c.comerciante === comerciante)
    ?.ambitos.includes(ambito) === true;

const nomeDoComerciante = (eu: Eu | undefined, comerciante: string) =>
  eu?.comerciantes.find((c) => c.comerciante === comerciante)?.nome;

// ------------------------------------------------------- A lista dos métodos

interface DadosMetodos {
  eu: Eu;
  mercados: MercadoHub[];
  metodos: MetodoEntrega[];
  contas: ContaTransportadora[];
}

export function MetodosEntrega({
  comerciante,
}: {
  comerciante: string | null;
}) {
  const { t, lingua } = useHub();
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const ler = useCallback(async (): Promise<DadosMetodos> => {
    const c = comerciante ?? "";
    const [eu, mercados, metodos, contas] = await Promise.all([
      api.eu(),
      api.mercados(c),
      api.metodosEntrega(c),
      api.contasTransportadora(c),
    ]);
    return {
      eu,
      mercados: mercados.dados,
      metodos: metodos.dados,
      contas: contas.dados,
    };
  }, [comerciante]);
  const { dados, falha, carregar } = useLeitura(valido ? ler : null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const [mercado, setMercado] = useState<string>("");
  const [comArquivados, setComArquivados] = useState(false);
  const c = comerciante ?? "";
  const gere = ambitoDe(dados?.eu, c, "shipping:write");
  const nome = nomeDoComerciante(dados?.eu, c);
  const tag = TAG_LINGUA[lingua];
  const visiveis =
    dados === null
      ? []
      : metodosAMostrar(
          dados.metodos,
          mercado === "" ? null : mercado,
          comArquivados,
        );
  const arquivados =
    dados?.metodos.filter((m) => m.estado === "arquivado").length ?? 0;
  const mercadoDe = (id: string) => dados?.mercados.find((m) => m.id === id);
  const contaDe = (id: string) => dados?.contas.find((x) => x.id === id);

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.metodosTitulo}
        {nome === undefined ? "" : ` — ${nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <SeparadoresEnvios comerciante={c} actual="metodos" />
          {erro !== null && dados === null ? (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          ) : dados === null ? (
            <ACarregar />
          ) : dados.mercados.length === 0 ? (
            <p>{t.metodosSemMercados}</p>
          ) : (
            <>
              <p>{t.metodosExplicacao}</p>
              {gere ? (
                <p>
                  <LigacaoInterna
                    href={enderecoDosEnvios(c, "/envios/metodos/novo")}
                  >
                    {t.metodosCriar}
                  </LigacaoInterna>
                </p>
              ) : null}
              {dados.mercados.length > 1 ? (
                <div className="campo">
                  <label htmlFor="filtro-mercado">{t.metodosMercado}</label>
                  <select
                    id="filtro-mercado"
                    value={mercado}
                    onChange={(e) => {
                      setMercado(e.target.value);
                    }}
                  >
                    <option value="">{t.metodosTodosOsMercados}</option>
                    {dados.mercados.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <p className="secundario" role="status">
                {visiveis.length === 0
                  ? t.metodosVazio
                  : visiveis.length === 1
                    ? t.metodosContagemUm
                    : preencher(t.metodosContagem, { n: visiveis.length })}
              </p>
              {arquivados === 0 ? null : (
                <label className="opcao">
                  <input
                    type="checkbox"
                    checked={comArquivados}
                    onChange={(e) => {
                      setComArquivados(e.target.checked);
                    }}
                  />{" "}
                  {preencher(t.metodosMostrarArquivados, { n: arquivados })}
                </label>
              )}
              {visiveis.length === 0 ? null : (
                <table className="tabela-larga">
                  <thead>
                    <tr>
                      <th scope="col">{t.metodosColunaMetodo}</th>
                      <th scope="col">{t.metodosMercado}</th>
                      <th scope="col">{t.metodosColunaTarifa}</th>
                      <th scope="col">{t.metodosColunaGratis}</th>
                      <th scope="col">{t.metodosColunaPrazo}</th>
                      <th scope="col">{t.metodosColunaTransportadora}</th>
                      <th scope="col">{t.metodosColunaEstado}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((m) => {
                      const mk = mercadoDe(m.mercado);
                      const moeda = mk?.moeda ?? "EUR";
                      const conta = m.conta === null ? null : contaDe(m.conta);
                      return (
                        <tr key={m.id}>
                          <td data-rotulo={t.metodosColunaMetodo}>
                            <LigacaoInterna
                              href={enderecoDosEnvios(
                                c,
                                `/envios/metodos/${m.id}`,
                              )}
                            >
                              {nomeNaLingua(
                                m.nome,
                                lingua,
                                mk?.lingua_principal,
                              )}
                            </LigacaoInterna>
                          </td>
                          <td data-rotulo={t.metodosMercado}>
                            {mk?.nome ?? m.mercado}
                          </td>
                          <td data-rotulo={t.metodosColunaTarifa}>
                            {m.tarifa === 0
                              ? t.metodosGratis
                              : montante(m.tarifa, tag, moeda)}
                          </td>
                          <td data-rotulo={t.metodosColunaGratis}>
                            {m.gratis_a_partir_de === null
                              ? t.metodosNada
                              : montante(m.gratis_a_partir_de, tag, moeda)}
                          </td>
                          <td data-rotulo={t.metodosColunaPrazo}>
                            {preencher(t.metodosAteDias, {
                              n: m.prazo_max_dias,
                            })}
                          </td>
                          <td data-rotulo={t.metodosColunaTransportadora}>
                            {m.conta === null
                              ? t.metodosManual
                              : `${conta?.nome ?? m.conta} · ${m.servico ?? ""}`}
                          </td>
                          <td data-rotulo={t.metodosColunaEstado}>
                            <span
                              className="estado-metodo"
                              data-estado={m.estado}
                            >
                              {m.estado === "activo"
                                ? t.metodosEstadoActivo
                                : t.metodosEstadoArquivado}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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

// -------------------------------------------- Criar e mudar um método

interface DadosFormulario {
  eu: Eu;
  mercados: MercadoHub[];
  contas: ContaTransportadora[];
  metodo: MetodoEntrega | null;
}

const VAZIO: FormularioMetodo = {
  nome: {},
  prazo: {},
  tarifa: "",
  gratis: "",
  pedeTelefone: false,
  conta: "",
  servico: "",
  prazoMaxDias: "30",
  prefixos: "",
  pesoMaxG: "",
};

function formularioDe(
  m: MetodoEntrega,
  moeda: string,
  lingua: Lingua,
): FormularioMetodo {
  const casas = casasDaMoeda(moeda);
  return {
    nome: m.nome,
    prazo: m.prazo,
    tarifa: textoDosCentimos(m.tarifa, casas, lingua),
    gratis:
      m.gratis_a_partir_de === null
        ? ""
        : textoDosCentimos(m.gratis_a_partir_de, casas, lingua),
    pedeTelefone: m.pede_telefone,
    conta: m.conta ?? "",
    servico: m.servico ?? "",
    prazoMaxDias: String(m.prazo_max_dias),
    prefixos: textoDosPrefixos(m.codigos_postais),
    pesoMaxG: m.peso_max_g === null ? "" : String(m.peso_max_g),
  };
}

export function MetodoEntregaFormulario({
  comerciante,
  metodo: idMetodo,
}: {
  comerciante: string | null;
  /** null: um método novo. */
  metodo: string | null;
}) {
  const { t, lingua, navegar } = useHub();
  const novo = idMetodo === null;
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    (novo || FORMATO_METODO.test(idMetodo));
  const c = comerciante ?? "";
  const ler = useCallback(async (): Promise<DadosFormulario> => {
    const [eu, mercados, contas, metodos] = await Promise.all([
      api.eu(),
      api.mercados(c),
      api.contasTransportadora(c),
      novo ? Promise.resolve(null) : api.metodosEntrega(c),
    ]);
    return {
      eu,
      mercados: mercados.dados,
      contas: contas.dados,
      metodo:
        metodos === null
          ? null
          : (metodos.dados.find((m) => m.id === idMetodo) ?? null),
    };
  }, [c, novo, idMetodo]);
  const { dados, falha, carregar } = useLeitura(valido ? ler : null);
  const erroLeitura: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);

  const [mercado, setMercado] = useState("");
  const [f, setF] = useState<FormularioMetodo>(VAZIO);
  const [lidoDe, setLidoDe] = useState<string | null>(null);
  const [servicos, setServicos] = useState<ServicoConta[] | null>(null);
  const [falhaServicos, setFalhaServicos] = useState(false);
  const [invalido, setInvalido] = useState<CampoMetodo | null>(null);
  const [falhaAccao, setFalhaAccao] = useState<unknown>(null);
  const [conflito, setConflito] = useState(false);
  const [sucesso, setSucesso] = useState<keyof Textos | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const caixaDeSucesso = useRef<HTMLDivElement>(null);
  const caixaDeErro = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sucesso !== null) caixaDeSucesso.current?.focus();
  }, [sucesso]);
  useEffect(() => {
    if (falhaAccao !== null) caixaDeErro.current?.focus();
  }, [falhaAccao]);

  const metodo = dados?.metodo ?? null;
  const mercados = dados?.mercados ?? [];
  const mk = mercados.find(
    (m) => m.id === (metodo === null ? mercado : metodo.mercado),
  );

  // O formulário enche-se com o método lido (e de novo depois de guardar).
  useEffect(() => {
    if (metodo === null) return;
    const chave = `${metodo.id} ${String(metodo.versao)}`;
    if (lidoDe === chave) return;
    const m = mercados.find((x) => x.id === metodo.mercado);
    setF(formularioDe(metodo, m?.moeda ?? "EUR", lingua));
    setLidoDe(chave);
  }, [metodo, mercados, lingua, lidoDe]);
  // Num método novo, o primeiro mercado por omissão.
  useEffect(() => {
    if (novo && mercado === "" && mercados[0] !== undefined) {
      setMercado(mercados[0].id);
    }
  }, [novo, mercado, mercados]);
  // Os serviços da conta escolhida.
  useEffect(() => {
    let vivo = true;
    setServicos(null);
    setFalhaServicos(false);
    if (f.conta === "" || c === "") return;
    api
      .servicosDaConta(c, f.conta)
      .then((r) => {
        if (vivo) setServicos(r.dados);
      })
      .catch(() => {
        if (vivo) setFalhaServicos(true);
      });
    return () => {
      vivo = false;
    };
  }, [f.conta, c]);

  const gere = ambitoDe(dados?.eu, c, "shipping:write");
  const arquivado = metodo?.estado === "arquivado";
  const soLeitura = !gere || arquivado;
  const prontas = (dados?.contas ?? []).filter(
    (x) => x.estado === "pronta" || x.id === metodo?.conta,
  );
  const contaDoMetodo =
    metodo?.conta === null || metodo === null
      ? undefined
      : dados?.contas.find((x) => x.id === metodo.conta);
  const contaIndisponivel =
    metodo !== null &&
    metodo.conta !== null &&
    contaDoMetodo?.estado !== "pronta";
  const doMercado =
    servicos === null || mk === undefined
      ? []
      : servicosParaOMercado(servicos, mk.paises);
  const moeda = mk?.moeda ?? "EUR";
  const casas = casasDaMoeda(moeda);
  const comIva = mk?.preco_inclui_iva === true;
  const erroAccao: MensagemDeErro | null =
    falhaAccao === null ? null : mensagemDeErro(falhaAccao, t, lingua);
  const mudar = (parte: Partial<FormularioMetodo>) => {
    setF((x) => ({ ...x, ...parte }));
  };
  const invalidoEm = (campo: CampoMetodo) =>
    invalido === campo
      ? { "aria-invalid": true as const, "aria-describedby": "erro-metodo" }
      : {};

  /** Uma escrita: o erro fica junto, e o método relê-se no fim. */
  const correr = async (
    fn: () => Promise<keyof Textos | null>,
    talvezCriado = false,
  ) => {
    setOcupado(true);
    setSucesso(null);
    setFalhaAccao(null);
    setConflito(false);
    try {
      const texto = await fn();
      setSucesso(texto);
    } catch (e) {
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setConflito(
        mostrar instanceof ErroHub &&
          mostrar.codigo === "checkout.version_conflict",
      );
      // Sem resposta, o método pode ter ficado criado: o Hub não repete
      // sozinho (docs/22 §31.3).
      setFalhaAccao(
        talvezCriado &&
          mostrar instanceof ErroHub &&
          (mostrar.estado === 0 || mostrar.estado >= 500)
          ? new ErroDoEcra("metodosTalvezCriado")
          : erroDoMetodo(mostrar),
      );
    } finally {
      setOcupado(false);
      if (!novo) await carregar();
    }
  };

  function aoGuardar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (ocupado || mk === undefined || soLeitura) return;
    const r = conferirMetodo(f, mk.lingua_principal, casas);
    if (r.campos === null) {
      setInvalido(r.falta.campo);
      setSucesso(null);
      setFalhaAccao(new ErroDoEcra(r.falta.texto));
      return;
    }
    setInvalido(null);
    const campos = r.campos;
    if (metodo === null) {
      void correr(async () => {
        const { id } = await api.criarMetodoEntrega(c, {
          mercado: mk.id,
          ...campos,
        });
        navegar(enderecoDosEnvios(c, `/envios/metodos/${id}`));
        return null;
      }, true);
      return;
    }
    const mudados = camposMudados(metodo, campos);
    if (Object.keys(mudados).length === 0) {
      setFalhaAccao(null);
      setSucesso("metodosNadaMudou");
      return;
    }
    void correr(async () => {
      await api.mudarMetodoEntrega(c, metodo.id, {
        versao: metodo.versao,
        ...mudados,
      });
      return "metodosGuardado";
    });
  }

  function aoMudarEstado(estado: MetodoEntrega["estado"]) {
    if (metodo === null || ocupado) return;
    if (
      estado === "arquivado" &&
      !window.confirm(
        preencher(t.metodosArquivarConfirmar, {
          nome: nomeNaLingua(metodo.nome, lingua, mk?.lingua_principal),
        }),
      )
    ) {
      return;
    }
    void correr(async () => {
      await api.mudarMetodoEntrega(c, metodo.id, {
        versao: metodo.versao,
        estado,
      });
      return estado === "arquivado"
        ? "metodosArquivadoAgora"
        : "metodosReactivadoAgora";
    });
  }

  const linguas = mk === undefined ? [] : mk.linguas;
  const titulo = novo
    ? t.metodosNovoTitulo
    : metodo === null
      ? t.metodosMetodoTitulo
      : nomeNaLingua(metodo.nome, lingua, mk?.lingua_principal);

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna
          href={
            comerciante === null
              ? "/"
              : enderecoDosEnvios(comerciante, "/envios/metodos")
          }
        >
          {t.metodosVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">{titulo}</h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erroLeitura !== null && dados === null ? (
        <CaixaDeErro erro={erroLeitura} aoTentar={() => void carregar()} />
      ) : dados === null ? (
        <ACarregar />
      ) : !novo && metodo === null ? (
        <CaixaDeErro erro={{ texto: t.metodosNaoExiste }} />
      ) : mercados.length === 0 ? (
        <p>{t.metodosSemMercados}</p>
      ) : novo && !gere ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          {metodo === null ? null : (
            <p>
              <span className="estado-metodo" data-estado={metodo.estado}>
                {metodo.estado === "activo"
                  ? t.metodosEstadoActivo
                  : t.metodosEstadoArquivado}
              </span>
            </p>
          )}
          {arquivado ? (
            <p className="aviso" role="note">
              {t.metodosArquivado}
            </p>
          ) : null}
          {contaIndisponivel && !arquivado ? (
            <p className="aviso" role="note">
              {t.metodosContaIndisponivel}
            </p>
          ) : null}
          {!gere && !novo ? (
            <p className="secundario">{t.metodosSoVer}</p>
          ) : null}
          {erroAccao === null ? null : (
            <div ref={caixaDeErro} tabIndex={-1}>
              <CaixaDeErro
                erro={erroAccao}
                id="erro-metodo"
                {...(conflito ? { aoTentar: () => void carregar() } : {})}
              />
            </div>
          )}
          {sucesso === null ? null : (
            <div
              className="sucesso"
              role="status"
              tabIndex={-1}
              ref={caixaDeSucesso}
            >
              {t[sucesso]}
            </div>
          )}
          <form onSubmit={aoGuardar} noValidate>
            <fieldset className="campo" disabled={soLeitura || ocupado}>
              <legend className="so-leitores">{titulo}</legend>
              <div className="campo">
                <label htmlFor="metodo-mercado">{t.metodosMercado}</label>
                <select
                  id="metodo-mercado"
                  value={metodo === null ? mercado : metodo.mercado}
                  disabled={metodo !== null}
                  aria-describedby="metodo-mercado-ajuda"
                  onChange={(e) => {
                    setMercado(e.target.value);
                    mudar({ servico: "" });
                  }}
                >
                  {mercados.map((m) => (
                    <option key={m.id} value={m.id}>
                      {`${m.nome} (${m.paises.join(", ")} · ${m.moeda})`}
                    </option>
                  ))}
                </select>
                <p className="secundario" id="metodo-mercado-ajuda">
                  {metodo === null
                    ? t.metodosMercadoAjuda
                    : t.metodosMercadoFixo}
                </p>
              </div>
              <fieldset className="campo">
                <legend>{t.metodosNome}</legend>
                {linguas.map((l) => (
                  <div className="campo" key={l}>
                    <label htmlFor={`metodo-nome-${l}`}>
                      {preencher(
                        l === mk?.lingua_principal
                          ? t.metodosNaLinguaPrincipal
                          : t.metodosNaLingua,
                        { lingua: l },
                      )}
                    </label>
                    <input
                      id={`metodo-nome-${l}`}
                      lang={l}
                      autoComplete="off"
                      maxLength={200}
                      value={f.nome[l] ?? ""}
                      required={l === mk?.lingua_principal}
                      {...(l === mk?.lingua_principal
                        ? invalidoEm("nome")
                        : {})}
                      onChange={(e) => {
                        mudar({ nome: { ...f.nome, [l]: e.target.value } });
                      }}
                    />
                  </div>
                ))}
              </fieldset>
              <fieldset className="campo">
                <legend>{t.metodosPrazoTexto}</legend>
                <p className="secundario">{t.metodosPrazoTextoAjuda}</p>
                {linguas.map((l) => (
                  <div className="campo" key={l}>
                    <label htmlFor={`metodo-prazo-${l}`}>
                      {preencher(t.metodosNaLingua, { lingua: l })}
                    </label>
                    <input
                      id={`metodo-prazo-${l}`}
                      lang={l}
                      autoComplete="off"
                      maxLength={200}
                      value={f.prazo[l] ?? ""}
                      onChange={(e) => {
                        mudar({ prazo: { ...f.prazo, [l]: e.target.value } });
                      }}
                    />
                  </div>
                ))}
              </fieldset>
              <div className="campo">
                <label htmlFor="metodo-tarifa">
                  {preencher(
                    comIva ? t.metodosTarifaComIva : t.metodosTarifaSemIva,
                    { moeda },
                  )}
                </label>
                <input
                  id="metodo-tarifa"
                  inputMode="decimal"
                  autoComplete="off"
                  value={f.tarifa}
                  required
                  {...invalidoEm("tarifa")}
                  onChange={(e) => {
                    mudar({ tarifa: e.target.value });
                  }}
                />
              </div>
              <div className="campo">
                <label htmlFor="metodo-gratis">
                  {preencher(t.metodosGratisAPartir, { moeda })}
                </label>
                <input
                  id="metodo-gratis"
                  inputMode="decimal"
                  autoComplete="off"
                  value={f.gratis}
                  aria-describedby="metodo-gratis-ajuda"
                  {...invalidoEm("gratis")}
                  onChange={(e) => {
                    mudar({ gratis: e.target.value });
                  }}
                />
                <p className="secundario" id="metodo-gratis-ajuda">
                  {t.metodosGratisAjuda}
                </p>
              </div>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.pedeTelefone}
                  onChange={(e) => {
                    mudar({ pedeTelefone: e.target.checked });
                  }}
                />{" "}
                {t.metodosPedeTelefone}
              </label>
              <div className="campo">
                <label htmlFor="metodo-conta">
                  {t.metodosColunaTransportadora}
                </label>
                <select
                  id="metodo-conta"
                  value={f.conta}
                  aria-describedby="metodo-conta-ajuda"
                  onChange={(e) => {
                    mudar({ conta: e.target.value, servico: "" });
                  }}
                >
                  <option value="">{t.metodosManualLongo}</option>
                  {prontas.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
                <p className="secundario" id="metodo-conta-ajuda">
                  {prontas.length === 0 ? (
                    <>
                      {t.metodosSemContasProntas}{" "}
                      <LigacaoInterna href={enderecoDosEnvios(c)}>
                        {t.enviosSeparadorContas}
                      </LigacaoInterna>
                    </>
                  ) : (
                    t.metodosManualAjuda
                  )}
                </p>
              </div>
              {f.conta === "" ? null : (
                <div className="campo">
                  <label htmlFor="metodo-servico">{t.metodosServico}</label>
                  {falhaServicos ? (
                    <p className="aviso" role="note">
                      {t.enviosServicosFalha}
                    </p>
                  ) : servicos === null ? (
                    <ACarregar />
                  ) : (
                    <>
                      <select
                        id="metodo-servico"
                        value={f.servico}
                        required
                        aria-describedby="metodo-servico-ajuda"
                        {...invalidoEm("servico")}
                        onChange={(e) => {
                          const s = doMercado.find(
                            (x) => x.codigo === e.target.value,
                          );
                          mudar({
                            servico: e.target.value,
                            // O peso máximo vem do serviço; confirma-se.
                            ...(s?.peso_max_g == null
                              ? {}
                              : { pesoMaxG: String(s.peso_max_g) }),
                            ...(s?.pede_telefone === true
                              ? { pedeTelefone: true }
                              : {}),
                          });
                        }}
                      >
                        <option value="">{t.metodosEscolherServico}</option>
                        {doMercado.map((s) => (
                          <option key={s.codigo} value={s.codigo}>
                            {`${nomeNaLingua(s.nome, lingua)} (${s.codigo})`}
                          </option>
                        ))}
                        {f.servico !== "" &&
                        !doMercado.some((s) => s.codigo === f.servico) ? (
                          <option value={f.servico}>{f.servico}</option>
                        ) : null}
                      </select>
                      <p className="secundario" id="metodo-servico-ajuda">
                        {doMercado.length === 0
                          ? t.metodosSemServicosNoMercado
                          : t.metodosServicoAjuda}
                      </p>
                    </>
                  )}
                </div>
              )}
              <div className="campo">
                <label htmlFor="metodo-prazo-max">{t.metodosPrazoMax}</label>
                <input
                  id="metodo-prazo-max"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  value={f.prazoMaxDias}
                  required
                  aria-describedby="metodo-prazo-max-ajuda"
                  {...invalidoEm("prazoMaxDias")}
                  onChange={(e) => {
                    mudar({ prazoMaxDias: e.target.value });
                  }}
                />
                <p className="secundario" id="metodo-prazo-max-ajuda">
                  {t.metodosPrazoMaxAjuda}
                </p>
              </div>
              <div className="campo">
                <label htmlFor="metodo-prefixos">{t.metodosPrefixos}</label>
                <textarea
                  id="metodo-prefixos"
                  rows={2}
                  autoComplete="off"
                  spellCheck={false}
                  value={f.prefixos}
                  aria-describedby="metodo-prefixos-ajuda"
                  {...invalidoEm("prefixos")}
                  onChange={(e) => {
                    mudar({ prefixos: e.target.value });
                  }}
                />
                <p className="secundario" id="metodo-prefixos-ajuda">
                  {t.metodosPrefixosAjuda}
                </p>
              </div>
              <div className="campo">
                <label htmlFor="metodo-peso">{t.metodosPesoMax}</label>
                <input
                  id="metodo-peso"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={f.pesoMaxG}
                  aria-describedby="metodo-peso-ajuda"
                  {...invalidoEm("pesoMaxG")}
                  onChange={(e) => {
                    mudar({ pesoMaxG: e.target.value });
                  }}
                />
                <p className="secundario" id="metodo-peso-ajuda">
                  {t.metodosPesoMaxAjuda}
                </p>
              </div>
              <div className="campo">
                <p>
                  <strong>{t.metodosOnu}</strong>
                </p>
                <p className="secundario">
                  {metodo === null || metodo.aceita_onu.length === 0
                    ? t.metodosOnuNenhum
                    : metodo.aceita_onu.join(", ")}{" "}
                  {t.metodosOnuAjuda}
                </p>
              </div>
              {soLeitura ? null : (
                <button type="submit" className="principal" disabled={ocupado}>
                  {novo ? t.metodosCriarBotao : t.metodosGuardar}
                </button>
              )}
            </fieldset>
          </form>
          {metodo === null || !gere ? null : (
            <p>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => {
                  aoMudarEstado(arquivado ? "activo" : "arquivado");
                }}
              >
                {arquivado ? t.metodosReactivar : t.metodosArquivar}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------- A embalagem

interface DadosEmbalagem {
  eu: Eu;
  armazens: ArmazemHub[];
}

function LinhaEmbalagem({
  comerciante,
  armazem,
  gere,
  depois,
}: {
  comerciante: string;
  armazem: ArmazemHub;
  gere: boolean;
  depois: () => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const [valor, setValor] = useState(String(armazem.embalagem_g));
  const [falha, setFalha] = useState<unknown>(null);
  const [guardado, setGuardado] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const id = `embalagem-${armazem.id}`;
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  // Depois de reler, o valor que ficou no servidor.
  useEffect(() => {
    setValor(String(armazem.embalagem_g));
  }, [armazem.embalagem_g]);

  function aoGuardar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (ocupado) return;
    const limpo = valor.trim();
    const g = /^\d{1,6}$/.test(limpo) ? Number(limpo) : Number.NaN;
    if (!(g >= 0 && g <= EMBALAGEM_MAXIMA_G)) {
      setGuardado(null);
      setFalha(new ErroDoEcra("embalagemErrada"));
      return;
    }
    setFalha(null);
    setGuardado(null);
    setOcupado(true);
    void (async () => {
      try {
        await api.definirEmbalagem(comerciante, armazem.id, g);
        setGuardado(g);
      } catch (e) {
        const mostrar = await falhaDeAccao(e);
        if (mostrar === null) {
          navegar("/entrar", { substituir: true });
          return;
        }
        setFalha(erroDoMetodo(mostrar));
      } finally {
        setOcupado(false);
        await depois();
      }
    })();
  }

  return (
    <li className="cartao">
      <form onSubmit={aoGuardar} noValidate>
        <h2 id={`${id}-titulo`}>{armazem.nome}</h2>
        {armazem.estado === "activo" ? null : (
          <p className="secundario">{t.embalagemArquivado}</p>
        )}
        <div className="campo">
          <label htmlFor={id}>{t.embalagemGramas}</label>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={0}
            max={EMBALAGEM_MAXIMA_G}
            value={valor}
            disabled={!gere || ocupado}
            {...(erro === null
              ? {}
              : { "aria-invalid": true, "aria-describedby": `${id}-erro` })}
            onChange={(e) => {
              setValor(e.target.value);
              setGuardado(null);
            }}
          />
        </div>
        {erro === null ? null : <CaixaDeErro erro={erro} id={`${id}-erro`} />}
        {guardado === null ? null : (
          <p className="sucesso" role="status">
            {preencher(t.embalagemGuardada, { g: guardado })}
          </p>
        )}
        {gere ? (
          <button type="submit" disabled={ocupado}>
            {t.metodosGuardar}
          </button>
        ) : null}
      </form>
    </li>
  );
}

export function Embalagem({ comerciante }: { comerciante: string | null }) {
  const { t, lingua } = useHub();
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const c = comerciante ?? "";
  const ler = useCallback(async (): Promise<DadosEmbalagem> => {
    const [eu, armazens] = await Promise.all([api.eu(), api.armazens(c)]);
    return { eu, armazens: armazens.dados };
  }, [c]);
  const { dados, falha, carregar } = useLeitura(valido ? ler : null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const gere = ambitoDe(dados?.eu, c, "shipping:write");
  const nome = nomeDoComerciante(dados?.eu, c);

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.embalagemTitulo}
        {nome === undefined ? "" : ` — ${nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <SeparadoresEnvios comerciante={c} actual="embalagem" />
          {erro !== null && dados === null ? (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          ) : dados === null ? (
            <ACarregar />
          ) : (
            <>
              <p>{t.embalagemExplicacao}</p>
              {!gere ? <p className="secundario">{t.metodosSoVer}</p> : null}
              {dados.armazens.length === 0 ? (
                <p>{t.embalagemSemArmazens}</p>
              ) : (
                <ul className="lista-embalagem">
                  {dados.armazens.map((a) => (
                    <LinhaEmbalagem
                      key={a.id}
                      comerciante={c}
                      armazem={a}
                      gere={gere}
                      depois={carregar}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
