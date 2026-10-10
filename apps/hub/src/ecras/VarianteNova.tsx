import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroHub, type FichaArtigo } from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { CamposDaVariante, idDoCampo } from "./CamposDaVariante";
import { mensagemDeErro, semSessao } from "../erros";
import type { OpcaoArtigo } from "../opcoes";
import type { Textos } from "../textos";
import {
  CAMPOS_DE_VARIANTE_NOVA,
  conferirVariante,
  corpoDaVarianteNova,
  MAXIMO_SKU,
  varianteIgualAoCorpo,
  ORDEM_DOS_CAMPOS,
  varianteNovaEscrita,
  type CampoVariante,
  type CamposVariante,
  type VarianteACriar,
} from "../variante";

// Acrescentar uma variante a um artigo existente (docs/22 §24), pelo
// POST /hub/products/{id}/variants. As regras são da API (SKU único, um
// valor de cada opção num artigo que já não é rascunho, combinação nova);
// o ecrã só confere o que é do formulário e põe a resposta da API ao lado
// do campo. Sem Idempotency-Key: se a resposta se perde, o ecrã procura no
// artigo uma variante nova com o que se escreveu e, se lá estiver, dá-a por
// criada (§24.1; revisão do #331, P1-1).

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ARTIGO =
  /^prd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Erros = Partial<Record<CampoVariante | "sku", keyof Textos>>;
/** O erro de cada lista de opção, pelo id da opção. */
type ErrosDasOpcoes = Record<string, keyof Textos>;

const ID_SKU = "variante-sku";
const idDaOpcao = (o: string) => `variante-opcao-${o}`;

export function VarianteNova({
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
  const [opcoes, setOpcoes] = useState<OpcaoArtigo[]>([]);
  const [podeEscrever, setPodeEscrever] = useState(false);
  const [sku, setSku] = useState("");
  const [campos, setCampos] = useState<CamposVariante>(CAMPOS_DE_VARIANTE_NOVA);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Erros>({});
  const [errosOpcoes, setErrosOpcoes] = useState<ErrosDasOpcoes>({});
  const [falha, setFalha] = useState<unknown>(null);
  const [semResposta, setSemResposta] = useState(false);
  const [aCriar, setACriar] = useState(false);
  // Houve uma tentativa sem resposta: um 409 do SKU a seguir pode ser a
  // própria variante, já gravada (como a §14.2).
  const semRespostaAntes = useRef(false);
  // As variantes que o artigo tinha ao abrir: a que se procura depois de uma
  // resposta perdida não pode ser uma delas (revisão do #331, P1-1).
  const lidasAoAbrir = useRef<ReadonlySet<string>>(new Set());
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
  const rascunho = ficha?.estado === "rascunho";
  const valores = opcoes.map((o) => escolhas[o.id] ?? "");

  const carregar = useCallback(async () => {
    if (!valido) return;
    setFalha(null);
    try {
      const [dados, eu, dasOpcoes] = await Promise.all([
        api.artigo(comerciante, artigo),
        api.eu(),
        api.opcoesDoArtigo(comerciante, artigo),
      ]);
      if (!montado.current) return;
      setPodeEscrever(
        eu.comerciantes
          .find((c) => c.comerciante === comerciante)
          ?.ambitos.includes("catalog:write") === true,
      );
      lidasAoAbrir.current = new Set(dados.variantes.map((v) => v.id));
      setFicha(dados);
      setOpcoes(dasOpcoes);
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

  /** As opções outra vez, depois de a API recusar por uma que o ecrã não tem. */
  async function recarregarOpcoes() {
    if (comerciante === null) return;
    try {
      const dasOpcoes = await api.opcoesDoArtigo(comerciante, artigo);
      if (aindaAqui()) setOpcoes(dasOpcoes);
    } catch {
      // Fica a caixa do erro; tentar outra vez volta a pedir.
    }
  }

  const comFormulario =
    ficha !== null && podeEscrever && ficha.origem !== "externo";
  const escrito = comFormulario && varianteNovaEscrita(sku, campos, valores);

  // Sair com o formulário escrito pergunta antes (como na §14.4).
  useEffect(() => {
    if (!escrito) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", aoSair);
    definirGuarda(() => window.confirm(t.artigoSairSemGuardar));
    return () => {
      window.removeEventListener("beforeunload", aoSair);
      definirGuarda(null);
    };
  }, [escrito, definirGuarda, t]);

  function voltar() {
    navegar(destinoFicha, { substituir: true });
  }

  function limpar(...chaves: (CampoVariante | "sku")[]) {
    if (!chaves.some((c) => erros[c] !== undefined)) return;
    setErros((es) =>
      Object.fromEntries(
        Object.entries(es).filter(([c]) => !chaves.includes(c as never)),
      ),
    );
  }

  function mudar(campo: CampoVariante, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }));
    limpar(
      ...(campo === "gtin" || campo === "gtinOrigem"
        ? (["gtin", "gtinOrigem"] as const)
        : campo === "quantidade" || campo === "unidadeConteudo"
          ? (["quantidade", "unidadeConteudo"] as const)
          : [campo]),
    );
  }

  function escolher(opcao: string, valor: string) {
    setEscolhas((e) => ({ ...e, [opcao]: valor }));
    if (Object.keys(errosOpcoes).length > 0) setErrosOpcoes({});
  }

  /** O foco vai para o primeiro campo com erro, pela ordem do ecrã. */
  function mostrarErros(e: Erros, eo: ErrosDasOpcoes) {
    setErros(e);
    setErrosOpcoes(eo);
    if (e.sku !== undefined) {
      focarDepois.current = ID_SKU;
      return;
    }
    const opcao = opcoes.find((o) => eo[o.id] !== undefined);
    if (opcao !== undefined) {
      focarDepois.current = idDaOpcao(opcao.id);
      return;
    }
    const primeiro = ORDEM_DOS_CAMPOS.find((c) => e[c] !== undefined);
    if (primeiro !== undefined) focarDepois.current = idDoCampo(primeiro);
  }

  function conferir(): [Erros, ErrosDasOpcoes] {
    const e: Erros = { ...conferirVariante(campos) };
    if (sku.trim() === "") e.sku = "artigoNovoSkuObrigatorio";
    const eo: ErrosDasOpcoes = {};
    // Num artigo que já não é rascunho, cada opção leva um valor (§3.3); a
    // API recusa na mesma.
    if (!rascunho) {
      for (const o of opcoes) {
        if ((escolhas[o.id] ?? "") === "")
          eo[o.id] = "varianteNovaValorObrigatorio";
      }
    }
    return [e, eo];
  }

  /** A ficha do artigo, com o aviso de que a variante ficou criada. */
  async function abrirFicha(skuCriado: string) {
    definirGuarda(null);
    const q = new URLSearchParams(consulta);
    // Num artigo à venda, a variante nova fica fora das lojas (§24.1). Sem
    // as publicações, um rascunho não está à venda; outro artigo pode
    // estar, e o aviso diz que não se soube (revisão do #331, P3-1).
    let estado: "fora" | "criada" | "talvez" = "criada";
    if (!rascunho) {
      try {
        const pubs = await api.publicacoesDoArtigo(comerciante ?? "", artigo);
        if (pubs.dados.some((p) => p.estado === "publicado")) estado = "fora";
      } catch {
        estado = "talvez";
      }
    }
    if (!aindaAqui()) return;
    q.set("variante", estado);
    q.set("skuCriado", skuCriado);
    navegar(`/artigos/${artigo}?${q.toString()}`, { substituir: true });
  }

  /**
   * Depois de uma resposta perdida: «criada» se o artigo tem uma variante
   * nova (não estava lá ao abrir) com tudo o que se enviou, os valores das
   * opções incluídos; «outra» se tem uma nova com o mesmo SKU mas outros
   * campos (a tentativa anterior gravou e a pessoa mudou entretanto); senão
   * «nao» (revisão do #331, P1-1).
   */
  async function procurarACriada(
    corpo: VarianteACriar,
  ): Promise<"criada" | "outra" | "nao"> {
    if (comerciante === null) return "nao";
    const [actual, dasOpcoes] = await Promise.all([
      api.artigo(comerciante, artigo),
      api.opcoesDoArtigo(comerciante, artigo),
    ]);
    const novas = actual.variantes.filter(
      (v) => !lidasAoAbrir.current.has(v.id) && v.sku === corpo.sku,
    );
    const valoresDe = (id: string) =>
      dasOpcoes.flatMap((o) =>
        o.valores.filter((x) => x.variantes.includes(id)).map((x) => x.id),
      );
    if (novas.some((v) => varianteIgualAoCorpo(v, corpo, valoresDe(v.id))))
      return "criada";
    return novas.length > 0 ? "outra" : "nao";
  }

  async function criar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (!valido || !comFormulario || aCriar) return;
    setFalha(null);
    setSemResposta(false);
    const [e, eo] = conferir();
    if (Object.keys(e).length > 0 || Object.keys(eo).length > 0) {
      mostrarErros(e, eo);
      return;
    }
    setErros({});
    setErrosOpcoes({});
    setACriar(true);
    const corpo = corpoDaVarianteNova(sku, campos, valores);
    try {
      await api.criarVariante(comerciante, artigo, corpo);
      if (!aindaAqui()) return;
      await abrirFicha(corpo.sku);
    } catch (erro) {
      if (!aindaAqui()) return;
      if (semSessao(erro)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      await depoisDaFalha(erro, corpo);
    } finally {
      if (aindaAqui()) setACriar(false);
    }
  }

  async function depoisDaFalha(erro: unknown, corpo: VarianteACriar) {
    // Sem resposta da API: a rede, ou um 5xx sem o corpo da API.
    const perdida =
      !(erro instanceof ErroHub) ||
      erro.estado === 0 ||
      (erro.estado >= 500 && erro.codigo === undefined);
    const codigo = erro instanceof ErroHub ? erro.codigo : undefined;
    try {
      if (
        perdida ||
        (semRespostaAntes.current && codigo === "catalog.sku_duplicate")
      ) {
        const achada = await procurarACriada(corpo);
        if (!aindaAqui()) return;
        if (achada === "criada") {
          await abrirFicha(corpo.sku);
          return;
        }
        if (achada === "outra") {
          mostrarErros({ sku: "varianteNovaOutraGravada" }, {});
          return;
        }
        if (perdida) {
          semRespostaAntes.current = true;
          setSemResposta(true);
          focarDepois.current = "variante-nova-sem-resposta";
          return;
        }
      }
    } catch (e2) {
      if (!aindaAqui()) return;
      if (semSessao(e2)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      // A procura falhou: fica o erro do pedido.
      if (perdida) {
        semRespostaAntes.current = true;
        setSemResposta(true);
        focarDepois.current = "variante-nova-sem-resposta";
        return;
      }
    }
    const primeira = opcoes[0]?.id;
    switch (codigo) {
      case "catalog.sku_duplicate":
        mostrarErros({ sku: "artigoNovoSkuExiste" }, {});
        return;
      case "catalog.sku_invalid":
        mostrarErros({ sku: "varianteSkuFormato" }, {});
        return;
      case "catalog.gtin_origin_required":
        mostrarErros({ gtinOrigem: "artigoNovoGtinOrigemFalta" }, {});
        return;
      case "catalog.gtin_invalid":
        mostrarErros({ gtin: "artigoNovoGtinInvalido" }, {});
        return;
      case "catalog.gtin_duplicate":
        mostrarErros({ gtin: "varianteGtinRepetido" }, {});
        return;
      case "catalog.content_incomplete":
        mostrarErros({ quantidade: "artigoNovoConteudoIncompleto" }, {});
        return;
      case "catalog.option_combination_duplicate":
        if (primeira !== undefined) {
          mostrarErros(
            {},
            Object.fromEntries(
              opcoes.map((o) => [o.id, "varianteNovaCombinacaoRepetida"]),
            ),
          );
          return;
        }
        break;
      case "catalog.options_incomplete": {
        const porEscolher = opcoes.filter((o) => (escolhas[o.id] ?? "") === "");
        if (porEscolher.length > 0) {
          mostrarErros(
            {},
            Object.fromEntries(
              porEscolher.map((o) => [o.id, "varianteNovaValorObrigatorio"]),
            ),
          );
          return;
        }
        // Falta uma opção que o ecrã não conhece (acrescentada depois de
        // abrir): fica a caixa do erro e as opções voltam a ler-se
        // (revisão do #331, P2-2).
        void recarregarOpcoes();
        break;
      }
      default:
        break;
    }
    setFalha(erro);
    focarDepois.current = "variante-nova-falha";
  }

  const naoExiste =
    !valido ||
    (falha instanceof ErroHub && falha.estado === 404 && ficha === null);
  const erroSku = erros.sku;

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoFicha}
          aria-disabled={aCriar || undefined}
          onClick={(e) => {
            e.preventDefault();
            // Enquanto cria, não se sai: a variante podia ficar criada sem
            // aviso, como no «Cancelar» (revisão do #331, P3-2).
            if (aCriar) return;
            voltar();
          }}
        >
          {ficha === null ? t.artigoVoltar : ficha.nome}
        </a>
      </p>
      <h1 id="titulo">{t.varianteNovaTitulo}</h1>
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
        <form onSubmit={(e) => void criar(e)} noValidate>
          {semResposta ? (
            <div
              className="aviso"
              role="alert"
              id="variante-nova-sem-resposta"
              tabIndex={-1}
            >
              <p>
                <strong>{t.varianteNovaNaoCriada}</strong>
              </p>
            </div>
          ) : null}
          {falha === null ? null : (
            <div id="variante-nova-falha" tabIndex={-1}>
              <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
            </div>
          )}
          <div className="campo">
            <label htmlFor={ID_SKU}>{t.artigosSku}</label>
            <input
              id={ID_SKU}
              required
              maxLength={MAXIMO_SKU}
              autoComplete="off"
              value={sku}
              aria-invalid={erroSku !== undefined}
              aria-describedby={
                erroSku !== undefined ? `${ID_SKU}-erro` : undefined
              }
              onChange={(e) => {
                setSku(e.target.value);
                limpar("sku");
              }}
            />
            {erroSku === undefined ? null : (
              <p id={`${ID_SKU}-erro`} className="erro-campo">
                {t[erroSku]}
              </p>
            )}
          </div>
          {opcoes.length === 0 ? null : (
            <fieldset className="variante-nova">
              <legend>{t.varianteNovaOpcoes}</legend>
              {/* Fora do rascunho, cada opção leva um valor; num rascunho,
                  podem ficar por escolher (revisão do #331, P3-3). */}
              <p className="secundario" id="variante-nova-opcoes-ajuda">
                {rascunho
                  ? t.varianteNovaOpcoesRascunho
                  : t.varianteNovaOpcoesObrigatorias}
              </p>
              <div className="linha">
                {opcoes.map((o) => {
                  const id = idDaOpcao(o.id);
                  const erro = errosOpcoes[o.id];
                  return (
                    <div className="campo" key={o.id}>
                      <label htmlFor={id}>{o.nome}</label>
                      <select
                        id={id}
                        value={escolhas[o.id] ?? ""}
                        required={!rascunho}
                        aria-invalid={erro !== undefined}
                        aria-describedby={
                          erro !== undefined
                            ? `${id}-erro variante-nova-opcoes-ajuda`
                            : "variante-nova-opcoes-ajuda"
                        }
                        onChange={(e) => {
                          escolher(o.id, e.target.value);
                        }}
                      >
                        <option value="">{t.artigoNovoEscolher}</option>
                        {o.valores.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.valor}
                          </option>
                        ))}
                      </select>
                      {erro === undefined ? null : (
                        <p id={`${id}-erro`} className="erro-campo">
                          {t[erro]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}
          <CamposDaVariante
            campos={campos}
            erros={erros}
            editaUnidade
            guardada={null}
            mudar={mudar}
          />
          <div className="accoes-artigo">
            <button type="submit" className="principal" disabled={aCriar}>
              {aCriar ? t.aCarregar : t.varianteNovaCriar}
            </button>
            {/* Enquanto cria, não se cancela: a variante podia ficar criada
                sem aviso (como a §14.4). */}
            <button type="button" onClick={voltar} disabled={aCriar}>
              {t.cancelar}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
