import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  api,
  ErroHub,
  type ChaveApi,
  type Eu,
  type Passkey,
  type Sessao,
} from "../api";
import { chavesAPropor } from "../chaves";
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
          {/* As chaves que a pessoa criou, para ela decidir: só se propõe
              revogar, nunca se revoga sozinho (docs/22 §22; docs/06, DC). */}
          {eu.dados === null
            ? null
            : ((dados: Eu) =>
                dados.comerciantes
                  .filter((c) => c.papel === "dono")
                  .map((c) => (
                    <ChavesAPropor
                      key={c.comerciante}
                      comerciante={c}
                      pessoa={dados.pessoa}
                      vez={vez}
                    />
                  )))(eu.dados)}
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
          email={eu.dados.email}
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

/**
 * Depois de recuperar, num comerciante de que é dono: as chaves activas que
 * a pessoa criou (uma sessão roubada pode ter criado uma que fica; revisão
 * do #149, P2-1), cada uma com «Revogar». Nada se revoga sem a pessoa
 * carregar e confirmar (docs/06, DC).
 */
function ChavesAPropor({
  comerciante,
  pessoa,
  vez,
}: {
  comerciante: Eu["comerciantes"][number];
  pessoa: string;
  vez: Vez;
}) {
  const { t, lingua } = useHub();
  const dataHora = useDataHora();
  const id = comerciante.comerciante;
  const ler = useCallback(() => api.chaves(id), [id]);
  const lista = useLista(ler);
  const accao = useAccao();
  const erroLista: MensagemDeErro | null =
    lista.falha === null ? null : mensagemDeErro(lista.falha, t, lingua);
  const caixaDeSucesso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (accao.sucesso !== null) caixaDeSucesso.current?.focus();
  }, [accao.sucesso]);

  function revogar(c: ChaveApi) {
    if (!window.confirm(preencher(t.chaveRevogarConfirmar, { nome: c.nome }))) {
      return;
    }
    accao.limpar();
    void vez.correr(async () => {
      try {
        await comRecente(() => api.revogarChave(id, c.id));
        if (await lista.carregar()) accao.setSucesso("chaveRevogada");
      } catch (e) {
        await accao.falhou(e);
        // Já revogada noutro separador: a lista volta a ler-se.
        if (
          e instanceof ErroHub &&
          (e.codigo === "key.already_revoked" || e.codigo === "key.not_found")
        ) {
          await lista.carregar();
        }
      }
    });
  }

  const propostas =
    lista.dados === null
      ? null
      : chavesAPropor(lista.dados.dados, pessoa, new Date());
  const titulo = `titulo-propor-${id}`;
  return (
    <div
      className="propostas-chaves"
      role="group"
      aria-labelledby={titulo}
      data-comerciante={id}
    >
      <p>
        <strong id={titulo}>
          {preencher(t.recuperadoChavesTitulo, {
            comerciante: comerciante.nome,
          })}
        </strong>
      </p>
      {erroLista !== null ? (
        <CaixaDeErro erro={erroLista} aoTentar={() => void lista.carregar()} />
      ) : null}
      {accao.erro === null ? null : <CaixaDeErro erro={accao.erro} />}
      {accao.sucesso === null ? null : (
        <div
          className="sucesso"
          role="status"
          tabIndex={-1}
          ref={caixaDeSucesso}
        >
          {accao.sucesso}
        </div>
      )}
      {propostas === null ? (
        erroLista === null ? (
          <ACarregar />
        ) : null
      ) : propostas.length === 0 ? (
        <p className="secundario">{t.recuperadoChavesNenhuma}</p>
      ) : (
        <>
          <p>{t.recuperadoChavesExplica}</p>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.colunaNome}</th>
                <th scope="col">{t.colunaPrefixo}</th>
                <th scope="col">{t.colunaCriadaEm}</th>
                <th scope="col">{t.colunaUltimoUso}</th>
                <th scope="col">
                  <span className="so-leitores">{t.colunaAccoes}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {propostas.map((c) => (
                <tr key={c.id}>
                  <td data-rotulo={t.colunaNome}>{c.nome}</td>
                  <td data-rotulo={t.colunaPrefixo}>
                    <code>{c.prefixo}…</code>
                  </td>
                  <td data-rotulo={t.colunaCriadaEm}>
                    {dataHora(c.criada_em)}
                  </td>
                  <td data-rotulo={t.colunaUltimoUso}>
                    {c.ultimo_uso_em === null
                      ? t.nunca
                      : dataHora(c.ultimo_uso_em)}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        revogar(c);
                      }}
                      disabled={vez.ocupado}
                      aria-label={`${t.chaveRevogar}: ${c.nome}`}
                    >
                      {t.chaveRevogar}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
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
          <div className="aviso" role="note" tabIndex={-1} ref={avisoRef}>
            {t.codigosAviso}
          </div>
          <ul
            className="codigos"
            translate="no"
            aria-label={t.recuperacaoTitulo}
          >
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
 * QR e o segredo, o primeiro código), trocar e retirar. O segredo e o URI só
 * vivem neste componente enquanto se configura; nunca vão para o endereço nem
 * para o armazenamento do navegador, e saem ao deixar a página (§9.4).
 */
function PalavraPasse({
  vez,
  estado,
  email,
  aoMudar,
}: {
  vez: Vez;
  estado: "activa" | "pendente" | null;
  email: string;
  aoMudar: () => Promise<boolean>;
}) {
  const { t } = useHub();
  const accao = useAccao();
  const [passo, setPasso] = useState<PassoPalavraPasse>({ passo: "ver" });
  const [palavra, setPalavra] = useState("");
  const [repetida, setRepetida] = useState("");
  const [codigo, setCodigo] = useState("");
  const [invalido, setInvalido] = useState<keyof Textos | null>(null);
  // Activar oferece-se também sem passkeys no navegador: quem acabou de
  // entrar com a palavra-passe tem a sessão recente; passados 10 minutos, o
  // ecrã diz-lhe que entre outra vez (revisão do #177, P2-1).
  const podeAgir = !vez.ocupado;

  // O foco acompanha o passo (revisão do #177, P2-2): o primeiro campo, as
  // instruções do código QR e, no fim, o botão do estado. Não na primeira
  // imagem do ecrã.
  const mudouDePasso = useRef(false);
  const primeiroCampo = useRef<HTMLInputElement>(null);
  const instrucoes = useRef<HTMLParagraphElement>(null);
  const botaoDoEstado = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mudouDePasso.current) return;
    mudouDePasso.current = false;
    if (passo.passo === "escolher") primeiroCampo.current?.focus();
    else if (passo.passo === "confirmar") instrucoes.current?.focus();
    else botaoDoEstado.current?.focus();
  }, [passo]);
  const irPara = useCallback((p: PassoPalavraPasse) => {
    mudouDePasso.current = true;
    setPasso(p);
  }, []);

  const recomecar = useCallback(() => {
    irPara({ passo: "ver" });
    setPalavra("");
    setRepetida("");
    setCodigo("");
    setInvalido(null);
  }, [irPara]);

  // Ao deixar a página, o segredo sai também da cache de retrocesso do
  // navegador (revisão do #177, P3-8).
  useEffect(() => {
    const aoSair = () => {
      // Já, antes de o navegador congelar a página (revisão do #183, P3-5).
      flushSync(() => {
        setPasso({ passo: "ver" });
        setPalavra("");
        setRepetida("");
        setCodigo("");
      });
    };
    window.addEventListener("pagehide", aoSair);
    return () => {
      window.removeEventListener("pagehide", aoSair);
    };
  }, []);

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
        irPara({ passo: "confirmar", segredo: r.segredo, uri: r.uri });
        // A base tem agora uma pendente: o estado relê-se (P3-2).
        await aoMudar();
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
        // Substituída ou concluída noutro sítio: o código QR já não vale,
        // recomeça-se (P3-1).
        if (e instanceof ErroHub && e.codigo === "password.not_pending") {
          recomecar();
          await aoMudar();
        }
        await accao.falhou(e);
      }
    });
  }

  function cancelar() {
    recomecar();
    accao.limpar();
    void aoMudar();
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

  const ERRO_DO_CAMPO = "erro-palavra-passe";
  const descrito = (chave: keyof Textos) =>
    invalido === chave
      ? { "aria-invalid": true, "aria-describedby": ERRO_DO_CAMPO }
      : {};

  return (
    <section className="cartao" aria-labelledby="titulo-palavra-passe">
      <h2 id="titulo-palavra-passe">{t.palavraPasseTitulo}</h2>
      <p>{t.palavraPasseExplicacao}</p>
      {invalido === null ? null : (
        <CaixaDeErro erro={{ texto: t[invalido] }} id={ERRO_DO_CAMPO} />
      )}
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
              ref={botaoDoEstado}
              onClick={() => {
                accao.limpar();
                irPara({ passo: "escolher" });
              }}
              disabled={!podeAgir}
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
          {/* O e-mail da conta, para o gestor de palavras-passe a guardar
              com a conta certa (P3-3). */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <div className="campo">
            <label htmlFor="palavra-nova">{t.palavraPasseCampo}</label>
            <input
              id="palavra-nova"
              ref={primeiroCampo}
              name="palavra-nova"
              type="password"
              autoComplete="new-password"
              maxLength={256}
              value={palavra}
              {...descrito("erroPalavraPasseCurta")}
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
              {...descrito("erroPalavraPasseDiferente")}
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
            <button type="button" onClick={cancelar} disabled={vez.ocupado}>
              {t.cancelar}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={aoConfirmar} noValidate>
          <p tabIndex={-1} ref={instrucoes}>
            {t.autenticadorPasso}
          </p>
          <div className="aviso" role="note">
            {t.autenticadorAviso}
          </div>
          <Qr texto={passo.uri} rotulo={t.autenticadorQr} />
          <p>
            <strong>{t.autenticadorSegredo}</strong>
          </p>
          <p className="segredo" translate="no" spellCheck={false}>
            {segredoEmGrupos(passo.segredo)}
          </p>
          <p>{t.autenticadorDepois}</p>
          <div className="campo">
            <label htmlFor="codigo-totp">{t.autenticadorCodigo}</label>
            <input
              id="codigo-totp"
              name="codigo-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={codigo}
              {...descrito("erroCodigoTotp")}
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
            <button type="button" onClick={cancelar} disabled={vez.ocupado}>
              {t.cancelar}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
