import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ErroHub,
  type FichaArtigo,
  type PrecosNaLista,
  type PrecoVariante,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import {
  camposDoPreco,
  camposSobreOGuardado,
  casasDaMoeda,
  conferirPreco,
  corpoDoPreco,
  ORDEM_DOS_CAMPOS_PRECO,
  precoAlterado,
  precoTemOCorpo,
  textoDosCentimos,
  type CampoPreco,
  type CamposPreco,
  type ErrosPreco,
} from "../preco";
import { preencher, TAG_LINGUA, type Lingua } from "../textos";
import { textoDe } from "./Artigo";

// O preço de uma variante numa lista (docs/22 §25.3): definir, mudar ou
// tirar, pelo PUT e pelo DELETE /hub/price-lists/{id}/prices/{variante},
// sobre o preço lido (a versão e o definido_em; null sem preço). As regras
// são da API e da base; o ecrã só evita o pedido que já sabe recusado. O Hub
// não calcula IVA nem o preço por unidade: mostra-os a ficha, depois de
// gravar. Também num artigo do sistema de gestão (Q1, §25.5).

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FORMATO_ARTIGO = new RegExp(`^prd_${UUID}$`);
const FORMATO_LISTA = new RegExp(`^prl_${UUID}$`);
const FORMATO_VARIANTE = new RegExp(`^var_${UUID}$`);

const idDe = (campo: CampoPreco) => `preco-${campo}`;

/** O erro da API que o ecrã sabe pôr ao lado de um campo. */
function erroDoCampo(erro: unknown): ErrosPreco | null {
  if (!(erro instanceof ErroHub)) return null;
  switch (erro.codigo) {
    case "prices.amount_invalid":
      return { montante: "precoMontanteLimite" };
    case "prices.free_only_at_zero":
      return { montante: "precoZeroSoGratuito" };
    case "prices.quantity_invalid":
      return {
        minimo: "precoQuantidadeInvalida",
        multiplo: "precoQuantidadeInvalida",
      };
    default:
      return null;
  }
}

/** «€» para EUR, «zł» para PLN: o símbolo curto da moeda, nesta língua. */
function simboloDaMoeda(moeda: string, lingua: Lingua): string {
  try {
    return (
      new Intl.NumberFormat(TAG_LINGUA[lingua], {
        style: "currency",
        currency: moeda,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? moeda
    );
  } catch {
    return moeda;
  }
}

/** O que a página leu: a ficha, a lista e o preço guardado nela. */
interface Lido {
  ficha: FichaArtigo;
  lista: PrecosNaLista | null;
  preco: PrecoVariante | null;
}

export function PrecoDaVariante({
  comerciante,
  artigo,
  lista,
  variante,
  consulta,
}: {
  comerciante: string | null;
  artigo: string;
  lista: string;
  variante: string;
  /** A consulta da página: o comerciante e os filtros da lista. */
  consulta: string;
}) {
  const { t, lingua, navegar, definirGuarda } = useHub();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    FORMATO_ARTIGO.test(artigo) &&
    FORMATO_LISTA.test(lista) &&
    FORMATO_VARIANTE.test(variante);
  const [lido, setLido] = useState<Lido | null>(null);
  const [podeEscrever, setPodeEscrever] = useState(false);
  const [campos, setCampos] = useState<CamposPreco | null>(null);
  const [erros, setErros] = useState<ErrosPreco>({});
  const [falha, setFalha] = useState<unknown>(null);
  // O aviso de uma recusa que se conhece (conflito, publicada, arquivada).
  const [recusa, setRecusa] = useState<
    "conflito" | "publicada" | "listaArquivada" | "semResposta" | null
  >(null);
  const [aGravar, setAGravar] = useState(false);
  // O trinco do envio: dois Enter antes de o ecrã se actualizar mandavam
  // dois pedidos (revisão do #341, P3-6).
  const aGravarAgora = useRef(false);
  const focarDepois = useRef<string | null>(null);
  // A língua só formata os campos ao abrir: mudá-la não os reescreve.
  const linguaAoAbrir = useRef(lingua);
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
  const v = lido?.ficha.variantes.find((x) => x.id === variante) ?? null;
  const moeda = lido?.lista?.mercado.moeda ?? "EUR";
  const guardado = lido?.preco ?? null;
  const comReducao = guardado !== null && guardado.reducao !== null;

  /** Lê a ficha, a lista e o preço guardado agora. */
  const ler = useCallback(async (): Promise<Lido | null> => {
    if (!valido) return null;
    const [ficha, daLista] = await Promise.all([
      api.artigo(comerciante, artigo),
      api.listaDoArtigo(comerciante, artigo, lista),
    ]);
    return {
      ficha,
      lista: daLista,
      preco: daLista?.precos.find((p) => p.variante === variante) ?? null,
    };
  }, [valido, comerciante, artigo, lista, variante]);

  const carregar = useCallback(async () => {
    if (!valido) return;
    setFalha(null);
    try {
      const [agora, eu] = await Promise.all([ler(), api.eu()]);
      if (!montado.current || agora === null) return;
      setPodeEscrever(
        eu.comerciantes
          .find((c) => c.comerciante === comerciante)
          ?.ambitos.includes("prices:write") === true,
      );
      setLido(agora);
      const moedaLida = agora.lista?.mercado.moeda ?? "EUR";
      setCampos(camposDoPreco(agora.preco, moedaLida, linguaAoAbrir.current));
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, ler, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const comFormulario =
    lido !== null &&
    lido.lista !== null &&
    v !== null &&
    v.estado === "activa" &&
    podeEscrever &&
    campos !== null;
  const alterado =
    comFormulario && precoAlterado(guardado, campos, moeda, comReducao);

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

  /** Volta à ficha com o aviso de que gravou (a guarda sai antes). */
  function abrirFicha(como: "guardado" | "tirado") {
    if (v === null || lido?.lista == null) return;
    definirGuarda(null);
    const q = new URLSearchParams(consulta);
    q.set("preco", como);
    q.set("skuPreco", v.sku);
    q.set("listaPreco", lido.lista.lista.nome);
    navegar(`/artigos/${artigo}?${q.toString()}`, { substituir: true });
  }

  function mudar(campo: keyof CamposPreco, valor: string | boolean) {
    setCampos((c) => (c === null ? c : { ...c, [campo]: valor }));
    const doCampo: CampoPreco = campo === "gratuito" ? "montante" : campo;
    if (erros[doCampo] !== undefined) {
      setErros((es) =>
        Object.fromEntries(Object.entries(es).filter(([c]) => c !== doCampo)),
      );
    }
  }

  function mostrarErros(e: ErrosPreco) {
    setErros(e);
    const primeiro = ORDEM_DOS_CAMPOS_PRECO.find((c) => e[c] !== undefined);
    if (primeiro !== undefined) focarDepois.current = idDe(primeiro);
  }

  /**
   * Relê o que está guardado depois de uma falha. `confere` diz se o que se
   * queria já lá está (a resposta perdida, ou o pedido repetido); senão, o
   * formulário passa a partir do guardado agora e fica o que se escreveu.
   */
  async function reler(
    confere: (agora: PrecoVariante | null) => boolean,
    depois: (agora: Lido) => void,
  ): Promise<"feito" | "relido"> {
    const agora = await ler();
    if (agora === null) return "relido";
    if (confere(agora.preco)) return "feito";
    if (lido !== null && campos !== null) {
      const moedaAgora = agora.lista?.mercado.moeda ?? moeda;
      setCampos(
        camposSobreOGuardado(
          lido.preco,
          agora.preco,
          campos,
          moedaAgora,
          lingua,
        ),
      );
    }
    setLido(agora);
    depois(agora);
    return "relido";
  }

  /** O que fazer depois de uma falha, ao definir ou ao tirar. */
  async function depoisDaFalha(
    erro: unknown,
    feito: (agora: PrecoVariante | null) => boolean,
    como: "guardado" | "tirado",
  ) {
    if (semSessao(erro)) {
      navegar("/entrar", { substituir: true });
      return;
    }
    // Sem resposta da API: a rede, ou um 5xx sem o corpo da API (§25.2).
    const perdida =
      !(erro instanceof ErroHub) ||
      erro.estado === 0 ||
      (erro.estado >= 500 && erro.codigo === undefined);
    const codigo = erro instanceof ErroHub ? erro.codigo : undefined;
    const aviso = (qual: NonNullable<typeof recusa>, foco: string) => () => {
      setRecusa(qual);
      focarDepois.current = foco;
    };
    try {
      // Só a resposta perdida se dá por feita ao reler: um 409 garante que
      // nada se gravou, e mostra sempre o conflito, mesmo que outra pessoa
      // tenha gravado o mesmo (revisão do #341, P3-1).
      if (perdida) {
        const r = await reler(feito, aviso("semResposta", "preco-recusa"));
        if (!aindaAqui()) return;
        if (r === "feito") abrirFicha(como);
        return;
      }
      if (codigo === "prices.version_conflict") {
        await reler(() => false, aviso("conflito", "preco-recusa"));
        return;
      }
      if (
        codigo === "prices.reduction_active" ||
        codigo === "prices.list_archived" ||
        codigo === "prices.not_found"
      ) {
        // O ecrã passa a mostrar o que está guardado agora: a redução, ou
        // a lista e a variante que deixaram de existir, com o aviso e o
        // foco num elemento que existe (revisão do #341, P2-2).
        await reler(
          () => false,
          (agora) => {
            const daVariante = agora.ficha.variantes.find(
              (x) => x.id === variante,
            );
            if (codigo === "prices.list_archived" || agora.lista === null) {
              setRecusa("listaArquivada");
              focarDepois.current = "preco-aviso";
            } else if (daVariante === undefined) {
              focarDepois.current = "preco-aviso";
            } else if (
              agora.preco?.reducao != null &&
              codigo === "prices.reduction_active"
            ) {
              focarDepois.current = "preco-reducao";
            } else {
              // Nada mudou à vista: fica o erro da API.
              setFalha(erro);
              focarDepois.current = "preco-falha";
            }
          },
        );
        return;
      }
      if (codigo === "prices.published_variant") {
        setRecusa("publicada");
        focarDepois.current = "preco-recusa";
        return;
      }
    } catch (e2) {
      if (!aindaAqui()) return;
      if (semSessao(e2)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (perdida) {
        setRecusa("semResposta");
        focarDepois.current = "preco-recusa";
        return;
      }
    }
    const doCampo = erroDoCampo(erro);
    if (doCampo !== null) {
      mostrarErros(doCampo);
      return;
    }
    setFalha(erro);
    focarDepois.current = "preco-falha";
  }

  async function gravar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (!comFormulario || aGravarAgora.current || comerciante === null) return;
    setFalha(null);
    setRecusa(null);
    const e = conferirPreco(campos, moeda, comReducao);
    if (Object.keys(e).length > 0) {
      mostrarErros(e);
      return;
    }
    setErros({});
    // Nada mudou: volta à ficha sem pedir.
    if (!precoAlterado(guardado, campos, moeda, comReducao)) {
      voltar();
      return;
    }
    const corpo = corpoDoPreco(campos, moeda, guardado, comReducao);
    aGravarAgora.current = true;
    setAGravar(true);
    try {
      await api.definirPreco(comerciante, lista, variante, corpo);
      if (!aindaAqui()) return;
      abrirFicha("guardado");
    } catch (erro) {
      if (!aindaAqui()) return;
      await depoisDaFalha(
        erro,
        (agora) => precoTemOCorpo(agora, corpo),
        "guardado",
      );
    } finally {
      aGravarAgora.current = false;
      if (aindaAqui()) setAGravar(false);
    }
  }

  async function tirar() {
    if (
      !comFormulario ||
      aGravarAgora.current ||
      comerciante === null ||
      guardado === null ||
      lido.lista === null
    ) {
      return;
    }
    const dados = {
      sku: v.sku,
      lista: lido.lista.lista.nome,
      mercado: lido.lista.mercado.nome,
    };
    const pergunta =
      lido.lista.lista.tipo === "base"
        ? t.precoConfirmarTirarBase
        : t.precoConfirmarTirar;
    if (!window.confirm(preencher(pergunta, dados))) return;
    setFalha(null);
    setRecusa(null);
    aGravarAgora.current = true;
    setAGravar(true);
    try {
      await api.tirarPreco(comerciante, lista, variante, {
        versao: guardado.versao,
        definido_em: guardado.definido_em,
      });
      if (!aindaAqui()) return;
      abrirFicha("tirado");
    } catch (erro) {
      if (!aindaAqui()) return;
      // Tirado é já não haver preço nesta lista.
      await depoisDaFalha(erro, (agora) => agora === null, "tirado");
    } finally {
      aGravarAgora.current = false;
      if (aindaAqui()) setAGravar(false);
    }
  }

  const naoExiste =
    !valido ||
    (falha instanceof ErroHub && falha.estado === 404 && lido === null) ||
    (lido !== null && v === null);
  const dataDe = (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const dinheiro = (c: number) =>
    new Intl.NumberFormat(TAG_LINGUA[lingua], {
      style: "currency",
      currency: moeda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(c / 100);

  /** Um campo de quantidade (a mínima ou o múltiplo). */
  function campoDeQuantidade(campo: "minimo" | "multiplo", rotulo: string) {
    if (campos === null) return null;
    const id = idDe(campo);
    const erro = erros[campo];
    return (
      <div className="campo">
        <label htmlFor={id}>{rotulo}</label>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          value={campos[campo]}
          aria-invalid={erro !== undefined}
          aria-describedby={erro === undefined ? undefined : `${id}-erro`}
          onChange={(ev) => {
            mudar(campo, ev.target.value);
          }}
        />
        {erro === undefined ? null : (
          <p id={`${id}-erro`} className="erro-campo">
            {t[erro]}
          </p>
        )}
      </div>
    );
  }

  const listaLida = lido?.lista ?? null;
  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoFicha}
          onClick={(e) => {
            e.preventDefault();
            // A gravar, não se sai: o preço podia ficar gravado sem aviso.
            if (aGravar) return;
            voltar();
          }}
        >
          {lido === null ? t.artigoVoltar : lido.ficha.nome}
        </a>
      </p>
      <h1 id="titulo">{t.precoTitulo}</h1>
      {naoExiste ? (
        <div id="preco-aviso" tabIndex={-1}>
          <CaixaDeErro erro={{ texto: t.varianteNaoExiste }} />
        </div>
      ) : lido === null && falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : lido === null || v === null || campos === null ? (
        <ACarregar />
      ) : listaLida === null ? (
        // Arquivada enquanto se editava, o aviso diz isso (revisão do #341,
        // P2-2); aberta assim, que não existe ou não está activa.
        <div id="preco-aviso" tabIndex={-1}>
          <CaixaDeErro
            erro={{
              texto:
                recusa === "listaArquivada"
                  ? t.precoListaArquivada
                  : t.precoListaNaoExiste,
            }}
          />
        </div>
      ) : (
        <>
          <dl className="valores-actuais">
            <dt>{t.precoVariante}</dt>
            <dd>
              <code translate="no">{v.sku}</code>
            </dd>
            <dt>{t.precoLista}</dt>
            <dd>
              {listaLida.lista.nome}
              <span className="secundario">
                {" · "}
                {listaLida.lista.tipo === "b2b"
                  ? t.precosListaB2b
                  : t.precosListaBase}
                {" · "}
                {listaLida.mercado.nome}
                {listaLida.mercado.estado === "activo"
                  ? null
                  : ` (${textoDe(t, `estadoMercado_${listaLida.mercado.estado}`, listaLida.mercado.estado)})`}
                {" · "}
                <span translate="no">{listaLida.mercado.moeda}</span>
                {" · "}
                {listaLida.mercado.preco_inclui_iva
                  ? t.precosComIva
                  : t.precosSemIva}
              </span>
            </dd>
          </dl>
          {!podeEscrever ? (
            <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
          ) : v.estado !== "activa" ? (
            <p className="secundario" role="status">
              {t.precoVarianteArquivada}
            </p>
          ) : (
            <form onSubmit={(e) => void gravar(e)} noValidate>
              {recusa === null ? null : (
                <div
                  className="erro"
                  role="alert"
                  id="preco-recusa"
                  tabIndex={-1}
                >
                  {recusa === "conflito" ? (
                    <>
                      <p>
                        <strong>{t.precoConflito}</strong>
                      </p>
                      <p>{t.artigoConflitoActual}</p>
                      <dl className="valores-actuais">
                        <dt>{t.colunaPreco}</dt>
                        <dd>
                          {guardado === null
                            ? t.precosSemPreco
                            : guardado.gratuito
                              ? t.precosGratuito
                              : dinheiro(guardado.montante)}
                        </dd>
                        <dt>{t.precoMinimo}</dt>
                        <dd>{guardado?.quantidade_minima ?? "—"}</dd>
                        <dt>{t.precoMultiplo}</dt>
                        <dd>{guardado?.multiplo ?? "—"}</dd>
                      </dl>
                    </>
                  ) : (
                    <p>
                      {recusa === "publicada"
                        ? preencher(t.precoPublicada, {
                            mercado: listaLida.mercado.nome,
                          })
                        : recusa === "listaArquivada"
                          ? t.precoListaArquivada
                          : t.precoSemResposta}
                    </p>
                  )}
                </div>
              )}
              {falha === null ? null : (
                <div id="preco-falha" tabIndex={-1}>
                  <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
                </div>
              )}
              <CampoDoMontante
                campos={campos}
                erro={erros.montante}
                comReducao={comReducao}
                guardado={guardado}
                moeda={moeda}
                incluiIva={listaLida.mercado.preco_inclui_iva}
                avisoReducao={
                  guardado?.reducao == null
                    ? null
                    : preencher(t.precoComReducao, {
                        ate:
                          guardado.reducao.fim === null
                            ? ""
                            : preencher(t.precoReducaoAte, {
                                data: dataDe(guardado.reducao.fim),
                              }),
                      })
                }
                mudar={mudar}
              />
              <div className="linha">
                {campoDeQuantidade("minimo", t.precoMinimo)}
                {campoDeQuantidade("multiplo", t.precoMultiplo)}
              </div>
              <div className="accoes-artigo">
                <button type="submit" className="principal" disabled={aGravar}>
                  {aGravar ? t.aCarregar : t.artigoGuardar}
                </button>
                <button type="button" onClick={voltar} disabled={aGravar}>
                  {t.cancelar}
                </button>
                {guardado === null || comReducao ? null : (
                  <button
                    type="button"
                    disabled={aGravar}
                    onClick={() => void tirar()}
                  >
                    {t.precoTirar}
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/**
 * O montante e o «gratuito» (§25.3). Com «gratuito», o preço fica 0 e não
 * se escreve; com uma redução em vigor, os dois só se lêem.
 */
function CampoDoMontante({
  campos,
  erro,
  comReducao,
  guardado,
  moeda,
  incluiIva,
  avisoReducao,
  mudar,
}: {
  campos: CamposPreco;
  erro: ErrosPreco["montante"];
  comReducao: boolean;
  guardado: PrecoVariante | null;
  moeda: string;
  incluiIva: boolean;
  avisoReducao: string | null;
  mudar: (campo: "montante" | "gratuito", valor: string | boolean) => void;
}) {
  const { t, lingua } = useHub();
  const id = idDe("montante");
  const casas = casasDaMoeda(moeda);
  const gratuito = comReducao ? guardado?.gratuito === true : campos.gratuito;
  const valor = comReducao
    ? guardado === null || guardado.gratuito
      ? textoDosCentimos(0, casas, lingua)
      : textoDosCentimos(guardado.montante, casas, lingua)
    : gratuito
      ? textoDosCentimos(0, casas, lingua)
      : campos.montante;
  const descricao = [
    erro === undefined ? undefined : `${id}-erro`,
    avisoReducao === null ? `${id}-ajuda` : "preco-reducao",
  ]
    .filter((x) => x !== undefined)
    .join(" ");
  const rotulo = preencher(
    incluiIva ? t.precoCampoComIva : t.precoCampoSemIva,
    { simbolo: simboloDaMoeda(moeda, lingua) },
  );
  return (
    <>
      {avisoReducao === null ? null : (
        <p className="aviso" id="preco-reducao" role="status" tabIndex={-1}>
          {avisoReducao}
        </p>
      )}
      <div className="campo">
        <label htmlFor={id}>{rotulo}</label>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          maxLength={16}
          value={valor}
          readOnly={comReducao || gratuito}
          aria-invalid={erro !== undefined}
          aria-describedby={descricao}
          onChange={(ev) => {
            mudar("montante", ev.target.value);
          }}
        />
        {avisoReducao === null ? (
          <p id={`${id}-ajuda`} className="secundario">
            {t.precoAjudaMontante}
          </p>
        ) : null}
        {erro === undefined ? null : (
          <p id={`${id}-erro`} className="erro-campo">
            {t[erro]}
          </p>
        )}
      </div>
      <label className="opcao">
        <input
          type="checkbox"
          id="preco-gratuito"
          checked={gratuito}
          disabled={comReducao}
          aria-describedby="preco-gratuito-ajuda"
          onChange={(ev) => {
            mudar("gratuito", ev.target.checked);
          }}
        />
        {t.precosGratuito}
      </label>
      <p id="preco-gratuito-ajuda" className="secundario">
        {t.precoAjudaGratuito}
      </p>
    </>
  );
}
