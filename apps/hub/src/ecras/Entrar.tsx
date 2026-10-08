import { useState, type SyntheticEvent } from "react";
import { api, ErroHub } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { ErroDoEcra, mensagemDeErro, type MensagemDeErro } from "../erros";
import { codigoTotpLimpo } from "../palavra-passe";
import { entrar, temPasskeys } from "../passkeys";

// Entrar com uma passkey (docs/22 §3) ou, em alternativa, com e-mail,
// palavra-passe e o código do autenticador (§9.2). A palavra-passe sozinha
// nunca entra: a API pede as três.

export function Entrar() {
  const { t, lingua, navegar } = useHub();
  const [comPalavraPasse, setComPalavraPasse] = useState(!temPasskeys());
  const [aEspera, setAEspera] = useState(false);
  // O erro guarda-se cru e traduz-se ao mostrar (muda com a língua).
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);

  async function aoEntrar() {
    setFalha(null);
    setAEspera(true);
    try {
      await entrar();
      navegar("/", { substituir: true });
    } catch (e) {
      setFalha(e);
      setAEspera(false);
    }
  }

  function trocar(palavraPasse: boolean) {
    setFalha(null);
    setComPalavraPasse(palavraPasse);
  }

  return (
    <section className="cartao estreito" aria-labelledby="titulo">
      <h1 id="titulo">{t.entrarTitulo}</h1>
      {comPalavraPasse ? (
        <EntrarComPalavraPasse />
      ) : (
        <>
          <p>{t.entrarExplicacao}</p>
          {erro === null ? null : <CaixaDeErro erro={erro} />}
          {aEspera ? <ACarregar /> : null}
          <button
            type="button"
            className="principal"
            onClick={() => void aoEntrar()}
            disabled={aEspera}
          >
            {aEspera ? t.entrarAEspera : t.entrarBotao}
          </button>
        </>
      )}
      {comPalavraPasse && !temPasskeys() ? (
        <div className="aviso" role="note">
          {t.semPasskeys}
        </div>
      ) : null}
      <p>
        {comPalavraPasse ? (
          temPasskeys() ? (
            <a
              href="/entrar"
              onClick={(e) => {
                e.preventDefault();
                trocar(false);
              }}
            >
              {t.recuperarVoltar}
            </a>
          ) : null
        ) : (
          <a
            href="/entrar"
            onClick={(e) => {
              e.preventDefault();
              trocar(true);
            }}
          >
            {t.entrarComPalavraPasse}
          </a>
        )}
      </p>
      <p>
        <a
          href="/recuperar"
          onClick={(e) => {
            e.preventDefault();
            navegar("/recuperar");
          }}
        >
          {t.entrarPerdeu}
        </a>
      </p>
    </section>
  );
}

function EntrarComPalavraPasse() {
  const { t, lingua, navegar } = useHub();
  const [email, setEmail] = useState("");
  const [palavra, setPalavra] = useState("");
  const [codigo, setCodigo] = useState("");
  const [aEspera, setAEspera] = useState(false);
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);

  async function aoEntrar(evento: SyntheticEvent) {
    evento.preventDefault();
    const emailLimpo = email.trim();
    const codigoLimpo = codigoTotpLimpo(codigo);
    if (!/^[^@\s]+@[^@\s]+$/.test(emailLimpo)) {
      setFalha(new ErroDoEcra("erroEmail"));
      return;
    }
    if (palavra === "") {
      setFalha(new ErroDoEcra("erroEntrarPalavraPasse"));
      return;
    }
    if (codigoLimpo === null) {
      setFalha(new ErroDoEcra("erroCodigoTotp"));
      return;
    }
    setFalha(null);
    setAEspera(true);
    try {
      await api.entrarComPalavraPasse(emailLimpo, palavra, codigoLimpo);
      setPalavra("");
      setCodigo("");
      navegar("/", { substituir: true });
    } catch (e) {
      // A API dá a mesma recusa para tudo o que falha, de propósito; sem a
      // chave TOTP no servidor, a rota não existe (404).
      setFalha(
        e instanceof ErroHub && e.estado === 401
          ? new ErroDoEcra("erroEntrarPalavraPasse")
          : e instanceof ErroHub && e.estado === 404
            ? new ErroDoEcra("erroPalavraPasseIndisponivel")
            : e,
      );
      // O mesmo código não vale duas vezes: pede-se o seguinte.
      setCodigo("");
      setAEspera(false);
    }
  }

  return (
    <>
      {erro === null ? null : <CaixaDeErro erro={erro} />}
      {aEspera ? <ACarregar /> : null}
      <form onSubmit={(e) => void aoEntrar(e)} noValidate>
        <div className="campo">
          <label htmlFor="email">{t.entrarEmail}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            required
          />
        </div>
        <div className="campo">
          <label htmlFor="palavra-passe">{t.entrarPalavraPasse}</label>
          <input
            id="palavra-passe"
            name="palavra-passe"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={palavra}
            onChange={(e) => {
              setPalavra(e.target.value);
            }}
            required
          />
        </div>
        <div className="campo">
          <label htmlFor="codigo">{t.entrarCodigo}</label>
          <input
            id="codigo"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
            }}
            required
          />
        </div>
        <button type="submit" className="principal" disabled={aEspera}>
          {t.entrarPalavraPasseBotao}
        </button>
      </form>
    </>
  );
}
