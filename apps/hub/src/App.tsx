import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { lerSegredoDaLigacao } from "./convite";
import { lerFragmentoMoloni } from "./faturacao";
import { fecharAvisoDeRecuperada } from "./recuperacao";
import { ContextoHub, type Contexto } from "./contexto";
import { Artigo } from "./ecras/Artigo";
import { ArtigoEditar } from "./ecras/ArtigoEditar";
import { ArtigoNovo } from "./ecras/ArtigoNovo";
import { ADecidir } from "./ecras/ADecidir";
import { Artigos } from "./ecras/Artigos";
import { Historico } from "./ecras/Historico";
import { OpcoesEditar } from "./ecras/OpcoesEditar";
import { PrecoDaVariante } from "./ecras/PrecoDaVariante";
import { PublicarArtigo } from "./ecras/PublicarArtigo";
import { VarianteEditar } from "./ecras/VarianteEditar";
import { VarianteNova } from "./ecras/VarianteNova";
import { Chaves } from "./ecras/Chaves";
import { EnvioConta, EnvioNova, Envios } from "./ecras/Envios";
import {
  Embalagem,
  MetodoEntregaFormulario,
  MetodosEntrega,
} from "./ecras/EnviosMetodos";
import { DevolucaoPagina, Devolucoes } from "./ecras/Devolucoes";
import { DiferencasPagamento } from "./ecras/DiferencasPagamento";
import { Expedir, ExpedirEncomenda } from "./ecras/Expedir";
import { Conta } from "./ecras/Conta";
import { Convite } from "./ecras/Convite";
import { Entrar } from "./ecras/Entrar";
import { Equipa } from "./ecras/Equipa";
import { ConfigurarFaturacao } from "./ecras/ConfigurarFaturacao";
import { Faturacao, RegressoMoloni } from "./ecras/Faturacao";
import { RelatorioOss } from "./ecras/RelatorioOss";
import { Inicio } from "./ecras/Inicio";
import { Recuperar } from "./ecras/Recuperar";
import { paginaDe, type PaginaAberta } from "./paginas";
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

// As páginas do Hub, com a sessão e o título de cada uma, estão em
// paginas.ts.

// O segredo do convite lê-se uma vez, ao abrir a página, e sai logo da
// barra de endereço (docs/22 §2).
const segredoInicial =
  window.location.pathname === "/convite" ? lerSegredoDaLigacao() : null;

// O código do Moloni vem no fragmento (docs/22 §30.2): lê-se uma vez, ao
// abrir a página, e sai logo da barra de endereço.
function lerRegressoMoloni() {
  const fragmento = window.location.hash;
  if (fragmento !== "") {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
  return lerFragmentoMoloni(fragmento);
}
const regressoMoloni =
  window.location.pathname === "/faturacao/moloni" ? lerRegressoMoloni() : null;

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

  const pagina = paginaDe(local.caminho);
  // «Conta» e «Sair» e o título da janela (WCAG 2.4.2) vêm da tabela das
  // páginas; um caminho que nenhuma serve mostra o início, sem sessão.
  const comSessao = pagina?.sessao ?? false;
  const tituloDaPagina = t[pagina?.titulo ?? "inicioTitulo"];
  useEffect(() => {
    document.title = `${tituloDaPagina} — ${t.marca}`;
  }, [tituloDaPagina, t.marca]);

  const ecra = (
    <Ecra
      pagina={pagina}
      consulta={local.consulta}
      segredoDoConvite={segredoInicial}
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

/**
 * O ecrã de cada página. O `switch` cobre todas as da tabela: uma página
 * nova sem ecrã não compila (o `default` só aceita `never`).
 */
function Ecra({
  pagina,
  consulta,
  segredoDoConvite,
}: {
  pagina: PaginaAberta | null;
  consulta: string;
  segredoDoConvite: string | null;
}) {
  const parametros = new URLSearchParams(consulta);
  const comerciante = parametros.get("comerciante");
  if (pagina === null) return <Inicio comerciante={comerciante} />;
  const [p1 = "", p2 = "", p3 = ""] = pagina.partes;
  // Outro artigo, variante ou comerciante, outro ecrã: nada do anterior fica.
  const chave = [...pagina.partes, comerciante ?? ""].join(" ");
  switch (pagina.nome) {
    case "entrar":
      return <Entrar />;
    case "recuperar":
      return <Recuperar />;
    case "convite":
      return <Convite segredo={segredoDoConvite} />;
    case "inicio":
      return <Inicio comerciante={comerciante} />;
    case "equipa":
      // Os membros de um nunca ficam por baixo do título de outro (revisão
      // do #219, P2-2).
      return <Equipa key={chave} comerciante={comerciante} />;
    case "artigos":
      return (
        <Artigos key={chave} comerciante={comerciante} consulta={consulta} />
      );
    case "artigoNovo":
      return <ArtigoNovo key={chave} comerciante={comerciante} />;
    case "artigo":
      return (
        <Artigo
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          consulta={consulta}
        />
      );
    case "artigoEditar":
      return (
        <ArtigoEditar
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          consulta={consulta}
        />
      );
    case "historico":
      return (
        <Historico
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          consulta={consulta}
        />
      );
    case "opcoes":
      return (
        <OpcoesEditar
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          consulta={consulta}
        />
      );
    case "varianteNova":
      return (
        <VarianteNova
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          consulta={consulta}
        />
      );
    case "variante":
      return (
        <VarianteEditar
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          variante={p2}
          consulta={consulta}
        />
      );
    case "preco":
      return (
        <PrecoDaVariante
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          lista={p2}
          variante={p3}
          consulta={consulta}
        />
      );
    case "publicar":
      return (
        <PublicarArtigo
          key={chave}
          comerciante={comerciante}
          artigo={p1}
          canal={p2}
          mercado={p3}
          consulta={consulta}
        />
      );
    case "aDecidir":
      return (
        <ADecidir key={chave} comerciante={comerciante} consulta={consulta} />
      );
    case "faturacao":
      return <Faturacao key={chave} comerciante={comerciante} />;
    case "moloni":
      return <RegressoMoloni fragmento={regressoMoloni} />;
    case "configurarFaturacao":
      return (
        <ConfigurarFaturacao
          // Outra ligação, outro ecrã: nada do anterior fica.
          key={consulta}
          comerciante={comerciante}
          ligacao={parametros.get("ligacao")}
        />
      );
    case "oss":
      return (
        <RelatorioOss
          // Outro comerciante, entidade ou período: outro relatório.
          key={consulta}
          comerciante={comerciante}
          consulta={consulta}
        />
      );
    case "envios":
      return <Envios key={chave} comerciante={comerciante} />;
    case "envioNova":
      return <EnvioNova key={chave} comerciante={comerciante} />;
    case "envioConta":
      return <EnvioConta key={chave} comerciante={comerciante} conta={p1} />;
    case "metodos":
      return <MetodosEntrega key={chave} comerciante={comerciante} />;
    case "metodoNovo":
      return (
        <MetodoEntregaFormulario
          key={`novo ${comerciante ?? ""}`}
          comerciante={comerciante}
          metodo={null}
        />
      );
    case "metodo":
      return (
        <MetodoEntregaFormulario
          key={chave}
          comerciante={comerciante}
          metodo={p1}
        />
      );
    case "embalagem":
      return <Embalagem key={chave} comerciante={comerciante} />;
    case "expedir":
      return <Expedir key={chave} comerciante={comerciante} />;
    case "expedirEncomenda":
      return (
        <ExpedirEncomenda
          key={chave}
          comerciante={comerciante}
          encomenda={p1}
        />
      );
    case "devolucoes":
      return (
        <Devolucoes key={chave} comerciante={comerciante} consulta={consulta} />
      );
    case "devolucao":
      return (
        <DevolucaoPagina key={chave} comerciante={comerciante} devolucao={p1} />
      );
    case "diferencas":
      return (
        <DiferencasPagamento
          // Outro comerciante ou outro separador: outra lista.
          key={consulta}
          comerciante={comerciante}
          consulta={consulta}
        />
      );
    case "chaves":
      // Outro comerciante, outro ecrã (revisão do #183, P3-9).
      return <Chaves key={chave} comerciante={comerciante} />;
    case "conta":
      return <Conta recuperada={parametros.get("recuperada") === "1"} />;
    default: {
      const nenhuma: never = pagina.nome;
      return nenhuma;
    }
  }
}
