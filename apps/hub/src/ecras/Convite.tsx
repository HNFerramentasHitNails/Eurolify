import { useState, type SyntheticEvent } from "react";
import { CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, type MensagemDeErro } from "../erros";
import { criarConta, temPasskeys } from "../passkeys";
import { Copiar } from "./Copiar";

// Aceitar um convite e criar a conta (docs/22 §3). O segredo chega do
// fragmento da ligação, já lido e apagado da barra de endereço pela App.

export function Convite({ segredo }: { segredo: string | null }) {
  const { t, lingua, navegar } = useHub();
  const [nome, setNome] = useState("");
  const [aEspera, setAEspera] = useState(false);
  const [erro, setErro] = useState<MensagemDeErro | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);

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
      setErro(mensagemDeErro(e, t, lingua));
    } finally {
      setAEspera(false);
    }
  }

  return (
    <section className="cartao estreito" aria-labelledby="titulo">
      <h1 id="titulo">{t.conviteTitulo}</h1>
      <p>{t.conviteExplicacao}</p>
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
    </section>
  );
}
