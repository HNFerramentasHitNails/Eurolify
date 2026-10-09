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
  const { t, lingua, navegar } = useHub();
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

  // Fechar o separador ou recarregar com alterações por guardar pergunta antes.
  useEffect(() => {
    if (!alterado) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", aoSair);
    return () => {
      window.removeEventListener("beforeunload", aoSair);
    };
  }, [alterado]);

  function voltar() {
    if (alterado && !window.confirm(t.artigoSairSemGuardar)) return;
    navegar(destinoFicha);
  }

  async function guardar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (ficha === null || !valido || aGuardar) return;
    setAGuardar(true);
    setFalha(null);
    try {
      const descricao = campos.descricao.trim();
      const marca = campos.marca.trim();
      await api.alterarArtigo(comerciante, artigo, {
        versao: ficha.versao,
        nome: campos.nome.trim(),
        descricao: descricao === "" ? null : campos.descricao,
        marca: marca === "" ? null : marca,
      });
      if (!montado.current) return;
      const q = new URLSearchParams(consulta);
      q.set("guardado", "1");
      navegar(`/artigos/${artigo}?${q.toString()}`);
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
          if (aindaAqui()) {
            setFicha(actual);
            setConflito(true);
          }
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
        <form onSubmit={(e) => void guardar(e)} noValidate={false}>
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
              value={campos.nome}
              onChange={(e) => {
                setCampos({ ...campos, nome: e.target.value });
              }}
            />
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
