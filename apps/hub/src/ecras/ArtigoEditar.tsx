import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroHub, type FichaArtigo } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { preencher } from "../textos";

// Editar o nome, a descrição e a marca de um artigo (docs/22 §13.4), pelo
// PATCH /hub/products/{id}, com a `versao` lida. Se outra pessoa alterou
// entretanto, nada se grava: o ecrã diz-o, mostra o que está guardado agora
// e deixa o que se escreveu nos campos (§13.2). Num artigo do sistema de
// gestão, ou sem catalog:write, não há formulário (P5, §13.3); o servidor
// recusa na mesma.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ARTIGO =
  /^prd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAXIMO_NOME = 200;
const MAXIMO_DESCRICAO = 10000;
const MAXIMO_MARCA = 200;

interface Campos {
  nome: string;
  descricao: string;
  marca: string;
}

const camposDe = (f: FichaArtigo): Campos => ({
  nome: f.nome,
  descricao: f.descricao ?? "",
  marca: f.marca ?? "",
});

export function ArtigoEditar({
  comerciante,
  artigo,
  consulta,
}: {
  comerciante: string | null;
  artigo: string;
  /** A consulta da página: o comerciante e os filtros da lista. */
  consulta: string;
}) {
  const { t, lingua, navegar, definirGuarda } = useHub();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ARTIGO.test(artigo);
  const [ficha, setFicha] = useState<FichaArtigo | null>(null);
  const [podeEscrever, setPodeEscrever] = useState(false);
  const [campos, setCampos] = useState<Campos>({
    nome: "",
    descricao: "",
    marca: "",
  });
  const [falha, setFalha] = useState<unknown>(null);
  const [conflito, setConflito] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  // O nome só com espaços: dito ao lado do campo, sem pedir à API (revisão
  // do #217, P3-4).
  const [nomeEmFalta, setNomeEmFalta] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Lido por uma função: depois de um await, a página pode já ter saído.
  const aindaAqui = () => montado.current;

  const destinoFicha = `/artigos/${artigo}?${consulta.replace(/^\?/, "")}`;

  const carregar = useCallback(async () => {
    if (!valido) return;
    setFalha(null);
    try {
      const [dados, eu] = await Promise.all([
        api.artigo(comerciante, artigo),
        api.eu(),
      ]);
      if (!montado.current) return;
      setPodeEscrever(
        eu.comerciantes
          .find((c) => c.comerciante === comerciante)
          ?.ambitos.includes("catalog:write") === true,
      );
      setFicha(dados);
      setCampos(camposDe(dados));
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, artigo, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alterado =
    ficha !== null &&
    (campos.nome !== ficha.nome ||
      campos.descricao !== (ficha.descricao ?? "") ||
      campos.marca !== (ficha.marca ?? ""));

  // Sair com alterações por guardar pergunta antes: fechar o separador ou
  // recarregar (beforeunload), e a navegação do Hub, o «voltar» do navegador
  // e «Sair» (a guarda do contexto; revisão do #217, P2-1).
  useEffect(() => {
    if (!alterado) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", aoSair);
    definirGuarda(() => window.confirm(t.artigoSairSemGuardar));
    return () => {
      window.removeEventListener("beforeunload", aoSair);
      definirGuarda(null);
    };
  }, [alterado, definirGuarda, t]);

  function voltar() {
    // A guarda pergunta; sem entrada nova no histórico (P3-5).
    navegar(destinoFicha, { substituir: true });
  }

  async function guardar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (ficha === null || !valido || aGuardar) return;
    const nome = campos.nome.trim();
    if (nome === "") {
      setNomeEmFalta(true);
      document.getElementById("artigo-nome")?.focus();
      return;
    }
    setNomeEmFalta(false);
    setAGuardar(true);
    setFalha(null);
    const descricao = campos.descricao.trim() === "" ? null : campos.descricao;
    const marca = campos.marca.trim() === "" ? null : campos.marca.trim();
    const guardado = () => {
      // Já gravado: a guarda sai antes de navegar, e a ficha substitui o
      // formulário no histórico (o «voltar» não reabre a versão antiga, P3-5).
      definirGuarda(null);
      const q = new URLSearchParams(consulta);
      q.set("guardado", "1");
      navegar(`/artigos/${artigo}?${q.toString()}`, { substituir: true });
    };
    try {
      await api.alterarArtigo(comerciante, artigo, {
        versao: ficha.versao,
        nome,
        descricao,
        marca,
      });
      if (!montado.current) return;
      guardado();
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (e instanceof ErroHub && e.codigo === "catalog.version_conflict") {
        // O que está guardado agora, por baixo; os campos ficam como estão.
        try {
          const actual = await api.artigo(comerciante, artigo);
          if (!aindaAqui()) return;
          // Uma resposta perdida e o pedido repetido: o que está guardado já
          // é o que se escreveu (revisão do #217, P3-3).
          if (
            actual.nome === nome &&
            actual.descricao === descricao &&
            actual.marca === marca
          ) {
            guardado();
            return;
          }
          setFicha(actual);
          setConflito(true);
        } catch (e2) {
          if (aindaAqui()) setFalha(e2);
        }
        return;
      }
      setFalha(e);
    } finally {
      if (montado.current) setAGuardar(false);
    }
  }

  const naoExiste =
    !valido ||
    (falha instanceof ErroHub && falha.estado === 404 && ficha === null);

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoFicha}
          onClick={(e) => {
            e.preventDefault();
            voltar();
          }}
        >
          {ficha === null ? t.artigoVoltar : ficha.nome}
        </a>
      </p>
      <h1 id="titulo">{t.artigoEditarTitulo}</h1>
      {naoExiste ? (
        <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />
      ) : ficha === null && falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : ficha === null ? (
        <ACarregar />
      ) : !podeEscrever ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : ficha.origem === "externo" ? (
        <p className="secundario">{t.artigoExternoAviso}</p>
      ) : (
        <form onSubmit={(e) => void guardar(e)} noValidate>
          {conflito ? (
            <div className="erro" role="alert">
              <p>
                <strong>{t.artigoConflito}</strong>
              </p>
              <p>{t.artigoConflitoActual}</p>
              <dl className="valores-actuais">
                <dt>{t.colunaNome}</dt>
                <dd>{ficha.nome}</dd>
                <dt>{t.artigoDescricao}</dt>
                <dd className="descricao-artigo">
                  {ficha.descricao ?? t.artigoSemDescricao}
                </dd>
                <dt>{t.colunaMarca}</dt>
                <dd>{ficha.marca ?? "—"}</dd>
              </dl>
            </div>
          ) : null}
          {falha === null ? null : (
            <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
          )}
          <div className="campo">
            <label htmlFor="artigo-nome">{t.colunaNome}</label>
            <input
              id="artigo-nome"
              required
              maxLength={MAXIMO_NOME}
              aria-invalid={nomeEmFalta}
              aria-describedby={nomeEmFalta ? "artigo-nome-erro" : undefined}
              value={campos.nome}
              onChange={(e) => {
                setCampos({ ...campos, nome: e.target.value });
              }}
            />
            {nomeEmFalta ? (
              <p id="artigo-nome-erro" className="erro-campo" role="alert">
                {t.artigoNomeObrigatorio}
              </p>
            ) : null}
          </div>
          <div className="campo">
            <label htmlFor="artigo-descricao">{t.artigoDescricao}</label>
            <textarea
              id="artigo-descricao"
              rows={8}
              maxLength={MAXIMO_DESCRICAO}
              aria-describedby="artigo-descricao-contagem"
              value={campos.descricao}
              onChange={(e) => {
                setCampos({ ...campos, descricao: e.target.value });
              }}
            />
            <p id="artigo-descricao-contagem" className="secundario">
              {preencher(t.artigoCaracteres, {
                n: campos.descricao.length,
                max: MAXIMO_DESCRICAO,
              })}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="artigo-marca">{t.colunaMarca}</label>
            <input
              id="artigo-marca"
              maxLength={MAXIMO_MARCA}
              value={campos.marca}
              onChange={(e) => {
                setCampos({ ...campos, marca: e.target.value });
              }}
            />
          </div>
          <div className="accoes-artigo">
            <button type="submit" disabled={aGuardar}>
              {aGuardar ? t.aCarregar : t.artigoGuardar}
            </button>
            <button type="button" onClick={voltar}>
              {t.cancelar}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
