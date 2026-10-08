import { useState, type SyntheticEvent } from "react";
import { ErroHub } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, type MensagemDeErro } from "../erros";
import { recuperar, temPasskeys } from "../passkeys";
import { codigoBemEscrito, marcarRecuperada } from "../recuperacao";

// Recuperar a conta com um código de recuperação e uma passkey nova (docs/22
// §9.1). A API dá a mesma recusa para e-mail sem conta, código errado ou já
// usado (de propósito): o ecrã também não as distingue.

export function Recuperar() {
  const { t, lingua, navegar } = useHub();
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [aEspera, setAEspera] = useState(false);
  const [erro, setErro] = useState<MensagemDeErro | null>(null);

  async function aoRecuperar(evento: SyntheticEvent) {
    evento.preventDefault();
    const emailLimpo = email.trim();
    const nomeLimpo = nome.trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(emailLimpo)) {
      setErro({ texto: t.erroEmail });
      return;
    }
    if (!codigoBemEscrito(codigo)) {
      setErro({ texto: t.erroCodigo });
      return;
    }
    if (nomeLimpo.length > 100) {
      setErro({ texto: t.erroNomePasskey });
      return;
    }
    setErro(null);
    setAEspera(true);
    try {
      await recuperar(emailLimpo, codigo.trim(), nomeLimpo);
      // O código sai da memória do ecrã logo que serviu.
      setCodigo("");
      marcarRecuperada();
      navegar("/conta?recuperada=1", { substituir: true });
    } catch (e) {
      setErro(
        e instanceof ErroHub && e.codigo === "auth.unauthenticated"
          ? { texto: t.erroRecuperar }
          : mensagemDeErro(e, t, lingua),
      );
      setAEspera(false);
    }
  }

  return (
    <section className="cartao estreito" aria-labelledby="titulo">
      <h1 id="titulo">{t.recuperarTitulo}</h1>
      {temPasskeys() ? (
        <>
          <p>{t.recuperarExplicacao}</p>
          {erro === null ? null : <CaixaDeErro erro={erro} />}
          {aEspera ? <ACarregar /> : null}
          <form onSubmit={(e) => void aoRecuperar(e)} noValidate>
            <div className="campo">
              <label htmlFor="email">{t.recuperarEmail}</label>
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
              <label htmlFor="codigo">{t.recuperarCodigo}</label>
              <input
                id="codigo"
                name="codigo"
                autoComplete="off"
                aria-describedby="codigo-ajuda"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                value={codigo}
                onChange={(e) => {
                  setCodigo(e.target.value);
                }}
                required
              />
              <p className="secundario" id="codigo-ajuda">
                {t.recuperarCodigoAjuda}
              </p>
            </div>
            <div className="campo">
              <label htmlFor="nome">{t.recuperarNome}</label>
              <input
                id="nome"
                name="nome"
                autoComplete="off"
                maxLength={100}
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                }}
              />
            </div>
            <button type="submit" className="principal" disabled={aEspera}>
              {aEspera ? t.entrarAEspera : t.recuperarBotao}
            </button>
          </form>
        </>
      ) : (
        <div className="aviso" role="alert">
          {t.semPasskeys}
        </div>
      )}
      <p>
        <a
          href="/entrar"
          onClick={(e) => {
            e.preventDefault();
            navegar("/entrar");
          }}
        >
          {t.recuperarVoltar}
        </a>
      </p>
    </section>
  );
}
