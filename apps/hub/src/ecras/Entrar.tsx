import { useState } from "react";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, type MensagemDeErro } from "../erros";
import { entrar, temPasskeys } from "../passkeys";

// Entrar com uma passkey (docs/22 §3).

export function Entrar() {
  const { t, lingua, navegar } = useHub();
  const [aEspera, setAEspera] = useState(false);
  const [erro, setErro] = useState<MensagemDeErro | null>(null);

  async function aoEntrar() {
    setErro(null);
    setAEspera(true);
    try {
      await entrar();
      navegar("/", { substituir: true });
    } catch (e) {
      setErro(mensagemDeErro(e, t, lingua));
      setAEspera(false);
    }
  }

  return (
    <section className="cartao estreito" aria-labelledby="titulo">
      <h1 id="titulo">{t.entrarTitulo}</h1>
      {temPasskeys() ? (
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
      ) : (
        <div className="aviso" role="alert">
          {t.semPasskeys}
        </div>
      )}
    </section>
  );
}
