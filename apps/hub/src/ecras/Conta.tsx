import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { api, ErroHub, type Passkey, type Sessao } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import {
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { acrescentarPasskey, comRecente, temPasskeys } from "../passkeys";
import {
  codigoTotpLimpo,
  palavraPasseValida,
  segredoEmGrupos,
} from "../palavra-passe";
import { fecharAvisoDeRecuperada, foiRecuperada } from "../recuperacao";
import { preencher, TAG_LINGUA, type Textos } from "../textos";
import { Copiar } from "./Copiar";
import { Qr } from "./Qr";

// A minha conta (docs/22 §9.1): as passkeys, as sessões abertas e os códigos
// de recuperação, cada bloco com o seu carregamento e o seu erro (um bloco
// que falha não esconde os outros). A API decide; o ecrã só não oferece o
// que vai ser recusado (terminar as outras sessões quando só há esta; nada
// que peça a passkey num navegador sem passkeys).

/**
 * Lê uma lista; só a resposta do último pedido conta; sem sessão, sai.
 * `carregar` diz se leu (o êxito de uma acção só se mostra com a lista em
 * dia; revisão do #174, P2-1).
 */
function useLista<T>(ler: () => Promise<T>) {
  const { navegar } = useHub();
  const [dados, setDados] = useState<T | null>(null);
  // O erro guarda-se cru e traduz-se ao mostrar (revisão do #158, P3-7).
  const [falha, setFalha] = useState<unknown>(null);
  const ultimo = useRef(0);
  const carregar = useCallback(async (): Promise<boolean> => {
    const este = ++ultimo.current;
    try {
      const r = await ler();
      if (este !== ultimo.current) return false;
      setFalha(null);
      setDados(r);
      return true;
    } catch (e) {
      if (este !== ultimo.current) return false;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return false;
      }
      setFalha(e);
      return false;
    }
  }, [ler, navegar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { dados, falha, carregar };
}

/**
 * O resultado de uma acção: o erro (cru) ou o texto de êxito (a chave, para
 * mudar com a língua; revisão do #174, P3-2).
 */
function useAccao() {
  const { t, lingua, navegar } = useHub();
  const [falha, setFalha] = useState<unknown>(null);
  const [sucesso, setSucesso] = useState<keyof Textos | null>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const falhou = useCallback(
    async (e: unknown) => {
      // Um 401 só manda para «Entrar» se a sessão acabou (P1-1).
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(mostrar);
    },
    [navegar],
  );
  const limpar = useCallback(() => {
    setFalha(null);
    setSucesso(null);
  }, []);
  return {
    erro,
    sucesso: sucesso === null ? null : t[sucesso],
    falhou,
    limpar,
    setSucesso,
  };
}

function useDataHora() {
  const { lingua } = useHub();
  return (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
}

/**
 * Uma acção de cada vez em toda a conta: retirar, terminar sessões e
 * reautenticar trocam o cookie, e um segundo pedido com o cookie antigo seria
 * recusado (revisão do #174, P2-3).
 */
interface Vez {
  ocupado: boolean;
  correr: (fn: () => Promise<void>) => Promise<void>;
}

function ResultadoDaAccao({
  accao,
}: {
  accao: { erro: MensagemDeErro | null; sucesso: string | null };
}) {
  return (
    <>
      {accao.erro === null ? null : <CaixaDeErro erro={accao.erro} />}
      {accao.sucesso === null ? null : (
        <div className="sucesso" role="status">
          {accao.sucesso}
        </div>
      )}
    </>
  );
}

export function Conta({ recuperada }: { recuperada: boolean }) {
  const { t, lingua, navegar } = useHub();
  const [avisoRecuperada, setAvisoRecuperada] = useState(
    () => recuperada || foiRecuperada(),
  );
  // Retirar uma passkey termina as outras sessões: a lista das sessões
  // volta a ler-se.
  const [versaoSessoes, setVersaoSessoes] = useState(0);
  const lerEu = useCallback(() => api.eu(), []);
  const eu = useLista(lerEu);
  const dono = eu.dados?.comerciantes.some((c) => c.papel === "dono") ?? false;
  const erroEu: MensagemDeErro | null =
    eu.falha === null ? null : mensagemDeErro(eu.falha, t, lingua);

  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const correr = useCallback(async (fn: () => Promise<void>) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupado(true);
    try {
      await fn();
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  }, []);
  const vez: Vez = { ocupado, correr };

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navegar("/");
          }}
        >
          {t.equipaVoltar}
        </a>
      </p>
      <h1 id="titulo">{t.contaTitulo}</h1>
      {eu.dados === null ? null : (
        <p className="secundario">
          {t.inicioEntrouComo} {eu.dados.nome} ({eu.dados.email})
        </p>
      )}
      {erroEu === null ? null : (
        <CaixaDeErro erro={erroEu} aoTentar={() => void eu.carregar()} />
      )}
      {/* O aviso não espera pelo /hub/me (P2-2); só a linha das chaves, que
          depende de ser dono. */}
      {avisoRecuperada ? (
        <div className="aviso" role="note" aria-labelledby="titulo-recuperada">
          <p>
            <strong id="titulo-recuperada">{t.recuperadoTitulo}</strong>
          </p>
          <p>{t.recuperadoTexto}</p>
          <ul>
            <li>{t.recuperadoRetirar}</li>
            <li>{t.recuperadoCodigos}</li>
            {dono ? <li>{t.recuperadoChaves}</li> : null}
          </ul>
          <button
            type="button"
            onClick={() => {
              fecharAvisoDeRecuperada();
              setAvisoRecuperada(false);
              if (recuperada) navegar("/conta", { substituir: true });
            }}
          >
            {t.recuperadoFechar}
          </button>
        </div>
      ) : null}
      <Passkeys
        vez={vez}
        aoRetirar={() => {
          setVersaoSessoes((v) => v + 1);
        }}
      />
      {/* Só com a palavra-passe ligada na API (o campo existe; §9.2). */}
      {eu.dados !== null && eu.dados.palavra_passe !== undefined ? (
        <PalavraPasse
          vez={vez}
          estado={eu.dados.palavra_passe}
          aoMudar={async () => {
            // Activar e retirar fazem cair as outras sessões.
            setVersaoSessoes((v) => v + 1);
            return eu.carregar();
          }}
        />
      ) : null}
      <Sessoes key={versaoSessoes} vez={vez} />
      <Codigos vez={vez} />
    </section>
  );
}

function Passkeys({ vez, aoRetirar }: { vez: Vez; aoRetirar: () => void }) {
  const { t, lingua } = useHub();
  const dataHora = useDataHora();
  const lerPasskeys = useCallback(() => api.passkeys(), []);
  const lista = useLista(lerPasskeys);
  const accao = useAccao();
  const [nome, setNome] = useState("");
  // O nome fora dos limites confere-se no ecrã, antes de pedir a passkey.
  const [nomeInvalido, setNomeInvalido] = useState(false);
  const erroLista: MensagemDeErro | null =
    lista.falha === null ? null : mensagemDeErro(lista.falha, t, lingua);
  // Sem passkeys no navegador não se oferece o que pede a passkey (P3-5).
  const podeAgir = temPasskeys() && !vez.ocupado;

  function aoAcrescentar(evento: SyntheticEvent) {
    evento.preventDefault();
    const limpo = nome.trim();
    accao.limpar();
    setNomeInvalido(limpo.length < 1 || limpo.length > 100);
    if (limpo.length < 1 || limpo.length > 100) return;
    void vez.correr(async () => {
      try {
        await comRecente(() => acrescentarPasskey(limpo));
        setNome("");
        if (await lista.carregar()) accao.setSucesso("passkeyAcrescentada");
      } catch (e) {
        await accao.falhou(e);
      }
    });
  }

  function retirar(p: Passkey) {
    if (!window.confirm(preencher(t.passkeyRetirarConfirmar, { nome: p.nome })))
      return;
    accao.limpar();
    setNomeInvalido(false);
    void vez.correr(async () => {
      try {
        await comRecente(() => api.retirarPasskey(p.passkey));
        aoRetirar();
        if (await lista.carregar()) accao.setSucesso("passkeyRetirada");
      } catch (e) {
        await accao.falhou(e);
        // Já retirada noutro separador: a lista volta a ler-se.
        if (e instanceof ErroHub && e.codigo === "passkey.not_found") {
          await lista.carregar();
        }
      }
    });
  }

  const passkeys = lista.dados?.passkeys ?? null;
  return (
    <section className="cartao" aria-labelledby="titulo-passkeys">
      <h2 id="titulo-passkeys">{t.passkeysTitulo}</h2>
      {erroLista !== null ? (
        <CaixaDeErro erro={erroLista} aoTentar={() => void lista.carregar()} />
      ) : null}
      {passkeys === null ? (
        erroLista === null ? (
          <ACarregar />
        ) : null
      ) : (
        <>
          {nomeInvalido ? (
            <CaixaDeErro erro={{ texto: t.erroNomePasskey }} />
          ) : null}
          <ResultadoDaAccao accao={accao} />
          <p className="secundario">
            {passkeys.length === 1
              ? t.passkeysContagemUm
              : preencher(t.passkeysContagem, { n: passkeys.length })}
          </p>
          {passkeys.length === 1 ? (
            <div className="aviso" role="note">
              {t.passkeysConselho}
            </div>
          ) : null}
          <table>
            <thead>
              <tr>
                <th scope="col">{t.colunaNome}</th>
                <th scope="col">{t.colunaCriadaEm}</th>
                <th scope="col">{t.colunaUltimoUso}</th>
                <th scope="col">
                  <span className="so-leitores">{t.colunaAccoes}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((p) => (
                <tr key={p.passkey}>
                  <td data-rotulo={t.colunaNome}>{p.nome}</td>
                  <td data-rotulo={t.colunaCriadaEm}>
                    {dataHora(p.criada_em)}
                  </td>
                  <td data-rotulo={t.colunaUltimoUso}>
                    {p.ultimo_uso_em === null
                      ? t.nunca
                      : dataHora(p.ultimo_uso_em)}
                  </td>
                  <td>
                    {temPasskeys() ? (
                      <button
                        type="button"
                        onClick={() => {
                          retirar(p);
                        }}
                        disabled={!podeAgir}
                        aria-label={`${t.passkeyRetirar}: ${p.nome}`}
                      >
                        {t.passkeyRetirar}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {temPasskeys() ? (
            <form onSubmit={aoAcrescentar} noValidate>
              <div className="linha">
                <div className="campo">
                  <label htmlFor="nome-passkey">{t.passkeyNome}</label>
                  <input
                    id="nome-passkey"
                    name="nome-passkey"
                    autoComplete="off"
                    maxLength={100}
                    value={nome}
                    aria-invalid={nomeInvalido}
                    onChange={(e) => {
                      setNome(e.target.value);
                    }}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="principal" disabled={!podeAgir}>
                {vez.ocupado ? t.entrarAEspera : t.passkeyAcrescentar}
              </button>
            </form>
          ) : (
            <div className="aviso" role="note">
              {t.semPasskeys}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Sessoes({ vez }: { vez: Vez }) {
  const { t, lingua } = useHub();
  const dataHora = useDataHora();
  const lerSessoes = useCallback(() => api.sessoes(), []);
  const lista = useLista(lerSessoes);
  const accao = useAccao();
  const erroLista: MensagemDeErro | null =
    lista.falha === null ? null : mensagemDeErro(lista.falha, t, lingua);

  function terminarOutras() {
    if (!window.confirm(t.sessoesTerminarConfirmar)) return;
    accao.limpar();
    void vez.correr(async () => {
      try {
        await comRecente(() => api.terminarOutrasSessoes());
        if (await lista.carregar()) accao.setSucesso("sessoesTerminadas");
      } catch (e) {
        await accao.falhou(e);
      }
    });
  }

  const sessoes = lista.dados?.sessoes ?? null;
  return (
    <section className="cartao" aria-labelledby="titulo-sessoes">
      <h2 id="titulo-sessoes">{t.sessoesTitulo}</h2>
      {erroLista !== null ? (
        <CaixaDeErro erro={erroLista} aoTentar={() => void lista.carregar()} />
      ) : null}
      {sessoes === null ? (
        erroLista === null ? (
          <ACarregar />
        ) : null
      ) : (
        <>
          <ResultadoDaAccao accao={accao} />
          <p className="secundario">
            {sessoes.length === 1
              ? t.sessoesContagemUm
              : preencher(t.sessoesContagem, { n: sessoes.length })}
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.colunaCriadaEm}</th>
                <th scope="col">{t.colunaUltimoUso}</th>
                <th scope="col">
                  <span className="so-leitores">{t.sessaoEsta}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessoes.map((s: Sessao) => (
                <tr key={s.sessao}>
                  <td data-rotulo={t.colunaCriadaEm}>
                    {dataHora(s.criada_em)}
                  </td>
                  <td data-rotulo={t.colunaUltimoUso}>
                    {dataHora(s.ultimo_uso_em)}
                  </td>
                  <td>{s.esta ? <strong>{t.sessaoEsta}</strong> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessoes.some((s) => !s.esta) && temPasskeys() ? (
            <button
              type="button"
              onClick={terminarOutras}
              disabled={vez.ocupado}
            >
              {t.sessoesTerminar}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function Codigos({ vez }: { vez: Vez }) {
  const { t } = useHub();
  const accao = useAccao();
  // Os códigos só vivem aqui enquanto se mostram; «Já os guardei» apaga-os.
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const gerarRef = useRef<HTMLButtonElement>(null);
  // O foco acompanha o que aparece e desaparece (P3-3).
  const [focar, setFocar] = useState<"aviso" | "gerar" | null>(null);
  useEffect(() => {
    if (focar === "aviso") avisoRef.current?.focus();
    if (focar === "gerar") gerarRef.current?.focus();
  }, [focar, codigos]);

  function gerar() {
    if (!window.confirm(t.codigosGerarConfirmar)) return;
    accao.limpar();
    void vez.correr(async () => {
      try {
        const r = await comRecente(() => api.gerarCodigos());
        setCodigos(r.codigos);
        setFocar("aviso");
      } catch (e) {
        await accao.falhou(e);
      }
    });
  }

  return (
    <section className="cartao" aria-labelledby="titulo-codigos">
      <h2 id="titulo-codigos">{t.recuperacaoTitulo}</h2>
      <ResultadoDaAccao accao={accao} />
      {codigos !== null ? (
        <>
          <div className="aviso" role="alert" tabIndex={-1} ref={avisoRef}>
            {t.codigosAviso}
          </div>
          <ul className="codigos" aria-label={t.recuperacaoTitulo}>
            {codigos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="linha">
            <Copiar texto={codigos.join("\n")} />
            <button
              type="button"
              className="principal"
              onClick={() => {
                setCodigos(null);
                setFocar("gerar");
              }}
            >
              {t.codigosGuardados}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t.recuperacaoExplicacao}</p>
          {temPasskeys() ? (
            <button
              type="button"
              ref={gerarRef}
              onClick={gerar}
              disabled={vez.ocupado}
            >
              {t.codigosGerar}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

type PassoPalavraPasse =
  | { passo: "ver" }
  | { passo: "escolher" }
  | { passo: "confirmar"; segredo: string; uri: string };

/**
 * A palavra-passe com o TOTP (docs/22 §9.2): activar (palavra-passe, o código
 * QR e o segredo, o primeiro código) e retirar. O segredo e o URI só vivem
 * neste componente enquanto se configura; nunca vão para o endereço nem para
 * o armazenamento do navegador (§9.4).
 */
function PalavraPasse({
  vez,
  estado,
  aoMudar,
}: {
  vez: Vez;
  estado: "activa" | "pendente" | null;
  aoMudar: () => Promise<boolean>;
}) {
  const { t } = useHub();
  const accao = useAccao();
  const [passo, setPasso] = useState<PassoPalavraPasse>({ passo: "ver" });
  const [palavra, setPalavra] = useState("");
  const [repetida, setRepetida] = useState("");
  const [codigo, setCodigo] = useState("");
  const [invalido, setInvalido] = useState<keyof Textos | null>(null);
  const podeAgir = temPasskeys() && !vez.ocupado;
  // Activar oferece-se também sem passkeys no navegador: quem acabou de
  // entrar com a palavra-passe tem a sessão recente e não precisa delas.
  const podeAgirSemPasskey = !vez.ocupado;

  function recomecar() {
    setPasso({ passo: "ver" });
    setPalavra("");
    setRepetida("");
    setCodigo("");
    setInvalido(null);
  }

  function aoEscolher(evento: SyntheticEvent) {
    evento.preventDefault();
    accao.limpar();
    const problema: keyof Textos | null = !palavraPasseValida(palavra)
      ? "erroPalavraPasseCurta"
      : palavra !== repetida
        ? "erroPalavraPasseDiferente"
        : null;
    setInvalido(problema);
    if (problema !== null) return;
    void vez.correr(async () => {
      try {
        const r = await comRecente(() => api.prepararPalavraPasse(palavra));
        // A palavra-passe já não é precisa no ecrã.
        setPalavra("");
        setRepetida("");
        setPasso({ passo: "confirmar", segredo: r.segredo, uri: r.uri });
      } catch (e) {
        await accao.falhou(e);
      }
    });
  }

  function aoConfirmar(evento: SyntheticEvent) {
    evento.preventDefault();
    accao.limpar();
    const limpo = codigoTotpLimpo(codigo);
    setInvalido(limpo === null ? "erroCodigoTotp" : null);
    if (limpo === null) return;
    void vez.correr(async () => {
      try {
        await comRecente(() => api.confirmarPalavraPasse(limpo));
        recomecar();
        if (await aoMudar()) accao.setSucesso("palavraPasseActivada");
      } catch (e) {
        // O mesmo código não vale duas vezes: pede-se o seguinte.
        setCodigo("");
        await accao.falhou(e);
      }
    });
  }

  function retirar() {
    if (!window.confirm(t.palavraPasseRetirarConfirmar)) return;
    accao.limpar();
    void vez.correr(async () => {
      try {
        await comRecente(() => api.retirarPalavraPasse());
        if (await aoMudar()) accao.setSucesso("palavraPasseRetirada");
      } catch (e) {
        await accao.falhou(e);
      }
    });
  }

  return (
    <section className="cartao" aria-labelledby="titulo-palavra-passe">
      <h2 id="titulo-palavra-passe">{t.palavraPasseTitulo}</h2>
      <p>{t.palavraPasseExplicacao}</p>
      {invalido === null ? null : <CaixaDeErro erro={{ texto: t[invalido] }} />}
      <ResultadoDaAccao accao={accao} />
      {passo.passo === "ver" ? (
        <>
          <p>
            <strong>
              {estado === "activa"
                ? t.palavraPasseActiva
                : estado === "pendente"
                  ? t.palavraPassePendente
                  : t.palavraPasseNenhuma}
            </strong>
          </p>
          <div className="linha">
            <button
              type="button"
              onClick={() => {
                accao.limpar();
                setPasso({ passo: "escolher" });
              }}
              disabled={!podeAgirSemPasskey}
            >
              {estado === "activa"
                ? t.palavraPasseTrocar
                : t.palavraPasseActivar}
            </button>
            {estado === "activa" ? (
              <button type="button" onClick={retirar} disabled={!podeAgir}>
                {t.palavraPasseRetirar}
              </button>
            ) : null}
          </div>
        </>
      ) : passo.passo === "escolher" ? (
        <form onSubmit={aoEscolher} noValidate>
          <div className="campo">
            <label htmlFor="palavra-nova">{t.palavraPasseCampo}</label>
            <input
              id="palavra-nova"
              name="palavra-nova"
              type="password"
              autoComplete="new-password"
              maxLength={256}
              value={palavra}
              aria-invalid={invalido === "erroPalavraPasseCurta"}
              onChange={(e) => {
                setPalavra(e.target.value);
              }}
              required
            />
          </div>
          <div className="campo">
            <label htmlFor="palavra-repetida">{t.palavraPasseRepetir}</label>
            <input
              id="palavra-repetida"
              name="palavra-repetida"
              type="password"
              autoComplete="new-password"
              maxLength={256}
              value={repetida}
              aria-invalid={invalido === "erroPalavraPasseDiferente"}
              onChange={(e) => {
                setRepetida(e.target.value);
              }}
              required
            />
          </div>
          <div className="linha">
            <button type="submit" className="principal" disabled={vez.ocupado}>
              {t.palavraPasseContinuar}
            </button>
            <button type="button" onClick={recomecar} disabled={vez.ocupado}>
              {t.cancelar}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={aoConfirmar} noValidate>
          <p>{t.autenticadorPasso}</p>
          <div className="aviso" role="note">
            {t.autenticadorAviso}
          </div>
          <Qr texto={passo.uri} rotulo={t.autenticadorQr} />
          <p>
            <strong>{t.autenticadorSegredo}</strong>
          </p>
          <p className="segredo">{segredoEmGrupos(passo.segredo)}</p>
          <div className="campo">
            <label htmlFor="codigo-totp">{t.autenticadorCodigo}</label>
            <input
              id="codigo-totp"
              name="codigo-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={codigo}
              aria-invalid={invalido === "erroCodigoTotp"}
              onChange={(e) => {
                setCodigo(e.target.value);
              }}
              required
            />
          </div>
          <div className="linha">
            <button type="submit" className="principal" disabled={vez.ocupado}>
              {t.autenticadorConfirmar}
            </button>
            <button type="button" onClick={recomecar} disabled={vez.ocupado}>
              {t.cancelar}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
