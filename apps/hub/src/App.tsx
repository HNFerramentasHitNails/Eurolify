import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { lerSegredoDaLigacao } from "./convite";
import { fecharAvisoDeRecuperada } from "./recuperacao";
import { ContextoHub, type Contexto } from "./contexto";
import { Artigo } from "./ecras/Artigo";
import { ArtigoEditar } from "./ecras/ArtigoEditar";
import { ArtigoNovo } from "./ecras/ArtigoNovo";
import { Artigos } from "./ecras/Artigos";
import { Chaves } from "./ecras/Chaves";
import { Conta } from "./ecras/Conta";
import { Convite } from "./ecras/Convite";
import { Entrar } from "./ecras/Entrar";
import { Equipa } from "./ecras/Equipa";
import { Inicio } from "./ecras/Inicio";
import { Recuperar } from "./ecras/Recuperar";
import {
  aplicarTema,
  guardarTema,
  lerTema,
  temaGuardado,
  TEMAS,
  type Tema,
} from "./tema";
import {
  guardarLingua,
  linguaGuardada,
  LINGUAS,
  NOMES_LINGUAS,
  TAG_LINGUA,
  TEXTOS,
  type Lingua,
} from "./textos";

// As páginas do Hub (docs/22 §2, §9 e §11): /entrar, /recuperar, /convite,
// /equipa, /artigos, /artigos/novo, /artigos/{prd_…},
// /artigos/{prd_…}/editar, /chaves,
// /conta e /. Nunca debaixo de /hub/, que é da API.

// O segredo do convite lê-se uma vez, ao abrir a página, e sai logo da
// barra de endereço (docs/22 §2).
const CAMINHO_ARTIGO = /^\/artigos\/([^/]+)$/;
const CAMINHO_EDITAR = /^\/artigos\/([^/]+)\/editar$/;

const segredoInicial =
  window.location.pathname === "/convite" ? lerSegredoDaLigacao() : null;

export function App() {
  const [lingua, setLingua] = useState<Lingua>(linguaGuardada);
  const [tema, setTema] = useState<Tema>(temaGuardado);
  const [local, setLocal] = useState(() => ({
    caminho: window.location.pathname,
    consulta: window.location.search,
  }));

  // A guarda de saída do ecrã aberto (contexto.tsx, definirGuarda).
  const guarda = useRef<(() => boolean) | null>(null);
  const podeSair = useCallback(() => guarda.current?.() ?? true, []);
  // O endereço que está à vista: o «voltar» recusado volta a pô-lo.
  const enderecoActual = useRef(
    `${window.location.pathname}${window.location.search}`,
  );

  useEffect(() => {
    const aoVoltar = () => {
      if (!podeSair()) {
        window.history.pushState(null, "", enderecoActual.current);
        return;
      }
      guarda.current = null;
      enderecoActual.current = `${window.location.pathname}${window.location.search}`;
      setLocal({
        caminho: window.location.pathname,
        consulta: window.location.search,
      });
    };
    window.addEventListener("popstate", aoVoltar);
    return () => {
      window.removeEventListener("popstate", aoVoltar);
    };
  }, [podeSair]);

  useEffect(() => {
    document.documentElement.lang = TAG_LINGUA[lingua];
  }, [lingua]);

  useEffect(() => {
    aplicarTema(tema, document.documentElement);
  }, [tema]);

  const navegar = useCallback(
    (destino: string, opcoes: { substituir?: boolean } = {}) => {
      if (!podeSair()) return;
      guarda.current = null;
      if (opcoes.substituir === true) {
        window.history.replaceState(null, "", destino);
      } else {
        window.history.pushState(null, "", destino);
      }
      const url = new URL(destino, window.location.origin);
      enderecoActual.current = `${url.pathname}${url.search}`;
      setLocal({ caminho: url.pathname, consulta: url.search });
      document.getElementById("conteudo")?.focus();
    },
    [podeSair],
  );

  const definirGuarda = useCallback((pergunta: (() => boolean) | null) => {
    guarda.current = pergunta;
  }, []);

  // O vidro sai em toda a página enquanto estiver ligado; não se guarda.
  const [opaco, mudarOpaco] = useState(false);
  useEffect(() => {
    if (opaco) document.documentElement.dataset.superficie = "opaca";
    else delete document.documentElement.dataset.superficie;
  }, [opaco]);

  const t = TEXTOS[lingua];
  const contexto = useMemo<Contexto>(
    () => ({ t, lingua, navegar, definirGuarda, opaco, mudarOpaco }),
    [t, lingua, navegar, definirGuarda, opaco],
  );

  // «/artigos/novo» é o ecrã de criar, não a ficha de um artigo «novo».
  const novo = local.caminho === "/artigos/novo";
  const artigo = novo
    ? null
    : (CAMINHO_ARTIGO.exec(local.caminho)?.[1] ?? null);
  const editar = CAMINHO_EDITAR.exec(local.caminho)?.[1] ?? null;
  const comSessao =
    novo ||
    artigo !== null ||
    editar !== null ||
    local.caminho === "/" ||
    local.caminho === "/equipa" ||
    local.caminho === "/artigos" ||
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
            : local.caminho === "/artigos"
              ? t.artigosTitulo
              : novo
                ? t.artigoNovoTitulo
                : artigo !== null
                  ? t.artigoTitulo
                  : editar !== null
                    ? t.artigoEditarTitulo
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
        // Outro comerciante, outro ecrã: os membros de um nunca ficam por
        // baixo do título de outro (revisão do #219, P2-2).
        key={new URLSearchParams(local.consulta).get("comerciante") ?? ""}
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
      />
    );
  else if (local.caminho === "/artigos")
    ecra = (
      <Artigos
        // Outro comerciante, outro ecrã: nada do anterior fica.
        key={new URLSearchParams(local.consulta).get("comerciante") ?? ""}
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
        consulta={local.consulta}
      />
    );
  else if (novo)
    ecra = (
      <ArtigoNovo
        key={new URLSearchParams(local.consulta).get("comerciante") ?? ""}
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
      />
    );
  else if (editar !== null)
    ecra = (
      <ArtigoEditar
        key={`${editar} ${new URLSearchParams(local.consulta).get("comerciante") ?? ""}`}
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
        artigo={editar}
        consulta={local.consulta}
      />
    );
  else if (artigo !== null)
    ecra = (
      <Artigo
        // Outro artigo ou outro comerciante, outra ficha: nada da anterior.
        key={`${artigo} ${new URLSearchParams(local.consulta).get("comerciante") ?? ""}`}
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
        artigo={artigo}
        consulta={local.consulta}
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
  else
    ecra = (
      <Inicio
        comerciante={new URLSearchParams(local.consulta).get("comerciante")}
      />
    );

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
          <label className="so-leitores" htmlFor="tema">
            {t.tema}
          </label>
          <select
            id="tema"
            value={tema}
            onChange={(e) => {
              const novo = lerTema(e.target.value);
              setTema(novo);
              guardarTema(novo);
            }}
          >
            {TEMAS.map((x) => (
              <option key={x} value={x}>
                {t[`tema_${x}`]}
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
                // Com alterações por guardar, pergunta antes de sair (uma
                // vez: a guarda sai depois de aceite).
                if (!podeSair()) return;
                guarda.current = null;
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
