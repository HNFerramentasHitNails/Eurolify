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
  type ContaTransportadora,
  type Eu,
  type Membros,
  type RemetenteConta,
  type ServicoConta,
} from "../api";
import { autorDe, type Autor } from "../chaves";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import {
  caminhoDosAvisos,
  conferirRemetente,
  contasAMostrar,
  rotuloDoCampo,
  rotuloDoEstado,
  TRANSPORTADORAS,
  type CampoRemetente,
} from "../envios";
import {
  ErroDoEcra,
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { entradaDe } from "../modulos";
import { preencher, TAG_LINGUA, type Textos } from "../textos";
import { Copiar } from "./Copiar";
import { SeparadoresEnvios } from "./EnviosMetodos";

// Os envios no Hub (docs/22 §29; Diogo, 12/10/2026: «sim, aprovo; avança
// com o código»): as contas do comerciante nas transportadoras. Só o dono
// liga e muda (`shipping:accounts`); o gestor, o armazém e o apoio vêem. A
// API decide tudo: os campos das credenciais, se a conta está pronta, os
// serviços. Os segredos escrevem-se aqui e nunca voltam do servidor.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_CONTA = /^cac_[0-9a-f-]{36}$/;

const enderecoDosEnvios = (comerciante: string, caminho = "/envios") =>
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

function textoDoAutor(t: Textos, a: Autor): string {
  return a.autor === "voce"
    ? t.autorVoce
    : a.autor === "operador"
      ? t.autorOperador
      : a.autor === "membro"
        ? a.nome
        : a.autor === "chave"
          ? a.nome === null
            ? t.autorChaveSemNome
            : preencher(t.autorChave, { nome: a.nome })
          : a.autor === "antigo"
            ? t.autorAntigo
            : t.autorDesconhecido;
}

// ----------------------------------------------------------------- A lista

export function Envios({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const data = useData();
  const [dados, setDados] = useState<{
    eu: Eu;
    contas: ContaTransportadora[];
  } | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const [comArquivadas, setComArquivadas] = useState(false);
  const ultimo = useRef(0);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, contas] = await Promise.all([
        api.eu(),
        api.contasTransportadora(comerciante),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, contas: contas.dados });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const meu = dados?.eu.comerciantes.find((c) => c.comerciante === comerciante);
  const gere = meu?.ambitos.includes("shipping:accounts") === true;
  const visiveis =
    dados === null ? [] : contasAMostrar(dados.contas, comArquivadas);
  const arquivadas =
    dados?.contas.filter((c) => c.estado === "arquivada").length ?? 0;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.enviosTitulo}
        {meu === undefined ? "" : ` — ${meu.nome}`}
      </h1>
      {valido ? (
        <SeparadoresEnvios comerciante={comerciante} actual="contas" />
      ) : null}
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && dados === null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : dados === null ? (
        <ACarregar />
      ) : (
        <>
          <p>{t.enviosExplicacao}</p>
          {gere ? (
            <p>
              <LigacaoInterna
                href={enderecoDosEnvios(comerciante, "/envios/nova")}
              >
                {t.enviosLigar}
              </LigacaoInterna>
            </p>
          ) : null}
          <p className="secundario" role="status">
            {visiveis.length === 0
              ? t.enviosVazio
              : visiveis.length === 1
                ? t.enviosContagemUm
                : preencher(t.enviosContagem, { n: visiveis.length })}
          </p>
          {arquivadas === 0 ? null : (
            <label className="opcao">
              <input
                type="checkbox"
                checked={comArquivadas}
                onChange={(e) => {
                  setComArquivadas(e.target.checked);
                }}
              />{" "}
              {preencher(t.enviosMostrarArquivadas, { n: arquivadas })}
            </label>
          )}
          {visiveis.length === 0 ? null : (
            <table className="tabela-larga">
              <thead>
                <tr>
                  <th scope="col">{t.enviosColunaConta}</th>
                  <th scope="col">{t.enviosColunaTransportadora}</th>
                  <th scope="col">{t.enviosColunaEstado}</th>
                  <th scope="col">{t.enviosColunaModo}</th>
                  <th scope="col">{t.enviosColunaTestada}</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((c) => (
                  <tr key={c.id}>
                    <td data-rotulo={t.enviosColunaConta}>
                      <LigacaoInterna
                        href={enderecoDosEnvios(comerciante, `/envios/${c.id}`)}
                      >
                        {c.nome}
                      </LigacaoInterna>
                    </td>
                    <td data-rotulo={t.enviosColunaTransportadora}>
                      {t[`enviosTransportadora_${c.transportadora}`]}
                    </td>
                    <td data-rotulo={t.enviosColunaEstado}>
                      <span className="estado-conta" data-estado={c.estado}>
                        {rotuloDoEstado(t, c.estado)}
                      </span>
                    </td>
                    <td data-rotulo={t.enviosColunaModo}>
                      {t.enviosModo_teste}
                    </td>
                    <td data-rotulo={t.enviosColunaTestada}>
                      {c.testada_em === null
                        ? t.enviosNuncaTestada
                        : data(c.testada_em)}
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

// ------------------------------------------------- O remetente (formulário)

const REMETENTE_VAZIO: RemetenteConta = {
  nome: "",
  linha1: "",
  linha2: "",
  codigo_postal: "",
  localidade: "",
  pais: "PT",
};

const ROTULO_DO_CAMPO: Record<CampoRemetente | "linha2", keyof Textos> = {
  nome: "enviosRemNome",
  linha1: "enviosRemLinha1",
  linha2: "enviosRemLinha2",
  codigo_postal: "enviosRemCodigoPostal",
  localidade: "enviosRemLocalidade",
  pais: "enviosRemPais",
};

function CamposRemetente({
  valor,
  aoMudar,
  invalido,
  idErro,
}: {
  valor: RemetenteConta;
  aoMudar: (r: RemetenteConta) => void;
  invalido: CampoRemetente | null;
  idErro: string;
}) {
  const { t } = useHub();
  const campos: (CampoRemetente | "linha2")[] = [
    "nome",
    "linha1",
    "linha2",
    "codigo_postal",
    "localidade",
    "pais",
  ];
  return (
    <fieldset className="campo">
      <legend>{t.enviosRemetente}</legend>
      {campos.map((c) => (
        <div className="campo" key={c}>
          <label htmlFor={`remetente-${c}`}>{t[ROTULO_DO_CAMPO[c]]}</label>
          <input
            id={`remetente-${c}`}
            name={`remetente-${c}`}
            autoComplete="off"
            maxLength={c === "pais" ? 2 : c === "codigo_postal" ? 20 : 200}
            value={valor[c] ?? ""}
            required={c !== "linha2"}
            {...(invalido === c
              ? { "aria-invalid": true, "aria-describedby": idErro }
              : {})}
            onChange={(e) => {
              aoMudar({ ...valor, [c]: e.target.value });
            }}
          />
        </div>
      ))}
    </fieldset>
  );
}

const FALTA: Record<CampoRemetente, keyof Textos> = {
  nome: "enviosFalta_nome",
  linha1: "enviosFalta_linha1",
  codigo_postal: "enviosFalta_codigo_postal",
  localidade: "enviosFalta_localidade",
  pais: "enviosFalta_pais",
};

// ------------------------------------------------ Ligar uma transportadora

export function EnvioNova({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const [transportadora, setTransportadora] =
    useState<ContaTransportadora["transportadora"]>("sendcloud");
  const [nome, setNome] = useState("");
  const [remetente, setRemetente] = useState<RemetenteConta>(REMETENTE_VAZIO);
  const [invalido, setInvalido] = useState<CampoRemetente | "conta" | null>(
    null,
  );
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const [ocupado, setOcupado] = useState(false);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);

  function aoEnviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (comerciante === null || ocupado) return;
    const nomeLimpo = nome.trim();
    const { remetente: r, falta } = conferirRemetente(remetente);
    if (nomeLimpo === "") {
      setInvalido("conta");
      setFalha(new ErroDoEcra("enviosFalta_conta"));
      return;
    }
    if (falta !== null) {
      setInvalido(falta);
      setFalha(new ErroDoEcra(FALTA[falta]));
      return;
    }
    setInvalido(null);
    setFalha(null);
    setOcupado(true);
    void (async () => {
      try {
        const { id } = await api.criarContaTransportadora(comerciante, {
          transportadora,
          nome: nomeLimpo,
          remetente: r,
        });
        navegar(enderecoDosEnvios(comerciante, `/envios/${id}`));
      } catch (e) {
        const mostrar = await falhaDeAccao(e);
        if (mostrar === null) {
          navegar("/entrar", { substituir: true });
          return;
        }
        // Sem resposta, a conta pode ter ficado criada: o Hub não repete
        // sozinho (docs/22 §29.2).
        setFalha(
          mostrar instanceof ErroHub &&
            (mostrar.estado === 0 || mostrar.estado >= 500)
            ? new ErroDoEcra("enviosTalvezCriada")
            : mostrar,
        );
      } finally {
        setOcupado(false);
      }
    })();
  }

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna
          href={comerciante === null ? "/" : enderecoDosEnvios(comerciante)}
        >
          {t.enviosVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">{t.enviosNovaTitulo}</h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <p>{t.enviosNovaExplicacao}</p>
          {erro === null ? null : <CaixaDeErro erro={erro} id="erro-nova" />}
          <form onSubmit={aoEnviar} noValidate>
            <fieldset className="campo">
              <legend>{t.enviosColunaTransportadora}</legend>
              {TRANSPORTADORAS.map((x) => (
                <label key={x} className="opcao">
                  <input
                    type="radio"
                    name="transportadora"
                    value={x}
                    checked={transportadora === x}
                    onChange={() => {
                      setTransportadora(x);
                    }}
                  />{" "}
                  {t[`enviosTransportadora_${x}`]}
                </label>
              ))}
              {transportadora === "ctt" ? (
                <p className="secundario">{t.enviosCttAinda}</p>
              ) : null}
            </fieldset>
            <div className="campo">
              <label htmlFor="nome-conta">{t.enviosNome}</label>
              <input
                id="nome-conta"
                name="nome-conta"
                autoComplete="off"
                maxLength={100}
                value={nome}
                required
                {...(invalido === "conta"
                  ? { "aria-invalid": true, "aria-describedby": "erro-nova" }
                  : {})}
                onChange={(e) => {
                  setNome(e.target.value);
                }}
              />
            </div>
            <CamposRemetente
              valor={remetente}
              aoMudar={setRemetente}
              invalido={invalido === "conta" ? null : invalido}
              idErro="erro-nova"
            />
            <button type="submit" className="principal" disabled={ocupado}>
              {t.enviosCriar}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ A conta

interface DadosConta {
  eu: Eu;
  membros: Membros["membros"];
  conta: ContaTransportadora | null;
  /** null: não se conseguiram ler (a página abre na mesma). */
  servicos: ServicoConta[] | null;
}

export function EnvioConta({
  comerciante,
  conta: idConta,
}: {
  comerciante: string | null;
  conta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const data = useData();
  const [dados, setDados] = useState<DadosConta | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const [falhaAccao, setFalhaAccao] = useState<unknown>(null);
  const erroAccao: MensagemDeErro | null =
    falhaAccao === null ? null : mensagemDeErro(falhaAccao, t, lingua);
  const [sucesso, setSucesso] = useState<keyof Textos | null>(null);
  const [ocupado, setOcupado] = useState<"testar" | "outro" | null>(null);
  const caixaDeSucesso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sucesso !== null) caixaDeSucesso.current?.focus();
  }, [sucesso]);
  const ultimo = useRef(0);
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_CONTA.test(idConta);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, membros, contas] = await Promise.all([
        api.eu(),
        api.membros(comerciante),
        api.contasTransportadora(comerciante),
      ]);
      const conta = contas.dados.find((c) => c.id === idConta) ?? null;
      // Os serviços pedem o adaptador da transportadora: sem ele (os CTT,
      // ou um servidor sem ENVIOS_CHAVE) a conta abre na mesma, para se
      // ver e arquivar (revisão do #409, P1-2).
      let servicos: ServicoConta[] | null = [];
      if (conta !== null && conta.campos_credenciais.length > 0) {
        try {
          servicos = (await api.servicosDaConta(comerciante, idConta)).dados;
        } catch (e) {
          if (semSessao(e)) throw e;
          servicos = null;
        }
      }
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, membros: membros.membros, conta, servicos });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, idConta, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** Uma acção: o erro fica junto, e a conta relê-se sempre no fim. */
  const correr = async (
    tipo: "testar" | "outro",
    fn: () => Promise<keyof Textos | null>,
  ) => {
    if (ocupado !== null) return;
    setOcupado(tipo);
    setFalhaAccao(null);
    setSucesso(null);
    try {
      const ok = await fn();
      await carregar();
      if (ok !== null) setSucesso(ok);
    } catch (e) {
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaAccao(mostrar);
      await carregar();
    } finally {
      setOcupado(null);
    }
  };

  const meu = dados?.eu.comerciantes.find((c) => c.comerciante === comerciante);
  const conta = dados?.conta ?? null;
  const gere =
    meu?.ambitos.includes("shipping:accounts") === true &&
    conta !== null &&
    conta.estado !== "arquivada";

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna
          href={comerciante === null ? "/" : enderecoDosEnvios(comerciante)}
        >
          {t.enviosVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">{conta === null ? t.enviosContaTitulo : conta.nome}</h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && dados === null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : dados === null ? (
        <ACarregar />
      ) : conta === null ? (
        <CaixaDeErro erro={{ texto: t.enviosNaoExiste }} />
      ) : (
        <>
          <p>
            <span className="estado-conta" data-estado={conta.estado}>
              {rotuloDoEstado(t, conta.estado)}
            </span>{" "}
            {t[`enviosTransportadora_${conta.transportadora}`]} ·{" "}
            {preencher(t.enviosModo, { modo: t.enviosModo_teste })}
          </p>
          {conta.estado === "arquivada" ? (
            <p className="aviso" role="note">
              {t.enviosArquivada}
            </p>
          ) : null}
          {erro === null ? null : (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          )}
          {erroAccao === null ? null : (
            <CaixaDeErro
              erro={erroAccao}
              {...(falhaAccao instanceof ErroHub &&
              falhaAccao.codigo === "shipping.version_conflict"
                ? { aoTentar: () => void carregar() }
                : {})}
            />
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
          <DadosDaConta
            comerciante={comerciante}
            conta={conta}
            gere={gere}
            ocupado={ocupado !== null}
            correr={correr}
          />
          <Credenciais
            comerciante={comerciante}
            conta={conta}
            gere={gere}
            ocupado={ocupado !== null}
            correr={correr}
            autor={
              conta.credenciais_por === null
                ? null
                : textoDoAutor(
                    t,
                    autorDe(
                      conta.credenciais_por,
                      dados.eu.pessoa,
                      dados.membros,
                      [],
                    ),
                  )
            }
            data={data}
          />
          {gere && conta.campos_credenciais.length > 0 ? (
            <section className="cartao" aria-labelledby="titulo-testar">
              <h2 id="titulo-testar">{t.enviosTestar}</h2>
              <p>{t.enviosTestarExplicacao}</p>
              <button
                type="button"
                className="principal"
                disabled={ocupado !== null || conta.credenciais_em === null}
                aria-describedby={
                  conta.credenciais_em === null ? "testar-sem" : undefined
                }
                onClick={() => {
                  void correr("testar", async () => {
                    await api.testarContaTransportadora(comerciante, conta.id);
                    return "enviosTestePronta";
                  });
                }}
              >
                {ocupado === "testar" ? t.enviosATestar : t.enviosTestar}
              </button>
              {conta.credenciais_em === null ? (
                <p className="secundario" id="testar-sem">
                  {t.enviosTestarSemCredenciais}
                </p>
              ) : null}
            </section>
          ) : null}
          <Servicos conta={conta} servicos={dados.servicos} data={data} />
          {gere ? (
            <p>
              <button
                type="button"
                disabled={ocupado !== null}
                onClick={() => {
                  if (
                    !window.confirm(
                      preencher(t.enviosArquivarConfirmar, {
                        nome: conta.nome,
                      }),
                    )
                  ) {
                    return;
                  }
                  void correr("outro", async () => {
                    await api.mudarContaTransportadora(comerciante, conta.id, {
                      versao: conta.versao,
                      arquivar: true,
                    });
                    return "enviosArquivadaAgora";
                  });
                }}
              >
                {t.enviosArquivar}
              </button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

type Correr = (
  tipo: "testar" | "outro",
  fn: () => Promise<keyof Textos | null>,
) => Promise<void>;

function DadosDaConta({
  comerciante,
  conta,
  gere,
  ocupado,
  correr,
}: {
  comerciante: string;
  conta: ContaTransportadora;
  gere: boolean;
  ocupado: boolean;
  correr: Correr;
}) {
  const { t, lingua } = useHub();
  const [editar, setEditar] = useState(false);
  const [nome, setNome] = useState(conta.nome);
  const [remetente, setRemetente] = useState<RemetenteConta>(conta.remetente);
  const [invalido, setInvalido] = useState<CampoRemetente | "conta" | null>(
    null,
  );
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const r = conta.remetente;

  function aoGuardar(evento: SyntheticEvent) {
    evento.preventDefault();
    const nomeLimpo = nome.trim();
    const { remetente: limpo, falta } = conferirRemetente(remetente);
    if (nomeLimpo === "") {
      setInvalido("conta");
      setFalha(new ErroDoEcra("enviosFalta_conta"));
      return;
    }
    if (falta !== null) {
      setInvalido(falta);
      setFalha(new ErroDoEcra(FALTA[falta]));
      return;
    }
    setInvalido(null);
    setFalha(null);
    void correr("outro", async () => {
      await api.mudarContaTransportadora(comerciante, conta.id, {
        versao: conta.versao,
        nome: nomeLimpo,
        remetente: limpo,
      });
      setEditar(false);
      return "enviosGuardado";
    });
  }

  return (
    <section className="cartao" aria-labelledby="titulo-dados">
      <h2 id="titulo-dados">{t.enviosDados}</h2>
      {!editar ? (
        <>
          <dl>
            <dt>{t.enviosNome}</dt>
            <dd>{conta.nome}</dd>
            <dt>{t.enviosRemetente}</dt>
            <dd>
              {r.nome}
              <br />
              {r.linha1}
              {r.linha2 === undefined || r.linha2 === "" ? null : (
                <>
                  <br />
                  {r.linha2}
                </>
              )}
              <br />
              {r.codigo_postal} {r.localidade} · {r.pais}
            </dd>
          </dl>
          {gere ? (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                setNome(conta.nome);
                setRemetente(conta.remetente);
                setEditar(true);
              }}
            >
              {t.enviosEditar}
            </button>
          ) : null}
        </>
      ) : (
        <form onSubmit={aoGuardar} noValidate>
          {erro === null ? null : <CaixaDeErro erro={erro} id="erro-dados" />}
          <div className="campo">
            <label htmlFor="nome-conta">{t.enviosNome}</label>
            <input
              id="nome-conta"
              autoComplete="off"
              maxLength={100}
              value={nome}
              required
              {...(invalido === "conta"
                ? { "aria-invalid": true, "aria-describedby": "erro-dados" }
                : {})}
              onChange={(e) => {
                setNome(e.target.value);
              }}
            />
          </div>
          <CamposRemetente
            valor={remetente}
            aoMudar={setRemetente}
            invalido={invalido === "conta" ? null : invalido}
            idErro="erro-dados"
          />
          <div className="linha">
            <button type="submit" className="principal" disabled={ocupado}>
              {t.enviosGuardar}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditar(false);
                setFalha(null);
              }}
            >
              {t.enviosCancelar}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Credenciais({
  comerciante,
  conta,
  gere,
  ocupado,
  correr,
  autor,
  data,
}: {
  comerciante: string;
  conta: ContaTransportadora;
  gere: boolean;
  ocupado: boolean;
  correr: Correr;
  autor: string | null;
  data: (iso: string) => string;
}) {
  const { t, lingua } = useHub();
  // Os segredos só vivem nestes campos, e saem depois de enviados: nunca
  // ficam guardados no navegador nem voltam do servidor (docs/22 §29.2).
  const [valores, setValores] = useState<Record<string, string>>({});
  const [segredo, setSegredo] = useState("");
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const campos = conta.campos_credenciais;

  function aoGuardar(evento: SyntheticEvent) {
    evento.preventDefault();
    const credenciais = Object.fromEntries(
      campos.map((c) => [c.campo, (valores[c.campo] ?? "").trim()]),
    );
    if (Object.values(credenciais).some((v) => v === "")) {
      setFalha(new ErroDoEcra("enviosCredenciaisFaltam"));
      return;
    }
    const s = segredo.trim();
    if (s !== "" && s.length < 16) {
      setFalha(new ErroDoEcra("enviosSegredoCurto"));
      return;
    }
    setFalha(null);
    void correr("outro", async () => {
      try {
        await api.guardarCredenciais(comerciante, conta.id, {
          credenciais,
          ...(s === "" ? {} : { segredo_aviso: s }),
        });
      } finally {
        // Também se falhar: um segredo não fica à espera num campo.
        setValores({});
        setSegredo("");
      }
      return "enviosCredenciaisGuardadasAgora";
    });
  }

  return (
    <section className="cartao" aria-labelledby="titulo-credenciais">
      <h2 id="titulo-credenciais">{t.enviosCredenciais}</h2>
      <p>
        {conta.credenciais_em === null
          ? t.enviosCredenciaisNenhumas
          : preencher(t.enviosCredenciaisGuardadas, {
              data: data(conta.credenciais_em),
              quem: autor ?? t.autorDesconhecido,
            })}
      </p>
      {campos.length === 0 ? (
        <p className="secundario">{t.enviosCredenciaisSemAdaptador}</p>
      ) : gere ? (
        <form onSubmit={aoGuardar} noValidate autoComplete="off">
          <p className="secundario">{t.enviosCredenciaisExplicacao}</p>
          {erro === null ? null : (
            <CaixaDeErro erro={erro} id="erro-credenciais" />
          )}
          {campos.map((c) => (
            <div className="campo" key={c.campo}>
              <label htmlFor={`credencial-${c.campo}`}>
                {rotuloDoCampo(t, c.campo)}
              </label>
              <input
                id={`credencial-${c.campo}`}
                type={c.segredo ? "password" : "text"}
                autoComplete={c.segredo ? "new-password" : "off"}
                spellCheck={false}
                maxLength={500}
                value={valores[c.campo] ?? ""}
                onChange={(e) => {
                  setValores((v) => ({ ...v, [c.campo]: e.target.value }));
                }}
              />
            </div>
          ))}
          <div className="campo">
            <label htmlFor="credencial-segredo-aviso">
              {t.enviosSegredoAviso}
            </label>
            <input
              id="credencial-segredo-aviso"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={200}
              value={segredo}
              aria-describedby="ajuda-segredo-aviso"
              onChange={(e) => {
                setSegredo(e.target.value);
              }}
            />
            <p className="secundario" id="ajuda-segredo-aviso">
              {t.enviosSegredoAvisoAjuda}
            </p>
          </div>
          <button type="submit" className="principal" disabled={ocupado}>
            {t.enviosGuardarCredenciais}
          </button>
        </form>
      ) : null}
      {campos.length === 0 ? null : (
        <>
          <h3>{t.enviosAvisos}</h3>
          <p>{t.enviosAvisosExplicacao}</p>
          <p className="linha">
            <code className="caminho-avisos" translate="no">
              {caminhoDosAvisos(conta)}
            </code>{" "}
            <Copiar texto={caminhoDosAvisos(conta)} />
          </p>
          <p className="secundario">{t.enviosAvisosVps}</p>
        </>
      )}
    </section>
  );
}

function Servicos({
  conta,
  servicos,
  data,
}: {
  conta: ContaTransportadora;
  servicos: ServicoConta[] | null;
  data: (iso: string) => string;
}) {
  const { t, lingua } = useHub();
  const peso = (g: number) =>
    new Intl.NumberFormat(TAG_LINGUA[lingua], {
      style: "unit",
      unit: "kilogram",
      maximumFractionDigits: 3,
    }).format(g / 1000);
  return (
    <section className="cartao" aria-labelledby="titulo-servicos">
      <h2 id="titulo-servicos">{t.enviosServicos}</h2>
      {conta.servicos_em === null ? null : (
        <p className="secundario">
          {preencher(t.enviosServicosFotografia, {
            data: data(conta.servicos_em),
          })}
        </p>
      )}
      {servicos === null ? (
        <p className="aviso" role="note">
          {t.enviosServicosFalha}
        </p>
      ) : servicos.length === 0 ? (
        <p>{t.enviosServicosVazio}</p>
      ) : (
        <table className="tabela-larga">
          <thead>
            <tr>
              <th scope="col">{t.enviosColunaServico}</th>
              <th scope="col">{t.enviosColunaPaises}</th>
              <th scope="col">{t.enviosColunaPesoMax}</th>
              <th scope="col">{t.enviosColunaPede}</th>
            </tr>
          </thead>
          <tbody>
            {servicos.map((s) => {
              const pede = [
                ...(s.pede_telefone ? [t.enviosPedeTelefone] : []),
                ...(s.pede_email ? [t.enviosPedeEmail] : []),
              ];
              return (
                <tr key={s.codigo}>
                  <td data-rotulo={t.enviosColunaServico}>
                    {s.nome[lingua] ?? s.nome["pt"] ?? s.codigo}
                    <br />
                    <code className="secundario" translate="no">
                      {s.codigo}
                    </code>
                  </td>
                  <td data-rotulo={t.enviosColunaPaises}>
                    {s.paises.join(", ")}
                  </td>
                  <td data-rotulo={t.enviosColunaPesoMax}>
                    {s.peso_max_g === null
                      ? t.enviosSemLimite
                      : peso(s.peso_max_g)}
                  </td>
                  <td data-rotulo={t.enviosColunaPede}>
                    {pede.length === 0 ? t.enviosPedeNada : pede.join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
