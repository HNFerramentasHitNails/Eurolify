import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  api,
  ErroHub,
  ESTADOS_ARTIGO,
  type EstadoArtigo,
  type Eu,
  type FiltrosArtigos,
  type ResumoArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub, LigacaoInterna } from "../contexto";
import { mensagemDeErro, semSessao, type MensagemDeErro } from "../erros";
import { preencher, TAG_LINGUA } from "../textos";
import { entradaDe } from "../modulos";

// A lista de artigos de um comerciante (docs/22 §11.2): a mesma lista, os
// mesmos filtros e as mesmas páginas do GET /products, pelo caminho do Hub
// (GET /hub/products). Só leitura. A contagem está sempre à vista e nada se
// corta em silêncio: «Mostrar mais» pede a página seguinte.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;

interface Lista {
  artigos: ResumoArtigo[];
  /** Quantos passam no filtro, em todas as páginas. */
  total: number;
  /** Quantos há sem filtro (só se pede com um filtro aplicado). */
  totalSemFiltro: number;
  cursor: string | null;
}

const semFiltro = (f: FiltrosArtigos) =>
  f.estado === undefined && f.texto === undefined && f.sku === undefined;

/**
 * Os filtros que vêm no endereço (a ficha devolve-os em «Voltar aos
 * artigos», docs/22 §12.2); um valor fora do formato não conta.
 */
function filtrosDoEndereco(consulta: string): FiltrosArtigos {
  const q = new URLSearchParams(consulta);
  const estado = q.get("estado");
  const texto = q.get("texto")?.trim() ?? "";
  const sku = q.get("sku")?.trim() ?? "";
  return {
    ...(ESTADOS_ARTIGO.some((x) => x === estado)
      ? { estado: estado as EstadoArtigo }
      : {}),
    ...(aceite(texto, 200) ? { texto } : {}),
    ...(aceite(sku, 64) ? { sku } : {}),
  };
}

/**
 * O que a API aceita num filtro de texto: até ao tamanho e sem caracteres de
 * controlo; outro valor dava um 400 que «Tentar outra vez» repetia (revisão
 * do #206, P3-2).
 */
const aceite = (v: string, tamanho: number) =>
  v !== "" &&
  v.length <= tamanho &&
  Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)).every(
    (c) => c > 0x1f,
  );

/** A consulta da lista: o comerciante e os filtros aplicados. */
function consultaDaLista(comerciante: string, f: FiltrosArtigos): string {
  const q = new URLSearchParams({ comerciante });
  if (f.estado !== undefined) q.set("estado", f.estado);
  if (f.texto !== undefined) q.set("texto", f.texto);
  if (f.sku !== undefined) q.set("sku", f.sku);
  return q.toString();
}

export function Artigos({
  comerciante,
  consulta,
}: {
  comerciante: string | null;
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const [eu, setEu] = useState<Eu | null>(null);
  const [lista, setLista] = useState<Lista | null>(null);
  // Os filtros do endereço só se lêem ao abrir a lista.
  const [iniciais] = useState(() => filtrosDoEndereco(consulta));
  const [filtros, setFiltros] = useState<FiltrosArtigos>(iniciais);
  // O que está escrito nos campos, antes de «Procurar».
  const [estado, setEstado] = useState<EstadoArtigo | "">(
    iniciais.estado ?? "",
  );
  const [texto, setTexto] = useState(iniciais.texto ?? "");
  const [sku, setSku] = useState(iniciais.sku ?? "");
  const [aCarregarMais, setACarregarMais] = useState(false);
  // Os erros guardam-se crus e traduzem-se ao mostrar (revisão do #158, P3-7).
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  // O erro de «Mostrar mais» fica à parte: as páginas já lidas ficam à
  // vista (revisão do #201, P3-4).
  const [falhaMais, setFalhaMais] = useState<unknown>(null);
  const erroMais: MensagemDeErro | null =
    falhaMais === null ? null : mensagemDeErro(falhaMais, t, lingua);
  // Só a resposta do último pedido conta.
  const ultimo = useRef(0);
  // Quando acaba a última página, o foco vai para a contagem, em vez de se
  // perder com o botão (revisão do #201, P3-8).
  const contagem = useRef<HTMLParagraphElement>(null);

  const carregar = useCallback(
    async (f: FiltrosArtigos) => {
      if (!valido) return;
      const este = ++ultimo.current;
      setFalha(null);
      setFalhaMais(null);
      // Um «Mostrar mais» antigo deixa de contar (revisão do #201, P3-5).
      setACarregarMais(false);
      setLista(null);
      try {
        const [quem, pagina, todos] = await Promise.all([
          api.eu(),
          api.artigos(comerciante, f, null),
          semFiltro(f) ? null : api.artigos(comerciante, {}, null),
        ]);
        if (este !== ultimo.current) return;
        setEu(quem);
        setLista({
          artigos: pagina.dados,
          total: pagina.total,
          totalSemFiltro: todos?.total ?? pagina.total,
          cursor: pagina.cursor_seguinte,
        });
      } catch (e) {
        if (este !== ultimo.current) return;
        if (semSessao(e)) {
          navegar("/entrar", { substituir: true });
          return;
        }
        setFalha(e);
      }
    },
    [valido, comerciante, navegar],
  );

  useEffect(() => {
    void carregar(iniciais);
  }, [carregar, iniciais]);

  // Os filtros aplicados ficam no endereço, sem nova entrada no histórico
  // nem mudar o foco (o navegar() do Hub leva o foco ao conteúdo).
  function guardarNoEndereco(f: FiltrosArtigos) {
    if (!valido) return;
    window.history.replaceState(
      null,
      "",
      `/artigos?${consultaDaLista(comerciante, f)}`,
    );
  }

  async function mostrarMais() {
    if (!valido || lista?.cursor == null || aCarregarMais) return;
    const este = ultimo.current;
    setACarregarMais(true);
    setFalhaMais(null);
    try {
      const pagina = await api.artigos(comerciante, filtros, lista.cursor);
      if (este !== ultimo.current) return;
      setLista({
        ...lista,
        artigos: [...lista.artigos, ...pagina.dados],
        total: pagina.total,
        cursor: pagina.cursor_seguinte,
      });
      if (pagina.cursor_seguinte === null) {
        requestAnimationFrame(() => {
          contagem.current?.focus();
        });
      }
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaMais(e);
    } finally {
      if (este === ultimo.current) setACarregarMais(false);
    }
  }

  function aplicar(evento: SyntheticEvent) {
    evento.preventDefault();
    const f: FiltrosArtigos = {
      ...(estado === "" ? {} : { estado }),
      ...(texto.trim() === "" ? {} : { texto: texto.trim() }),
      ...(sku.trim() === "" ? {} : { sku: sku.trim() }),
    };
    setFiltros(f);
    guardarNoEndereco(f);
    void carregar(f);
  }

  function limpar() {
    setEstado("");
    setTexto("");
    setSku("");
    setFiltros({});
    guardarNoEndereco({});
    void carregar({});
  }

  const data = (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], { dateStyle: "medium" }).format(
      new Date(iso),
    );

  // A ficha leva os filtros, para «Voltar aos artigos» os repor.
  const fichaDe = (id: string) =>
    `/artigos/${id}?${valido ? consultaDaLista(comerciante, filtros) : ""}`;

  const meu = eu?.comerciantes.find((c) => c.comerciante === comerciante);
  const filtrado = !semFiltro(filtros);
  // Só decide o que o ecrã oferece; a API recusa na mesma (§14.2).
  const podeCriar = valido && meu?.ambitos.includes("catalog:write") === true;
  const destinoCriar = `/artigos/novo?comerciante=${encodeURIComponent(comerciante ?? "")}`;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.artigosTitulo}
        {meu === undefined ? "" : ` — ${meu.nome}`}
      </h1>
      {podeCriar ? (
        <p>
          <LigacaoInterna className="botao" href={destinoCriar}>
            {t.artigoCriar}
          </LigacaoInterna>
        </p>
      ) : null}
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <form
            className="filtros"
            role="search"
            aria-label={t.artigosFiltros}
            onSubmit={aplicar}
          >
            <div className="campo">
              <label htmlFor="filtro-estado">{t.artigosFiltroEstado}</label>
              <select
                id="filtro-estado"
                value={estado}
                onChange={(e) => {
                  setEstado(e.target.value as EstadoArtigo | "");
                }}
              >
                <option value="">{t.artigosTodos}</option>
                {ESTADOS_ARTIGO.map((x) => (
                  <option key={x} value={x}>
                    {t[`estadoArtigo_${x}`]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="filtro-nome">{t.colunaNome}</label>
              <input
                id="filtro-nome"
                type="search"
                maxLength={200}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                }}
              />
            </div>
            <div className="campo">
              <label htmlFor="filtro-sku">{t.artigosSku}</label>
              <input
                id="filtro-sku"
                type="search"
                maxLength={64}
                translate="no"
                value={sku}
                onChange={(e) => {
                  setSku(e.target.value);
                }}
              />
            </div>
            <button type="submit">{t.artigosProcurarBotao}</button>
          </form>
          {falha instanceof ErroHub && falha.estado === 403 ? (
            // Outro comerciante, ou já saiu da equipa: tentar outra vez não
            // adianta (revisão do #201, P3-6).
            <CaixaDeErro erro={{ texto: t.artigosSemPermissao }} />
          ) : erro !== null ? (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar(filtros)} />
          ) : lista === null ? (
            <ACarregar />
          ) : (
            <>
              <p
                className="secundario"
                role="status"
                tabIndex={-1}
                ref={contagem}
              >
                {filtrado
                  ? preencher(t.artigosContagemFiltro, {
                      n: lista.total,
                      total: lista.totalSemFiltro,
                    })
                  : lista.total === 1
                    ? t.artigosContagemUm
                    : preencher(t.artigosContagem, { n: lista.total })}
              </p>
              {lista.totalSemFiltro === 0 && !filtrado ? (
                // Com catalog:write, o botão está por cima (§14.4).
                <p>{podeCriar ? t.artigosVazioCriar : t.artigosVazio}</p>
              ) : lista.artigos.length === 0 ? (
                <>
                  <p>{t.artigosSemResultados}</p>
                  <button type="button" onClick={limpar}>
                    {t.artigosLimparFiltro}
                  </button>
                </>
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t.colunaNome}</th>
                        <th scope="col">{t.colunaTipo}</th>
                        <th scope="col">{t.colunaEstado}</th>
                        <th scope="col">{t.colunaMarca}</th>
                        <th scope="col">{t.colunaAlterado}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.artigos.map((a) => (
                        <tr key={a.id}>
                          <td data-rotulo={t.colunaNome}>
                            <a
                              href={fichaDe(a.id)}
                              onClick={(e) => {
                                e.preventDefault();
                                navegar(fichaDe(a.id));
                              }}
                            >
                              {a.nome}
                            </a>
                            {a.origem === "externo" ? (
                              <>
                                {" "}
                                <span className="secundario">
                                  ({t.artigosDoSistema})
                                </span>
                              </>
                            ) : null}
                          </td>
                          <td data-rotulo={t.colunaTipo}>
                            {t[`tipoArtigo_${a.tipo}`]}
                          </td>
                          <td data-rotulo={t.colunaEstado}>
                            <span
                              className="estado-artigo"
                              data-estado={a.estado}
                            >
                              {t[`estadoArtigo_${a.estado}`]}
                            </span>
                          </td>
                          <td data-rotulo={t.colunaMarca}>{a.marca ?? "—"}</td>
                          <td data-rotulo={t.colunaAlterado}>
                            {data(a.actualizado_em)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {erroMais === null ? null : (
                    <CaixaDeErro
                      erro={erroMais}
                      aoTentar={() => void mostrarMais()}
                    />
                  )}
                  {lista.cursor === null || erroMais !== null ? null : (
                    <p>
                      <button
                        type="button"
                        disabled={aCarregarMais}
                        onClick={() => void mostrarMais()}
                      >
                        {aCarregarMais ? t.aCarregar : t.artigosMostrarMais}
                      </button>
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
