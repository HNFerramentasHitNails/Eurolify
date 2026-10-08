import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { lerSegredoDaLigacao } from "./convite";
import { fecharAvisoDeRecuperada } from "./recuperacao";
import { ContextoHub, type Contexto } from "./contexto";
import { Chaves } from "./ecras/Chaves";
import { Conta } from "./ecras/Conta";
import { Convite } from "./ecras/Convite";
import { Entrar } from "./ecras/Entrar";
import { Equipa } from "./ecras/Equipa";
import { Inicio } from "./ecras/Inicio";
import { Recuperar } from "./ecras/Recuperar";
import {
  guardarLingua,
  linguaGuardada,
  LINGUAS,
  NOMES_LINGUAS,
  TAG_LINGUA,
  TEXTOS,
  type Lingua,
} from "./textos";

// As páginas do Hub (docs/22 §2 e §9): /entrar, /recuperar, /convite,
// /equipa, /chaves, /conta e /. Nunca debaixo de /hub/, que é da API.

// O segredo do convite lê-se uma vez, ao abrir a página, e sai logo da
// barra de endereço (docs/22 §2).
const segredoInicial =
  window.location.pathname === "/convite" ? lerSegredoDaLigacao() : null;

export function App() {
  const [lingua, setLingua] = useState<Lingua>(linguaGuardada);
  const [local, setLocal] = useState(() => ({
    caminho: window.location.pathname,
    consulta: window.location.search,
  }));

  useEffect(() => {
    const aoVoltar = () => {
      setLocal({
        caminho: window.location.pathname,
        consulta: window.location.search,
      });
    };
    window.addEventListener("popstate", aoVoltar);
    return () => {
      window.removeEventListener("popstate", aoVoltar);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = TAG_LINGUA[lingua];
  }, [lingua]);

  const navegar = useCallback(
    (destino: string, opcoes: { substituir?: boolean } = {}) => {
      if (opcoes.substituir === true) {
        window.history.replaceState(null, "", destino);
      } else {
        window.history.pushState(null, "", destino);
      }
      const url = new URL(destino, window.location.origin);
      setLocal({ caminho: url.pathname, consulta: url.search });
      document.getElementById("conteudo")?.focus();
    },
    [],
  );

  const t = TEXTOS[lingua];
  const contexto = useMemo<Contexto>(
    () => ({ t, lingua, navegar }),
    [t, lingua, navegar],
  );

  const comSessao =
    local.caminho === "/" ||
    local.caminho === "/equipa" ||
    local.caminho === "/chaves" ||
    local.caminho === "/conta";

  // O título da janela diz a página (WCAG 2.4.2; revisão do #158, P3-6).
  const tituloDaPagina =
    local.caminho === "/entrar"
      ? t.entrarTitulo
      : local.caminho === "/recuperar"
        ? t.recuperarTitulo
        : local.caminho === "/convite"
          ? t.conviteTitulo
          : local.caminho === "/equipa"
            ? t.equipaTitulo
            : local.caminho === "/chaves"
              ? t.chavesTitulo
              : local.caminho === "/conta"
                ? t.contaTitulo
                : t.inicioTitulo;
  useEffect(() => {
    document.title = `${tituloDaPagina} — ${t.marca}`;
  }, [tituloDaPagina, t.marca]);

  let ecra;
  if (local.caminho === "/entrar") ecra = <Entrar />;
  else if (local.caminho === "/recuperar") ecra = <Recuperar />;
  else if (local.caminho === "/convite")
    ecra = <Convite segredo={segredoInicial} />;
  else if (local.caminho === "/equipa")
    ecra = (
      <Equipa
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
      />
    );
  else if (local.caminho === "/chaves")
    ecra = (
      <Chaves
        // Outro comerciante, outro ecrã: nada do anterior fica (revisão do
        // #183, P3-9).
        key={new URLSearchParams(local.consulta).get("comerciante") ?? ""}
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
      />
    );
  else if (local.caminho === "/conta")
    ecra = (
      <Conta
        recuperada={
          new URLSearchParams(local.consulta).get("recuperada") === "1"
        }
      />
    );
  else ecra = <Inicio />;

  return (
    <ContextoHub.Provider value={contexto}>
      <a className="salto" href="#conteudo">
        {t.saltarParaConteudo}
      </a>
      <header className="cabecalho">
        <span className="marca">{t.marca}</span>
        <div className="cabecalho-accoes">
          <label className="so-leitores" htmlFor="lingua">
            {t.lingua}
          </label>
          <select
            id="lingua"
            value={lingua}
            onChange={(e) => {
              const l = e.target.value as Lingua;
              setLingua(l);
              guardarLingua(l);
            }}
          >
            {LINGUAS.map((l) => (
              <option key={l} value={l} lang={TAG_LINGUA[l]}>
                {NOMES_LINGUAS[l]}
              </option>
            ))}
          </select>
          {comSessao && local.caminho !== "/conta" ? (
            <a
              href="/conta"
              onClick={(e) => {
                e.preventDefault();
                navegar("/conta");
              }}
            >
              {t.contaLigacao}
            </a>
          ) : null}
          {comSessao ? (
            <button
              type="button"
              onClick={() => {
                // O aviso de conta recuperada é desta pessoa, não do
                // navegador (revisão do #174, P3-1).
                fecharAvisoDeRecuperada();
                void api.sair().finally(() => {
                  navegar("/entrar", { substituir: true });
                });
              }}
            >
              {t.sair}
            </button>
          ) : null}
        </div>
      </header>
      <main id="conteudo" tabIndex={-1}>
        {ecra}
      </main>
    </ContextoHub.Provider>
  );
}
