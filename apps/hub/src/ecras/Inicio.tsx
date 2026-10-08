import { useCallback, useEffect, useState } from "react";
import { api, type Eu } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao, type MensagemDeErro } from "../erros";

// Os comerciantes de quem entrou (docs/22 §3).

export function Inicio() {
  const { t, lingua, navegar } = useHub();
  const [eu, setEu] = useState<Eu | null>(null);
  // O erro guarda-se cru e traduz-se ao mostrar: mudar a língua não volta a
  // pedir nada (revisão do #158, P3-7).
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);

  const carregar = useCallback(async () => {
    setFalha(null);
    try {
      setEu(await api.eu());
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [navegar]);

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
                  {/* Só o dono gere chaves (keys:write); a API decide. */}
                  {c.papel === "dono" ? (
                    <a
                      href={`/chaves?comerciante=${encodeURIComponent(c.comerciante)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navegar(
                          `/chaves?comerciante=${encodeURIComponent(c.comerciante)}`,
                        );
                      }}
                    >
                      {t.verChaves}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
