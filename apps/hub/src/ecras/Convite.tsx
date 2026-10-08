import { useEffect, useState, type SyntheticEvent } from "react";
import { api, ErroHub, type DetalheConvite, type Eu } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao, type MensagemDeErro } from "../erros";
import { comRecente, criarConta, entrar, temPasskeys } from "../passkeys";
import { fecharAvisoDeRecuperada } from "../recuperacao";
import { preencher, TAG_LINGUA } from "../textos";
import { Copiar } from "./Copiar";

// Aceitar um convite: com uma conta nova (docs/22 §3) ou com a conta que o
// e-mail já tem (§10: entrar e aceitar; com sessão, aceitar logo). Antes,
// o que o convite diz: o comerciante, o papel, o e-mail e quando expira
// (§10, issue #194). O segredo
// chega do fragmento da ligação, já lido e apagado da barra de endereço pela
// App, e só vive na memória do ecrã.

export function Convite({ segredo }: { segredo: string | null }) {
  const { t, lingua, navegar } = useHub();
  const [nome, setNome] = useState("");
  const [aEspera, setAEspera] = useState(false);
  const [erro, setErro] = useState<MensagemDeErro | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  // Quem já tem sessão aberta (undefined: ainda a ler; null: ninguém).
  const [eu, setEu] = useState<Eu | null | undefined>(undefined);
  // A API disse que o e-mail já tem conta: oferece-se entrar e aceitar.
  const [contaExiste, setContaExiste] = useState(false);
  // O que o convite diz (undefined: ainda a ler; null: não se conseguiu ler,
  // e o erro fica em `erroDetalhe`). Um convite que não vale fica à parte.
  const [detalhe, setDetalhe] = useState<DetalheConvite | null | undefined>(
    undefined,
  );
  const [erroDetalhe, setErroDetalhe] = useState<unknown>(null);
  const [invalido, setInvalido] = useState(false);

  useEffect(() => {
    api.eu().then(
      (r) => {
        setEu(r);
      },
      () => {
        setEu(null);
      },
    );
  }, []);

  useEffect(() => {
    if (segredo === null) return;
    // Só conta a resposta do segredo actual (revisão do #196, P3-4).
    let activo = true;
    api.verConvite(segredo).then(
      (r) => {
        if (activo) setDetalhe(r);
      },
      (e: unknown) => {
        if (!activo) return;
        if (e instanceof ErroHub && e.codigo === "invite.invalid") {
          setInvalido(true);
        } else {
          // Sem rede ou 429: mostra o erro e deixa seguir; aceitar dá a sua
          // própria resposta.
          setErroDetalhe(e);
        }
        setDetalhe(null);
      },
    );
    return () => {
      activo = false;
    };
  }, [segredo]);

  if (segredo === null) {
    return (
      <section className="cartao estreito" aria-labelledby="titulo">
        <h1 id="titulo">{t.conviteTitulo}</h1>
        <div className="aviso" role="alert">
          {t.conviteSemSegredo}
        </div>
      </section>
    );
  }
  const convite = segredo;

  if (codigos !== null) {
    return (
      <section className="cartao estreito" aria-labelledby="titulo">
        <h1 id="titulo">{t.codigosTitulo}</h1>
        <p>{t.codigosExplicacao}</p>
        <div className="aviso" role="note">
          {t.codigosAviso}
        </div>
        <ul className="codigos" translate="no" aria-label={t.codigosTitulo}>
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
              navegar("/");
            }}
          >
            {t.codigosGuardados}
          </button>
        </div>
      </section>
    );
  }

  async function aoCriar(evento: SyntheticEvent) {
    evento.preventDefault();
    const limpo = nome.trim();
    if (limpo.length < 1 || limpo.length > 100) {
      setErro({ texto: t.erroNome });
      return;
    }
    setErro(null);
    setAEspera(true);
    try {
      const conta = await criarConta(convite, limpo);
      setCodigos(conta.codigos);
    } catch (e) {
      if (e instanceof ErroHub && e.codigo === "invite.account_exists") {
        setContaExiste(true);
        setErro(null);
      } else {
        setErro(mensagemDeErro(e, t, lingua));
      }
    } finally {
      setAEspera(false);
    }
  }

  /** Aceitar com a conta que já existe: entra (se preciso) e aceita. */
  async function aoAceitar(entrarAntes: boolean) {
    setErro(null);
    setAEspera(true);
    try {
      if (entrarAntes) await entrar();
      // Acabou de entrar: a sessão é recente. Com uma sessão antiga, pede a
      // passkey outra vez.
      await comRecente(() => api.aceitarConvite(convite));
      navegar("/", { substituir: true });
    } catch (e) {
      setErro(mensagemDeErro(e, t, lingua));
      setAEspera(false);
      if (entrarAntes) {
        // Entrou com a passkey de outra conta (num computador partilhado):
        // o ecrã passa a dizer quem entrou e a oferecer «Sair» (revisão do
        // #188, P2-2).
        await lerQuemEntrou();
      } else if (semSessao(e)) {
        // A sessão acabou entre abrir e aceitar: volta ao ecrã sem sessão,
        // que diz como entrar (P3-8).
        setEu(null);
      }
    }
  }

  /** Quem tem a sessão deste navegador, ou ninguém. */
  async function lerQuemEntrou() {
    try {
      setEu(await api.eu());
    } catch {
      setEu(null);
    }
  }

  /** Sair aqui mesmo; o segredo do convite continua na memória do ecrã. */
  async function aoSair() {
    setErro(null);
    setAEspera(true);
    // O aviso de conta recuperada é desta pessoa (revisão do #174, P3-1;
    // revisão do #188, P2-3).
    fecharAvisoDeRecuperada();
    try {
      await api.sair();
    } catch (e) {
      setErro(mensagemDeErro(e, t, lingua));
    }
    // Só muda de ecrã se a sessão terminou mesmo.
    await lerQuemEntrou();
    setAEspera(false);
  }

  if (invalido) {
    // Expirado, usado, cancelado ou inexistente: nada para aceitar.
    return (
      <section className="cartao estreito" aria-labelledby="titulo">
        <h1 id="titulo">{t.conviteTitulo}</h1>
        <div className="aviso" role="alert">
          {t.erroConviteInvalido}
        </div>
        {/* Com sessão, uma saída para o Hub (revisão do #196, P3-5). */}
        {eu === undefined || eu === null ? null : (
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navegar("/");
            }}
          >
            {t.equipaVoltar}
          </a>
        )}
      </section>
    );
  }

  if (eu === undefined || detalhe === undefined) {
    // Ainda não se sabe se há sessão: nada que engane (P3-7).
    return (
      <section className="cartao estreito" aria-labelledby="titulo">
        <h1 id="titulo">{t.conviteTitulo}</h1>
        <ACarregar />
      </section>
    );
  }

  const resumo =
    detalhe === null ? (
      erroDetalhe === null ? null : (
        <CaixaDeErro erro={mensagemDeErro(erroDetalhe, t, lingua)} />
      )
    ) : (
      <div>
        <p>
          {preencher(t.conviteResumo, {
            comerciante: detalhe.comerciante_nome,
            papel: t[`papel_${detalhe.papel}`],
          })}
        </p>
        <p>
          {preencher(t.conviteParaEmail, {
            email: detalhe.email,
            data: new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(detalhe.expira_em)),
          })}
        </p>
      </div>
    );

  if (eu !== null) {
    // Só um aviso: quem decide é a base (invite.other_person), e o botão
    // fica activo — comparar e-mails aqui podia recusar o que ela aceita
    // (revisão do #196, P2-1).
    const outroEmail =
      detalhe !== null &&
      detalhe.email.toLowerCase() !== eu.email.toLowerCase();
    return (
      <section className="cartao estreito" aria-labelledby="titulo">
        <h1 id="titulo">{t.conviteTitulo}</h1>
        {resumo}
        <p>
          {preencher(t.conviteComSessao, { nome: eu.nome, email: eu.email })}
        </p>
        {outroEmail ? (
          <div className="aviso" role="note" id="convite-outro-email">
            {preencher(t.conviteEmailDiferente, {
              email: detalhe.email,
              sessao: eu.email,
            })}
          </div>
        ) : null}
        {erro === null ? null : <CaixaDeErro erro={erro} />}
        <button
          type="button"
          className="principal"
          disabled={aEspera}
          aria-describedby={outroEmail ? "convite-outro-email" : undefined}
          onClick={() => void aoAceitar(false)}
        >
          {aEspera ? t.aCarregar : t.conviteAceitarComConta}
        </button>
        {/* Sem o resumo, não se sabe para que e-mail é (P3-6). */}
        {detalhe === null ? (
          <p className="secundario">{t.conviteOutraConta}</p>
        ) : null}
        <button type="button" disabled={aEspera} onClick={() => void aoSair()}>
          {t.sair}
        </button>
      </section>
    );
  }

  if (contaExiste) {
    return (
      <section className="cartao estreito" aria-labelledby="titulo">
        <h1 id="titulo">{t.conviteTitulo}</h1>
        {resumo}
        <div className="aviso" role="note">
          {t.conviteContaExiste}
        </div>
        {erro === null ? null : <CaixaDeErro erro={erro} />}
        {temPasskeys() ? (
          <button
            type="button"
            className="principal"
            disabled={aEspera}
            onClick={() => void aoAceitar(true)}
          >
            {aEspera ? t.entrarAEspera : t.conviteEntrarEAceitar}
          </button>
        ) : null}
        <p className="secundario">{t.conviteSoPalavraPasse}</p>
      </section>
    );
  }

  return (
    <section className="cartao estreito" aria-labelledby="titulo">
      <h1 id="titulo">{t.conviteTitulo}</h1>
      {resumo}
      <p>{detalhe === null ? t.conviteExplicacao : t.conviteInstrucao}</p>
      {temPasskeys() ? null : (
        <div className="aviso" role="alert">
          {t.semPasskeys}
        </div>
      )}
      {erro === null ? null : <CaixaDeErro erro={erro} />}
      <form onSubmit={(e) => void aoCriar(e)} noValidate>
        <div className="campo">
          <label htmlFor="nome">{t.conviteNome}</label>
          <input
            id="nome"
            name="nome"
            autoComplete="name"
            maxLength={100}
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
            }}
            required
          />
        </div>
        <button
          type="submit"
          className="principal"
          disabled={aEspera || !temPasskeys()}
        >
          {aEspera ? t.entrarAEspera : t.conviteBotao}
        </button>
      </form>
      {/* Quem já tem conta (também só com a palavra-passe) entra primeiro
          (revisão do #188, P2-4). */}
      <p>
        {t.conviteJaTemConta}{" "}
        <a
          href="/entrar"
          onClick={(e) => {
            e.preventDefault();
            navegar("/entrar");
          }}
        >
          {t.entrarTitulo}
        </a>
      </p>
    </section>
  );
}
