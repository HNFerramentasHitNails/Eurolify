import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ErroHub,
  ORIGENS_GTIN,
  UNIDADES_DE_CONTEUDO,
  UNIDADES_DE_VENDA,
  type FichaArtigo,
  type VarianteArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { TAG_LINGUA, type Textos } from "../textos";
import {
  alteracaoDaVariante,
  camposDaVariante,
  conferirVariante,
  MAXIMO_CLASSE_ADR,
  ORDEM_DOS_CAMPOS,
  varianteAlterada,
  type CampoVariante,
  type CamposVariante,
} from "../variante";

// Editar uma variante (docs/22 §23), pelo PATCH /hub/variants/{id}, com a
// `versao` da variante lida. O SKU vê-se e não muda. A unidade e o
// conteúdo só se editam num rascunho; depois, só se lêem (a API e a base
// recusam na mesma, 0048). Se outra pessoa alterou entretanto, nada se
// grava: o ecrã diz-o, mostra o que está guardado agora e deixa o que se
// escreveu (§23.1). Num artigo do sistema de gestão, sem catalog:write, ou
// numa variante arquivada, não há formulário.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FORMATO_ARTIGO = new RegExp(`^prd_${UUID}$`);
const FORMATO_VARIANTE = new RegExp(`^var_${UUID}$`);

type Erros = Partial<Record<CampoVariante, keyof Textos>>;

const idDe = (campo: CampoVariante) => `variante-${campo}`;

/** m² e m³ como se escrevem; os outros, como a API os diz. */
const simbolo = (u: string) => (u === "m2" ? "m²" : u === "m3" ? "m³" : u);

/** O erro da API que o ecrã sabe pôr ao lado de um campo. */
function erroDoCampo(erro: unknown): Erros | null {
  if (!(erro instanceof ErroHub)) return null;
  switch (erro.codigo) {
    case "catalog.gtin_invalid":
      return { gtin: "artigoNovoGtinInvalido" };
    case "catalog.gtin_duplicate":
      return { gtin: "artigoNovoGtinRepetido" };
    case "catalog.published_in_use":
      return { peso: "variantePesoAVenda" };
    case "catalog.content_incomplete":
      return { quantidade: "artigoNovoConteudoIncompleto" };
    default:
      return null;
  }
}

export function VarianteEditar({
  comerciante,
  artigo,
  variante,
  consulta,
}: {
  comerciante: string | null;
  artigo: string;
  variante: string;
  /** A consulta da página: o comerciante e os filtros da lista. */
  consulta: string;
}) {
  const { t, lingua, navegar, definirGuarda } = useHub();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ARTIGO.test(artigo) &&
    FORMATO_VARIANTE.test(variante);
  const [ficha, setFicha] = useState<FichaArtigo | null>(null);
  const [podeEscrever, setPodeEscrever] = useState(false);
  const [campos, setCampos] = useState<CamposVariante | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [falha, setFalha] = useState<unknown>(null);
  const [conflito, setConflito] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const focarDepois = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  // Lido por uma função: depois de um await, a página pode já ter saído.
  const aindaAqui = () => montado.current;

  useEffect(() => {
    const id = focarDepois.current;
    if (id === null) return;
    focarDepois.current = null;
    document.getElementById(id)?.focus();
  });

  const destinoFicha = `/artigos/${artigo}?${consulta.replace(/^\?/, "")}`;
  const v: VarianteArtigo | null =
    ficha?.variantes.find((x) => x.id === variante) ?? null;
  const rascunho = ficha?.estado === "rascunho";

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
      const lida = dados.variantes.find((x) => x.id === variante);
      setCampos(lida === undefined ? null : camposDaVariante(lida));
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, artigo, variante, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alterado =
    v !== null && campos !== null && varianteAlterada(v, campos, rascunho);

  // Sair com alterações por guardar pergunta antes (como na §13.4).
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
    navegar(destinoFicha, { substituir: true });
  }

  function mudar(campo: CampoVariante, valor: string) {
    setCampos((c) => (c === null ? c : { ...c, [campo]: valor }));
    // Um campo corrigido deixa de mostrar o erro antigo; o GTIN e a origem,
    // e a quantidade e a unidade do conteúdo, andam juntos.
    const juntos: CampoVariante[] =
      campo === "gtin" || campo === "gtinOrigem"
        ? ["gtin", "gtinOrigem"]
        : campo === "quantidade" || campo === "unidadeConteudo"
          ? ["quantidade", "unidadeConteudo"]
          : [campo];
    if (juntos.some((c) => erros[c] !== undefined)) {
      setErros((es) =>
        Object.fromEntries(
          Object.entries(es).filter(([c]) => !juntos.includes(c as never)),
        ),
      );
    }
  }

  function mostrarErros(e: Erros) {
    setErros(e);
    const primeiro = ORDEM_DOS_CAMPOS.find((c) => e[c] !== undefined);
    if (primeiro !== undefined) focarDepois.current = idDe(primeiro);
  }

  async function guardar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (v === null || campos === null || !valido || aGuardar) return;
    setFalha(null);
    const e = conferirVariante(campos);
    if (Object.keys(e).length > 0) {
      mostrarErros(e);
      return;
    }
    setErros({});
    const corpo = alteracaoDaVariante(v, campos, rascunho);
    const guardado = () => {
      // Já gravado: a guarda sai antes de navegar, e a ficha substitui o
      // formulário no histórico (o «voltar» não reabre a versão antiga).
      definirGuarda(null);
      const q = new URLSearchParams(consulta);
      q.set("guardado", "1");
      navegar(`/artigos/${artigo}?${q.toString()}`, { substituir: true });
    };
    // Nada mudou: volta à ficha sem pedir.
    if (Object.keys(corpo).length === 1) {
      voltar();
      return;
    }
    setAGuardar(true);
    try {
      await api.alterarVariante(comerciante, variante, corpo);
      if (!aindaAqui()) return;
      guardado();
    } catch (erro) {
      if (!aindaAqui()) return;
      if (semSessao(erro)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (
        erro instanceof ErroHub &&
        (erro.codigo === "catalog.version_conflict" ||
          erro.codigo === "catalog.variant_archived_is_final" ||
          erro.codigo === "catalog.not_draft")
      ) {
        // O que está guardado agora; os campos ficam como estão.
        try {
          const actual = await api.artigo(comerciante, artigo);
          if (!aindaAqui()) return;
          const lida = actual.variantes.find((x) => x.id === variante);
          // Uma resposta perdida e o pedido repetido: o que está guardado já
          // é o que se escreveu (como na §13.2).
          if (
            erro.codigo === "catalog.version_conflict" &&
            lida !== undefined &&
            !varianteAlterada(lida, campos, actual.estado === "rascunho")
          ) {
            guardado();
            return;
          }
          setFicha(actual);
          if (erro.codigo === "catalog.version_conflict") {
            setConflito(true);
            focarDepois.current = "variante-conflito";
          } else if (erro.codigo === "catalog.not_draft") {
            // O artigo foi activado entretanto: a unidade e o conteúdo
            // voltam ao guardado, que é o que se pode mostrar.
            if (lida !== undefined) {
              const guardados = camposDaVariante(lida);
              setCampos({
                ...campos,
                unidade: guardados.unidade,
                quantidade: guardados.quantidade,
                unidadeConteudo: guardados.unidadeConteudo,
              });
            }
            setFalha(erro);
          }
        } catch (e2) {
          if (aindaAqui()) setFalha(e2);
        }
        return;
      }
      const doCampo = erroDoCampo(erro);
      if (doCampo !== null) {
        mostrarErros(doCampo);
        return;
      }
      setFalha(erro);
    } finally {
      if (aindaAqui()) setAGuardar(false);
    }
  }

  /** O erro de um campo: o texto ao lado e o que o liga ao campo. */
  function erroDe(campo: CampoVariante) {
    const texto = erros[campo];
    const id = idDe(campo);
    return {
      props: {
        "aria-invalid": texto !== undefined,
        "aria-describedby": texto !== undefined ? `${id}-erro` : undefined,
      },
      mensagem:
        texto === undefined ? null : (
          <p id={`${id}-erro`} className="erro-campo">
            {t[texto]}
          </p>
        ),
    };
  }

  function campoDeTexto(
    campo: CampoVariante,
    rotulo: string,
    extra: {
      inputMode?: "numeric" | "text";
      maxLength?: number;
      ajuda?: string;
    } = {},
  ) {
    if (campos === null) return null;
    const id = idDe(campo);
    const e = erroDe(campo);
    const ajuda = extra.ajuda === undefined ? undefined : `${id}-ajuda`;
    return (
      <div className="campo">
        <label htmlFor={id}>{rotulo}</label>
        <input
          id={id}
          inputMode={extra.inputMode ?? "numeric"}
          maxLength={extra.maxLength}
          autoComplete="off"
          value={campos[campo]}
          {...e.props}
          aria-describedby={
            [e.props["aria-describedby"], ajuda]
              .filter((x) => x !== undefined)
              .join(" ") || undefined
          }
          onChange={(ev) => {
            mudar(campo, ev.target.value);
          }}
        />
        {extra.ajuda === undefined ? null : (
          <p id={ajuda} className="secundario">
            {extra.ajuda}
          </p>
        )}
        {e.mensagem}
      </div>
    );
  }

  const numero = (n: number) =>
    new Intl.NumberFormat(TAG_LINGUA[lingua]).format(n);
  const conteudoDe = (x: VarianteArtigo) =>
    x.conteudo_quantidade === null
      ? "—"
      : `${numero(x.conteudo_quantidade)}\u00a0${simbolo(x.conteudo_unidade ?? "")}`.trim();
  const medidaDe = (n: number | null, u: string) =>
    n === null ? "—" : `${numero(n)}\u00a0${u}`;

  const naoExiste =
    !valido ||
    (falha instanceof ErroHub && falha.estado === 404 && ficha === null) ||
    (ficha !== null && v === null);

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
      <h1 id="titulo">{t.varianteEditarTitulo}</h1>
      {naoExiste ? (
        <CaixaDeErro erro={{ texto: t.varianteNaoExiste }} />
      ) : ficha === null && falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : ficha === null || v === null || campos === null ? (
        <ACarregar />
      ) : (
        <>
          <p>
            <strong>{t.artigosSku}:</strong> <code translate="no">{v.sku}</code>
          </p>
          {!podeEscrever ? (
            <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
          ) : ficha.origem === "externo" ? (
            <p className="secundario">{t.artigoExternoAviso}</p>
          ) : v.estado === "arquivada" ? (
            <p className="secundario" role="status">
              {t.varianteArquivada}
            </p>
          ) : (
            <form onSubmit={(e) => void guardar(e)} noValidate>
              {conflito ? (
                <div
                  className="erro"
                  role="alert"
                  id="variante-conflito"
                  tabIndex={-1}
                >
                  <p>
                    <strong>{t.varianteConflito}</strong>
                  </p>
                  <p>{t.artigoConflitoActual}</p>
                  <dl className="valores-actuais">
                    <dt>{t.colunaUnidade}</dt>
                    <dd>{t[`unidade_${v.unidade_de_venda}`]}</dd>
                    <dt>{t.colunaConteudo}</dt>
                    <dd>{conteudoDe(v)}</dd>
                    <dt>{t.colunaGtin}</dt>
                    <dd>
                      {v.gtin === null ? (
                        "—"
                      ) : (
                        <code translate="no">{v.gtin}</code>
                      )}
                    </dd>
                    <dt>{t.colunaPeso}</dt>
                    <dd>{medidaDe(v.peso_g, "g")}</dd>
                    <dt>{t.artigoNovoComprimento}</dt>
                    <dd>{medidaDe(v.comprimento_mm, "mm")}</dd>
                    <dt>{t.artigoNovoLargura}</dt>
                    <dd>{medidaDe(v.largura_mm, "mm")}</dd>
                    <dt>{t.artigoNovoAltura}</dt>
                    <dd>{medidaDe(v.altura_mm, "mm")}</dd>
                    <dt>{t.varianteOnu}</dt>
                    <dd>{v.onu ?? "—"}</dd>
                    <dt>{t.varianteClasseAdr}</dt>
                    <dd>{v.classe_adr ?? "—"}</dd>
                  </dl>
                </div>
              ) : null}
              {falha === null ? null : (
                <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
              )}
              <fieldset className="variante-nova">
                <legend>{t.varianteGrupoUnidade}</legend>
                {rascunho ? (
                  <>
                    <div className="linha">
                      <div className="campo">
                        <label htmlFor={idDe("unidade")}>
                          {t.colunaUnidade}
                        </label>
                        <select
                          id={idDe("unidade")}
                          value={campos.unidade}
                          onChange={(e) => {
                            mudar("unidade", e.target.value);
                          }}
                        >
                          {UNIDADES_DE_VENDA.map((u) => (
                            <option key={u} value={u}>
                              {t[`unidade_${u}`]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="linha">
                      {campoDeTexto("quantidade", t.artigoNovoQuantidade)}
                      <div className="campo">
                        <label htmlFor={idDe("unidadeConteudo")}>
                          {t.artigoNovoUnidadeConteudo}
                        </label>
                        <select
                          id={idDe("unidadeConteudo")}
                          value={campos.unidadeConteudo}
                          {...erroDe("unidadeConteudo").props}
                          onChange={(e) => {
                            mudar("unidadeConteudo", e.target.value);
                          }}
                        >
                          <option value="">{t.artigoNovoSemUnidade}</option>
                          {UNIDADES_DE_CONTEUDO.map((u) => (
                            <option key={u} value={u}>
                              {simbolo(u)}
                            </option>
                          ))}
                        </select>
                        {erroDe("unidadeConteudo").mensagem}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <dl className="valores-actuais">
                      <dt>{t.colunaUnidade}</dt>
                      <dd>{t[`unidade_${v.unidade_de_venda}`]}</dd>
                      <dt>{t.colunaConteudo}</dt>
                      <dd>{conteudoDe(v)}</dd>
                    </dl>
                    <p className="secundario">{t.varianteUnidadeSoRascunho}</p>
                  </>
                )}
              </fieldset>
              <fieldset className="variante-nova">
                <legend>{t.varianteGrupoGtin}</legend>
                <div className="linha">
                  {campoDeTexto("gtin", t.colunaGtin)}
                  {campos.gtin.trim() === "" ? null : (
                    <div className="campo">
                      <label htmlFor={idDe("gtinOrigem")}>
                        {t.artigoNovoGtinOrigem}
                      </label>
                      <select
                        id={idDe("gtinOrigem")}
                        value={campos.gtinOrigem}
                        {...erroDe("gtinOrigem").props}
                        onChange={(e) => {
                          mudar("gtinOrigem", e.target.value);
                        }}
                      >
                        <option value="">{t.artigoNovoEscolher}</option>
                        {ORIGENS_GTIN.map((o) => (
                          <option key={o} value={o}>
                            {t[`gtinOrigem_${o}`]}
                          </option>
                        ))}
                      </select>
                      {erroDe("gtinOrigem").mensagem}
                    </div>
                  )}
                </div>
              </fieldset>
              <fieldset className="variante-nova">
                <legend>{t.varianteGrupoMedidas}</legend>
                <div className="linha">
                  {campoDeTexto("peso", t.artigoNovoPeso)}
                  {campoDeTexto("comprimento", t.artigoNovoComprimento)}
                  {campoDeTexto("largura", t.artigoNovoLargura)}
                  {campoDeTexto("altura", t.artigoNovoAltura)}
                </div>
                {campos.peso.trim() === "" ? (
                  <p className="secundario">{t.artigoNovoSemPeso}</p>
                ) : null}
              </fieldset>
              <fieldset className="variante-nova">
                <legend>{t.varianteGrupoPerigosas}</legend>
                <div className="linha">
                  {campoDeTexto("onu", t.varianteOnu, {
                    inputMode: "text",
                    maxLength: 6,
                    ajuda: t.varianteOnuAjuda,
                  })}
                  {campoDeTexto("classeAdr", t.varianteClasseAdr, {
                    inputMode: "text",
                    maxLength: MAXIMO_CLASSE_ADR,
                  })}
                </div>
              </fieldset>
              <div className="accoes-artigo">
                <button type="submit" className="principal" disabled={aGuardar}>
                  {aGuardar ? t.aCarregar : t.artigoGuardar}
                </button>
                <button type="button" onClick={voltar} disabled={aGuardar}>
                  {t.cancelar}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
