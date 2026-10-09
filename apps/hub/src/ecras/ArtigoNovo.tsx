import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  ErroHub,
  MAX_VARIANTES_NO_HUB,
  ORIGENS_GTIN,
  UNIDADES_DE_CONTEUDO,
  UNIDADES_DE_VENDA,
  type ArtigoNovo as CorpoArtigoNovo,
  type VarianteNova,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { preencher, type Textos } from "../textos";

// Criar um artigo físico em rascunho, com as variantes (docs/22 §14), pelo
// POST /hub/products. O ecrã só confere o que é do formulário (campos
// obrigatórios, SKU repetido nele, números inteiros, o GTIN com a origem);
// o resto decide a API (o dígito de controlo do GTIN, o SKU que já existe),
// e o ecrã põe a resposta ao lado do campo quando sabe qual é.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_GTIN = /^([0-9]{8}|[0-9]{12,14})$/;
const SO_ALGARISMOS = /^[0-9]+$/;
const MAXIMO_NOME = 200;
const MAXIMO_DESCRICAO = 10000;
const MAXIMO_MARCA = 200;
const MAXIMO_SKU = 64;
/** O maior inteiro que a base guarda (0002). */
const MAXIMO_MEDIDA = 2147483647;

type Unidade = (typeof UNIDADES_DE_VENDA)[number];
type UnidadeConteudo = (typeof UNIDADES_DE_CONTEUDO)[number];
type OrigemGtin = (typeof ORIGENS_GTIN)[number];

interface Linha {
  /** Só para o React: não vai à API. */
  chave: number;
  sku: string;
  unidade: Unidade;
  gtin: string;
  gtinOrigem: OrigemGtin | "";
  quantidade: string;
  unidadeConteudo: UnidadeConteudo | "";
  peso: string;
  comprimento: string;
  largura: string;
  altura: string;
}

type CampoLinha = Exclude<keyof Linha, "chave">;
const MEDIDAS = [
  "quantidade",
  "peso",
  "comprimento",
  "largura",
  "altura",
] as const;

/** Os erros por campo: «nome», ou «{chave}-{campo}» numa variante. */
type Erros = Record<string, keyof Textos>;

let proximaChave = 1;
const linhaNova = (): Linha => ({
  chave: proximaChave++,
  sku: "",
  unidade: "unidade",
  gtin: "",
  gtinOrigem: "",
  quantidade: "",
  unidadeConteudo: "",
  peso: "",
  comprimento: "",
  largura: "",
  altura: "",
});

const idDe = (l: Linha, campo: CampoLinha) =>
  `variante-${String(l.chave)}-${campo}`;

/** m² e m³ como se escrevem; os outros, como a API os diz. */
const simbolo = (u: UnidadeConteudo) =>
  u === "m2" ? "m²" : u === "m3" ? "m³" : u;

function medida(texto: string): number | undefined {
  const t = texto.trim();
  return t === "" ? undefined : Number(t);
}

export function ArtigoNovo({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar, definirGuarda } = useHub();
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const [podeEscrever, setPodeEscrever] = useState<boolean | null>(null);
  const [falhaCarregar, setFalhaCarregar] = useState<unknown>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [marca, setMarca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>(() => [linhaNova()]);
  const [erros, setErros] = useState<Erros>({});
  const [falha, setFalha] = useState<unknown>(null);
  const [aviso, setAviso] = useState<keyof Textos | null>(null);
  const [aCriar, setACriar] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  // Lido por uma função: depois de um await, a página pode já ter saído.
  const aindaAqui = () => montado.current;

  const destinoLista = `/artigos?comerciante=${encodeURIComponent(comerciante ?? "")}`;

  const carregar = useCallback(async () => {
    if (!valido) return;
    setFalhaCarregar(null);
    try {
      const eu = await api.eu();
      if (!montado.current) return;
      setPodeEscrever(
        eu.comerciantes
          .find((c) => c.comerciante === comerciante)
          ?.ambitos.includes("catalog:write") === true,
      );
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaCarregar(e);
    }
  }, [valido, comerciante, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Alguma coisa escrita: sair pergunta antes (§14.4, como na §13.4).
  const escrito =
    nome !== "" ||
    descricao !== "" ||
    marca !== "" ||
    linhas.length > 1 ||
    linhas.some((l) =>
      (
        [
          "sku",
          "gtin",
          "gtinOrigem",
          "quantidade",
          "unidadeConteudo",
          "peso",
          "comprimento",
          "largura",
          "altura",
        ] as const
      ).some((c) => l[c] !== ""),
    ) ||
    linhas.some((l) => l.unidade !== "unidade");

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

  function mudar(chave: number, campo: CampoLinha, valor: string) {
    setLinhas((ls) =>
      ls.map((l) => {
        if (l.chave !== chave) return l;
        const nova = { ...l, [campo]: valor };
        // Sem GTIN, a origem não vai (a API pede-a só com GTIN).
        if (campo === "gtin" && valor.trim() === "") nova.gtinOrigem = "";
        return nova;
      }),
    );
  }

  // O campo que recebe o foco depois de acrescentar ou retirar uma
  // variante: movido antes de o ecrã se pintar, para a primeira tecla não
  // se perder (um pedido de animação chegava tarde).
  const focarDepois = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focarDepois.current === null) return;
    document.getElementById(focarDepois.current)?.focus();
    focarDepois.current = null;
  }, [linhas, erros, aviso]);

  function acrescentar() {
    if (linhas.length >= MAX_VARIANTES_NO_HUB) return;
    const nova = linhaNova();
    focarDepois.current = idDe(nova, "sku");
    setLinhas([...linhas, nova]);
  }

  function retirar(chave: number) {
    const i = linhas.findIndex((l) => l.chave === chave);
    const resto = linhas.filter((l) => l.chave !== chave);
    // O foco vai para a variante de cima: o botão usado saiu do ecrã.
    const destino = resto[Math.max(0, i - 1)];
    if (destino !== undefined) focarDepois.current = idDe(destino, "sku");
    setLinhas(resto);
  }

  /** O que o formulário consegue conferir sozinho. */
  function conferir(): Erros {
    const e: Erros = {};
    if (nome.trim() === "") e["nome"] = "artigoNomeObrigatorio";
    const vistos = new Map<string, number>();
    for (const l of linhas) {
      const sku = l.sku.trim().toLowerCase();
      if (sku !== "") vistos.set(sku, (vistos.get(sku) ?? 0) + 1);
    }
    for (const l of linhas) {
      const k = String(l.chave);
      const sku = l.sku.trim();
      if (sku === "") e[`${k}-sku`] = "artigoNovoSkuObrigatorio";
      else if ((vistos.get(sku.toLowerCase()) ?? 0) > 1)
        e[`${k}-sku`] = "artigoNovoSkuRepetido";
      const gtin = l.gtin.trim();
      if (gtin !== "" && !FORMATO_GTIN.test(gtin))
        e[`${k}-gtin`] = "artigoNovoGtinFormato";
      else if (gtin !== "" && l.gtinOrigem === "")
        e[`${k}-gtinOrigem`] = "artigoNovoGtinOrigemFalta";
      for (const m of MEDIDAS) {
        const v = l[m].trim();
        if (
          v !== "" &&
          (!SO_ALGARISMOS.test(v) || Number(v) < 1 || Number(v) > MAXIMO_MEDIDA)
        )
          e[`${k}-${m}`] = "artigoNovoInteiro";
      }
      if (
        e[`${k}-quantidade`] === undefined &&
        (l.quantidade.trim() === "") !== (l.unidadeConteudo === "")
      )
        e[`${k}-quantidade`] = "artigoNovoConteudoIncompleto";
    }
    return e;
  }

  function corpo(): CorpoArtigoNovo {
    return {
      tipo: "fisico",
      nome: nome.trim(),
      descricao: descricao.trim() === "" ? null : descricao,
      marca: marca.trim() === "" ? null : marca.trim(),
      variantes: linhas.map((l) => {
        const v: VarianteNova = {
          sku: l.sku.trim(),
          unidade_de_venda: l.unidade,
        };
        const gtin = l.gtin.trim();
        if (gtin !== "" && l.gtinOrigem !== "") {
          v.gtin = gtin;
          v.gtin_origem = l.gtinOrigem;
        }
        const q = medida(l.quantidade);
        if (q !== undefined && l.unidadeConteudo !== "") {
          v.conteudo_quantidade = q;
          v.conteudo_unidade = l.unidadeConteudo;
        }
        const peso = medida(l.peso);
        if (peso !== undefined) v.peso_g = peso;
        const c = medida(l.comprimento);
        if (c !== undefined) v.comprimento_mm = c;
        const lg = medida(l.largura);
        if (lg !== undefined) v.largura_mm = lg;
        const a = medida(l.altura);
        if (a !== undefined) v.altura_mm = a;
        return v;
      }),
    };
  }

  /** O foco vai para o primeiro campo com erro (antes do aviso). */
  function focarPrimeiroErro(e: Erros) {
    if (e["nome"] !== undefined) {
      focarDepois.current = "artigo-nome";
      return;
    }
    for (const l of linhas) {
      for (const c of ["sku", "gtin", "gtinOrigem", ...MEDIDAS] as const) {
        if (e[`${String(l.chave)}-${c}`] !== undefined) {
          focarDepois.current = idDe(l, c);
          return;
        }
      }
    }
  }

  /** O aviso no topo recebe o foco, se nenhum campo o pediu. */
  function mostrarAviso(chave: keyof Textos) {
    setAviso(chave);
    focarDepois.current ??= "artigo-novo-aviso";
  }

  /** Abre a ficha do artigo criado; o formulário sai do histórico (§14.4). */
  function abrir(id: string, marcaDoAviso: "1" | "ja") {
    definirGuarda(null);
    const q = new URLSearchParams({
      comerciante: comerciante ?? "",
      criado: marcaDoAviso,
    });
    navegar(`/artigos/${id}?${q.toString()}`, { substituir: true });
  }

  /** Os SKU do formulário que já existem neste comerciante (§14.2). */
  async function skusQueJaExistem(): Promise<Erros | null> {
    if (comerciante === null) return null;
    const e: Erros = {};
    for (const l of linhas) {
      const pagina = await api.artigos(
        comerciante,
        { sku: l.sku.trim() },
        null,
      );
      if (pagina.total > 0) e[`${String(l.chave)}-sku`] = "artigoNovoSkuExiste";
    }
    return e;
  }

  /**
   * A resposta perdeu-se (sem rede, ou o servidor não respondeu): o pedido
   * pode ter gravado. O SKU da primeira variante diz se o artigo existe
   * (§14.2); com o mesmo nome, é este.
   */
  async function procurarOCriado(): Promise<string | null> {
    if (comerciante === null) return null;
    const primeiro = linhas[0]?.sku.trim() ?? "";
    const pagina = await api.artigos(comerciante, { sku: primeiro }, null);
    const achado = pagina.dados.find((a) => a.nome === nome.trim());
    return achado?.id ?? null;
  }

  async function criar(evento: React.SyntheticEvent) {
    evento.preventDefault();
    if (!valido || aCriar) return;
    setFalha(null);
    setAviso(null);
    const e = conferir();
    setErros(e);
    if (Object.keys(e).length > 0) {
      mostrarAviso("artigoNovoCorrigir");
      focarPrimeiroErro(e);
      return;
    }
    setACriar(true);
    try {
      const ficha = await api.criarArtigo(comerciante, corpo());
      if (!aindaAqui()) return;
      abrir(ficha.id, "1");
    } catch (erro) {
      if (!aindaAqui()) return;
      if (semSessao(erro)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      await depoisDaFalha(erro);
    } finally {
      if (aindaAqui()) setACriar(false);
    }
  }

  async function depoisDaFalha(erro: unknown) {
    const semResposta =
      erro instanceof ErroHub && (erro.estado === 0 || erro.estado >= 500);
    try {
      if (semResposta) {
        const id = await procurarOCriado();
        if (!aindaAqui()) return;
        if (id !== null) {
          abrir(id, "ja");
          return;
        }
        mostrarAviso("artigoNovoNaoCriado");
        return;
      }
      if (erro instanceof ErroHub && erro.codigo === "catalog.sku_duplicate") {
        const doCampo = await skusQueJaExistem();
        if (!aindaAqui()) return;
        if (doCampo !== null && Object.keys(doCampo).length > 0) {
          setErros(doCampo);
          mostrarAviso("artigoNovoCorrigir");
          focarPrimeiroErro(doCampo);
          return;
        }
      }
      // Um GTIN com um só candidato: o erro vai para o campo dele.
      const comGtin = linhas.filter((l) => l.gtin.trim() !== "");
      const soUm = comGtin.length === 1 ? comGtin[0] : undefined;
      if (
        erro instanceof ErroHub &&
        soUm !== undefined &&
        (erro.codigo === "catalog.gtin_invalid" ||
          erro.codigo === "catalog.gtin_duplicate")
      ) {
        const doCampo: Erros = {
          [`${String(soUm.chave)}-gtin`]:
            erro.codigo === "catalog.gtin_invalid"
              ? "artigoNovoGtinInvalido"
              : "artigoNovoGtinRepetido",
        };
        setErros(doCampo);
        mostrarAviso("artigoNovoCorrigir");
        focarPrimeiroErro(doCampo);
        return;
      }
      setFalha(erro);
    } catch (e2) {
      if (!aindaAqui()) return;
      if (semSessao(e2)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      // A procura falhou: fica o erro do pedido, que é o que a pessoa viu.
      setFalha(
        semResposta
          ? new ErroHub(0, undefined, {}, undefined, undefined)
          : erro,
      );
    }
  }

  function voltar() {
    navegar(destinoLista, { substituir: true });
  }

  /** O erro de um campo: o texto ao lado e o que o liga ao campo. */
  function erroDe(id: string, chave: string) {
    const texto = erros[chave];
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

  function campoDeMedida(
    l: Linha,
    campo: (typeof MEDIDAS)[number],
    rotulo: string,
  ) {
    const id = idDe(l, campo);
    const e = erroDe(id, `${String(l.chave)}-${campo}`);
    return (
      <div className="campo">
        <label htmlFor={id}>{rotulo}</label>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={l[campo]}
          {...e.props}
          onChange={(ev) => {
            mudar(l.chave, campo, ev.target.value);
          }}
        />
        {e.mensagem}
      </div>
    );
  }

  const nomeErro = erroDe("artigo-nome", "nome");

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoLista}
          onClick={(e) => {
            e.preventDefault();
            voltar();
          }}
        >
          {t.artigoVoltar}
        </a>
      </p>
      <h1 id="titulo">{t.artigoNovoTitulo}</h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : podeEscrever === null && falhaCarregar !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falhaCarregar, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : podeEscrever === null ? (
        <ACarregar />
      ) : !podeEscrever ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <form onSubmit={(e) => void criar(e)} noValidate>
          {aviso === null ? null : (
            <div
              className={aviso === "artigoNovoNaoCriado" ? "aviso" : "erro"}
              role="alert"
              id="artigo-novo-aviso"
              tabIndex={-1}
            >
              <p>
                <strong>{t[aviso]}</strong>
              </p>
            </div>
          )}
          {falha === null ? null : (
            <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
          )}
          <p>
            <strong>{t.artigoNovoTipo}:</strong> {t.tipoArtigo_fisico}
          </p>
          <div className="campo">
            <label htmlFor="artigo-nome">{t.colunaNome}</label>
            <input
              id="artigo-nome"
              required
              maxLength={MAXIMO_NOME}
              value={nome}
              {...nomeErro.props}
              onChange={(e) => {
                setNome(e.target.value);
              }}
            />
            {nomeErro.mensagem}
          </div>
          <div className="campo">
            <label htmlFor="artigo-descricao">{t.artigoDescricao}</label>
            <textarea
              id="artigo-descricao"
              rows={6}
              maxLength={MAXIMO_DESCRICAO}
              aria-describedby="artigo-descricao-contagem"
              value={descricao}
              onChange={(e) => {
                setDescricao(e.target.value);
              }}
            />
            <p id="artigo-descricao-contagem" className="secundario">
              {preencher(t.artigoCaracteres, {
                n: descricao.length,
                max: MAXIMO_DESCRICAO,
              })}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="artigo-marca">{t.colunaMarca}</label>
            <input
              id="artigo-marca"
              maxLength={MAXIMO_MARCA}
              value={marca}
              onChange={(e) => {
                setMarca(e.target.value);
              }}
            />
          </div>
          <h2>{t.artigoVariantes}</h2>
          {linhas.map((l, i) => {
            const n = i + 1;
            const k = String(l.chave);
            const sku = erroDe(idDe(l, "sku"), `${k}-sku`);
            const gtin = erroDe(idDe(l, "gtin"), `${k}-gtin`);
            const origem = erroDe(idDe(l, "gtinOrigem"), `${k}-gtinOrigem`);
            return (
              <fieldset key={l.chave} className="variante-nova">
                <legend>{preencher(t.artigoNovoVariante, { n })}</legend>
                <div className="linha">
                  <div className="campo">
                    <label htmlFor={idDe(l, "sku")}>{t.artigosSku}</label>
                    <input
                      id={idDe(l, "sku")}
                      required
                      maxLength={MAXIMO_SKU}
                      autoComplete="off"
                      value={l.sku}
                      {...sku.props}
                      onChange={(e) => {
                        mudar(l.chave, "sku", e.target.value);
                      }}
                    />
                    {sku.mensagem}
                  </div>
                  <div className="campo">
                    <label htmlFor={idDe(l, "unidade")}>
                      {t.colunaUnidade}
                    </label>
                    <select
                      id={idDe(l, "unidade")}
                      value={l.unidade}
                      onChange={(e) => {
                        mudar(l.chave, "unidade", e.target.value);
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
                  <div className="campo">
                    <label htmlFor={idDe(l, "gtin")}>{t.colunaGtin}</label>
                    <input
                      id={idDe(l, "gtin")}
                      inputMode="numeric"
                      autoComplete="off"
                      value={l.gtin}
                      {...gtin.props}
                      onChange={(e) => {
                        mudar(l.chave, "gtin", e.target.value);
                      }}
                    />
                    {gtin.mensagem}
                  </div>
                  {l.gtin.trim() === "" ? null : (
                    <div className="campo">
                      <label htmlFor={idDe(l, "gtinOrigem")}>
                        {t.artigoNovoGtinOrigem}
                      </label>
                      <select
                        id={idDe(l, "gtinOrigem")}
                        value={l.gtinOrigem}
                        {...origem.props}
                        onChange={(e) => {
                          mudar(l.chave, "gtinOrigem", e.target.value);
                        }}
                      >
                        <option value="">{t.artigoNovoEscolher}</option>
                        {ORIGENS_GTIN.map((o) => (
                          <option key={o} value={o}>
                            {t[`gtinOrigem_${o}`]}
                          </option>
                        ))}
                      </select>
                      {origem.mensagem}
                    </div>
                  )}
                </div>
                <div className="linha">
                  {campoDeMedida(l, "quantidade", t.artigoNovoQuantidade)}
                  <div className="campo">
                    <label htmlFor={idDe(l, "unidadeConteudo")}>
                      {t.artigoNovoUnidadeConteudo}
                    </label>
                    <select
                      id={idDe(l, "unidadeConteudo")}
                      value={l.unidadeConteudo}
                      onChange={(e) => {
                        mudar(l.chave, "unidadeConteudo", e.target.value);
                      }}
                    >
                      <option value="">{t.artigoNovoSemUnidade}</option>
                      {UNIDADES_DE_CONTEUDO.map((u) => (
                        <option key={u} value={u}>
                          {simbolo(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="linha">
                  {campoDeMedida(l, "peso", t.artigoNovoPeso)}
                  {campoDeMedida(l, "comprimento", t.artigoNovoComprimento)}
                  {campoDeMedida(l, "largura", t.artigoNovoLargura)}
                  {campoDeMedida(l, "altura", t.artigoNovoAltura)}
                </div>
                {l.peso.trim() === "" ? (
                  <p className="secundario">{t.artigoNovoSemPeso}</p>
                ) : null}
                {i === 0 ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      retirar(l.chave);
                    }}
                  >
                    {preencher(t.artigoNovoRetirar, { n })}
                  </button>
                )}
              </fieldset>
            );
          })}
          {linhas.length >= MAX_VARIANTES_NO_HUB ? (
            <p className="secundario">{t.artigoNovoMaximo}</p>
          ) : (
            <p>
              <button type="button" onClick={acrescentar}>
                {t.artigoNovoAcrescentar}
              </button>
            </p>
          )}
          <div className="accoes-artigo">
            <button type="submit" className="principal" disabled={aCriar}>
              {aCriar ? t.aCarregar : t.artigoCriar}
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
