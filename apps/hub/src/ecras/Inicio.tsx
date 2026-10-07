import { useCallback, useEffect, useState } from "react";
import { api, type Eu } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao, type MensagemDeErro } from "../erros";

// Os comerciantes de quem entrou (docs/22 §3).

export function Inicio() {
  const { t, lingua, navegar } = useHub();
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<MensagemDeErro | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setEu(await api.eu());
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar");
        return;
      }
      setErro(mensagemDeErro(e, t, lingua));
    }
  }, [t, lingua, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <section aria-labelledby="titulo">
      <h1 id="titulo">{t.inicioTitulo}</h1>
      {erro !== null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : eu === null ? (
        <ACarregar />
      ) : (
        <>
          <p className="secundario">
            {t.inicioEntrouComo} {eu.nome} ({eu.email})
          </p>
          {eu.comerciantes.length === 0 ? (
            <p>{t.inicioVazio}</p>
          ) : (
            <ul className="lista-simples">
              {eu.comerciantes.map((c) => (
                <li key={c.comerciante}>
                  <span>
                    <strong>{c.nome}</strong>{" "}
                    <span className="secundario">{t[`papel_${c.papel}`]}</span>
                  </span>
                  <a
                    href={`/equipa?comerciante=${encodeURIComponent(c.comerciante)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navegar(
                        `/equipa?comerciante=${encodeURIComponent(c.comerciante)}`,
                      );
                    }}
                  >
                    {t.verEquipa}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
