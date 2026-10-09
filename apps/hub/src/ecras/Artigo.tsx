import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ErroHub,
  type FichaArtigo,
  type ImagemArtigo,
  type PublicacaoArtigo,
  type VarianteArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { preencher, TAG_LINGUA, type Textos } from "../textos";

// A ficha do artigo (docs/22 §12.2): o artigo com as variantes, as imagens
// e as publicações, pelas mesmas funções da API (GET /hub/products/{id},
// …/media, /hub/media/{id}/file e …/publications). Cada parte carrega e
// falha sozinha; o cabeçalho primeiro, as imagens e as publicações depois de
// o artigo existir. Com catalog:write, as acções da §13: editar, o estado,
// as imagens e arquivar uma variante; num artigo do sistema de gestão, só as
// imagens (P5, §13.3). O servidor confere tudo na mesma.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
// O mesmo formato que a API aceita: um endereço mal escrito diz «não existe»
// em vez de um erro que se repete (revisão do #206, P3-3).
const FORMATO_ARTIGO =
  /^prd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Os filtros da lista que a ficha guarda para «Voltar aos artigos». */
const FILTROS_DA_LISTA = ["estado", "texto", "sku"] as const;

/** Uma parte da ficha: a carregar, com os dados ou com o erro (cru). */
type Parte<T> =
  | { tipo: "a_carregar" }
  | { tipo: "pronto"; dados: T }
  | { tipo: "erro"; erro: unknown };

export function Artigo({
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
  const comercianteValido =
    comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const valido = comercianteValido && FORMATO_ARTIGO.test(artigo);
  const [ficha, setFicha] = useState<Parte<FichaArtigo>>({
    tipo: "a_carregar",
  });
  const [imagens, setImagens] = useState<Parte<ImagemArtigo[]>>({
    tipo: "a_carregar",
  });
  const [publicacoes, setPublicacoes] = useState<Parte<PublicacaoArtigo[]>>({
    tipo: "a_carregar",
  });
  // Os âmbitos da pessoa neste comerciante (/hub/me, §13.2): só decidem o
  // que o ecrã oferece.
  const [podeEscrever, setPodeEscrever] = useState(false);
  // Uma acção de cada vez; o erro dela fica à vista até à seguinte.
  const [ocupado, setOcupado] = useState(false);
  const [falhaAccao, setFalhaAccao] = useState<unknown>(null);
  const [aviso, setAviso] = useState<string | null>(() =>
    new URLSearchParams(consulta).get("guardado") === "1" ? "guardado" : null,
  );
  // Ao sair da ficha, as respostas que ainda cheguem deixam de contar.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const aoFalhar = useCallback(
    (e: unknown, guardar: (erro: unknown) => void) => {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      guardar(e);
    },
    [navegar],
  );

  const carregarImagens = useCallback(async () => {
    if (!valido) return;
    setImagens({ tipo: "a_carregar" });
    try {
      const dados = await api.imagensDoArtigo(comerciante, artigo);
      if (montado.current) setImagens({ tipo: "pronto", dados });
    } catch (e) {
      aoFalhar(e, (erro) => {
        setImagens({ tipo: "erro", erro });
      });
    }
  }, [valido, comerciante, artigo, aoFalhar]);

  const carregarPublicacoes = useCallback(async () => {
    if (!valido) return;
    setPublicacoes({ tipo: "a_carregar" });
    try {
      const r = await api.publicacoesDoArtigo(comerciante, artigo);
      if (montado.current) setPublicacoes({ tipo: "pronto", dados: r.dados });
    } catch (e) {
      aoFalhar(e, (erro) => {
        setPublicacoes({ tipo: "erro", erro });
      });
    }
  }, [valido, comerciante, artigo, aoFalhar]);

  const carregarFicha = useCallback(async () => {
    if (!valido) return;
    setFicha({ tipo: "a_carregar" });
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
      setFicha({ tipo: "pronto", dados });
      void carregarImagens();
      void carregarPublicacoes();
    } catch (e) {
      aoFalhar(e, (erro) => {
        setFicha({ tipo: "erro", erro });
      });
    }
  }, [
    valido,
    comerciante,
    artigo,
    aoFalhar,
    carregarImagens,
    carregarPublicacoes,
  ]);

  useEffect(() => {
    void carregarFicha();
  }, [carregarFicha]);

  // A marca «guardado» (vinda da edição) sai do endereço: recarregar a
  // página não volta a dizer que guardou.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("guardado") !== "1") return;
    q.delete("guardado");
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${q.toString()}`,
    );
  }, []);

  /**
   * Corre uma acção da §13. Um conflito de versão (outra pessoa mudou) ou um
   * 404 recarregam a ficha, para o ecrã mostrar o que está guardado agora.
   */
  async function agir(fn: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    setFalhaAccao(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      if (!montado.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaAccao(e);
      if (e instanceof ErroHub && (e.estado === 409 || e.estado === 404)) {
        void carregarFicha();
      }
    } finally {
      if (montado.current) setOcupado(false);
    }
  }

  function mudarEstado(accao: "activate" | "archive" | "restore") {
    if (ficha.tipo !== "pronto" || !valido) return;
    if (accao === "archive" && !window.confirm(t.artigoConfirmarArquivar)) {
      return;
    }
    const versao = ficha.dados.versao;
    void agir(async () => {
      const dados = await api.mudarEstadoDoArtigo(
        comerciante,
        artigo,
        accao,
        versao,
      );
      if (!montado.current) return;
      setFicha({ tipo: "pronto", dados });
      setAviso("guardado");
      // Arquivar arquiva as publicações (§4.1).
      void carregarPublicacoes();
    });
  }

  function arquivarVariante(v: VarianteArtigo) {
    if (ficha.tipo !== "pronto" || !valido) return;
    const activas = ficha.dados.variantes.filter((x) => x.estado === "activa");
    const pergunta =
      activas.length === 1
        ? t.artigoUltimaVariante
        : t.artigoConfirmarArquivarVariante;
    if (!window.confirm(preencher(pergunta, { sku: v.sku }))) return;
    void agir(async () => {
      await api.arquivarVariante(comerciante, v.id);
      if (!montado.current) return;
      setAviso("guardado");
      await carregarFicha();
    });
  }

  /** Grava uma imagem e recarrega as imagens e as publicações (C2). */
  function guardarImagem(
    m: ImagemArtigo,
    corpo: { texto_alternativo?: string | null; principal?: boolean },
  ) {
    if (!valido) return;
    void agir(async () => {
      await api.alterarImagem(comerciante, m.id, {
        versao: m.versao,
        ...corpo,
      });
      if (!montado.current) return;
      setAviso("guardado");
      void carregarImagens();
      void carregarPublicacoes();
    });
  }

  /**
   * Muda uma imagem de lugar: a ordem nova em posições 0, 1, 2…, gravando
   * só as que mudam (a API ordena pela posição e depois pelo id).
   */
  function moverImagem(indice: number, para: number) {
    if (imagens.tipo !== "pronto" || !valido) return;
    const ordem = [...imagens.dados];
    const [movida] = ordem.splice(indice, 1);
    if (movida === undefined) return;
    ordem.splice(para, 0, movida);
    void agir(async () => {
      try {
        for (const [posicao, m] of ordem.entries()) {
          if (m.posicao === posicao) continue;
          await api.alterarImagem(comerciante, m.id, {
            versao: m.versao,
            posicao,
          });
        }
        if (montado.current) setAviso("guardado");
      } finally {
        // Também se uma das gravações falhar: o ecrã mostra o que ficou.
        if (montado.current) void carregarImagens();
      }
    });
  }

  // «Voltar aos artigos» leva o comerciante e os filtros da lista.
  const daLista = new URLSearchParams(consulta);
  const voltar = new URLSearchParams();
  if (comerciante !== null) voltar.set("comerciante", comerciante);
  for (const f of FILTROS_DA_LISTA) {
    const v = daLista.get(f);
    if (v !== null) voltar.set(f, v);
  }
  const destinoVoltar = `/artigos?${voltar.toString()}`;

  const data = (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], { dateStyle: "medium" }).format(
      new Date(iso),
    );

  // Sem comerciante, como a lista (revisão do #206, P3-4).
  const semComerciante = !comercianteValido;
  const naoExiste =
    !valido ||
    (ficha.tipo === "erro" &&
      ficha.erro instanceof ErroHub &&
      ficha.erro.estado === 404);
  const semPermissao =
    ficha.tipo === "erro" &&
    ficha.erro instanceof ErroHub &&
    ficha.erro.estado === 403;

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href={destinoVoltar}
          onClick={(e) => {
            e.preventDefault();
            navegar(destinoVoltar);
          }}
        >
          {t.artigoVoltar}
        </a>
      </p>
      <h1 id="titulo">
        {ficha.tipo === "pronto" ? ficha.dados.nome : t.artigoTitulo}
      </h1>
      {semComerciante ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : naoExiste ? (
        <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />
      ) : semPermissao ? (
        <CaixaDeErro erro={{ texto: t.artigosSemPermissao }} />
      ) : ficha.tipo === "erro" ? (
        <CaixaDeErro
          erro={mensagemDeErro(ficha.erro, t, lingua)}
          aoTentar={() => void carregarFicha()}
        />
      ) : ficha.tipo === "a_carregar" ? (
        <ACarregar />
      ) : (
        <>
          <Cabecalho
            ficha={ficha.dados}
            data={data}
            podeEscrever={podeEscrever}
            ocupado={ocupado}
            destinoEditar={`/artigos/${artigo}/editar?${voltar.toString()}`}
            aoMudarEstado={mudarEstado}
          />
          {aviso === null ? null : (
            <p className="secundario" role="status">
              {t.artigoGuardado}
            </p>
          )}
          {falhaAccao === null ? null : (
            <CaixaDeErro erro={mensagemDeErro(falhaAccao, t, lingua)} />
          )}
          <h2>{t.artigoDescricao}</h2>
          {ficha.dados.descricao === null ||
          ficha.dados.descricao.trim() === "" ? (
            <p className="secundario">{t.artigoSemDescricao}</p>
          ) : (
            <p className="descricao-artigo">{ficha.dados.descricao}</p>
          )}
          <h2>{t.artigoVariantes}</h2>
          <Variantes
            variantes={ficha.dados.variantes}
            podeArquivar={podeEscrever && ficha.dados.origem !== "externo"}
            ocupado={ocupado}
            aoArquivar={arquivarVariante}
          />
          <h2>{t.artigoImagens}</h2>
          {imagens.tipo === "a_carregar" ? (
            <ACarregar />
          ) : imagens.tipo === "erro" ? (
            <ErroDaParte
              erro={imagens.erro}
              aoTentar={() => void carregarImagens()}
            />
          ) : imagens.dados.length === 0 ? (
            <p className="secundario">{t.artigoSemImagens}</p>
          ) : (
            <ul className="imagens-artigo">
              {imagens.dados.map((m, i, todas) => (
                <Miniatura
                  key={m.id}
                  comerciante={comerciante}
                  imagem={m}
                  variantes={ficha.dados.variantes}
                  edicao={
                    podeEscrever
                      ? {
                          ocupado,
                          primeira: i === 0,
                          ultima: i === todas.length - 1,
                          aoGuardar: (corpo) => {
                            guardarImagem(m, corpo);
                          },
                          aoMover: (passo) => {
                            moverImagem(i, i + passo);
                          },
                        }
                      : null
                  }
                />
              ))}
            </ul>
          )}
          <h2>{t.artigoPublicacoes}</h2>
          {publicacoes.tipo === "a_carregar" ? (
            <ACarregar />
          ) : publicacoes.tipo === "erro" ? (
            <ErroDaParte
              erro={publicacoes.erro}
              aoTentar={() => void carregarPublicacoes()}
            />
          ) : publicacoes.dados.length === 0 ? (
            <p className="secundario">{t.artigoSemPublicacoes}</p>
          ) : (
            <Publicacoes publicacoes={publicacoes.dados} data={data} />
          )}
        </>
      )}
    </section>
  );
}

/**
 * O erro de uma parte da ficha. Um 403 (a pessoa saiu da equipa) e um 404 (o
 * artigo deixou de existir) não se resolvem a tentar outra vez (revisão do
 * #206, P3-3).
 */
function ErroDaParte({
  erro,
  aoTentar,
}: {
  erro: unknown;
  aoTentar: () => void;
}) {
  const { t, lingua } = useHub();
  if (erro instanceof ErroHub && erro.estado === 403) {
    return <CaixaDeErro erro={{ texto: t.artigosSemPermissao }} />;
  }
  if (erro instanceof ErroHub && erro.estado === 404) {
    return <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />;
  }
  return (
    <CaixaDeErro erro={mensagemDeErro(erro, t, lingua)} aoTentar={aoTentar} />
  );
}

/** O texto de um valor da API, ou o próprio valor se o Hub ainda não o tem. */
function textoDe(t: Textos, chave: string, valor: string): string {
  return chave in t ? t[chave as keyof Textos] : valor;
}

/** O botão do estado que a §4.1 do docs/14 deixa a partir de cada estado. */
const ACCAO_DO_ESTADO = {
  rascunho: ["activate", "artigoActivar"],
  activo: ["archive", "artigoArquivar"],
  arquivado: ["restore", "artigoRepor"],
} as const;

function Cabecalho({
  ficha,
  data,
  podeEscrever,
  ocupado,
  destinoEditar,
  aoMudarEstado,
}: {
  ficha: FichaArtigo;
  data: (iso: string) => string;
  podeEscrever: boolean;
  ocupado: boolean;
  destinoEditar: string;
  aoMudarEstado: (accao: "activate" | "archive" | "restore") => void;
}) {
  const { t, navegar } = useHub();
  const externo = ficha.origem === "externo";
  const accao = ACCAO_DO_ESTADO[ficha.estado];
  return (
    <div className="cabecalho-artigo">
      <p>
        <span className="estado-artigo" data-estado={ficha.estado}>
          {textoDe(t, `estadoArtigo_${ficha.estado}`, ficha.estado)}
        </span>
        {" · "}
        {textoDe(t, `tipoArtigo_${ficha.tipo}`, ficha.tipo)}
        {ficha.marca === null ? null : ` · ${ficha.marca}`}
      </p>
      {ficha.origem === "externo" ? (
        <p className="secundario">
          {ficha.origem_ref === null
            ? t.artigosDoSistema
            : preencher(t.artigoDoSistemaRef, { ref: ficha.origem_ref })}
        </p>
      ) : null}
      <p className="secundario">
        {preencher(t.artigoCriadoAlterado, {
          criado: data(ficha.criado_em),
          alterado: data(ficha.actualizado_em),
        })}
      </p>
      {!podeEscrever ? null : externo ? (
        <p className="secundario">{t.artigoExternoAviso}</p>
      ) : (
        <div className="accoes-artigo">
          <a
            className="botao"
            href={destinoEditar}
            onClick={(e) => {
              e.preventDefault();
              navegar(destinoEditar);
            }}
          >
            {t.artigoEditar}
          </a>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              aoMudarEstado(accao[0]);
            }}
          >
            {t[accao[1]]}
          </button>
        </div>
      )}
    </div>
  );
}

function Variantes({
  variantes,
  podeArquivar,
  ocupado,
  aoArquivar,
}: {
  variantes: VarianteArtigo[];
  podeArquivar: boolean;
  ocupado: boolean;
  aoArquivar: (v: VarianteArtigo) => void;
}) {
  const { t, lingua } = useHub();
  const numero = (n: number) =>
    new Intl.NumberFormat(TAG_LINGUA[lingua]).format(n);
  return (
    <table className="tabela-larga">
      <thead>
        <tr>
          <th scope="col">{t.artigosSku}</th>
          <th scope="col">{t.colunaEstado}</th>
          <th scope="col">{t.colunaUnidade}</th>
          <th scope="col">{t.colunaGtin}</th>
          <th scope="col">{t.colunaConteudo}</th>
          <th scope="col">{t.colunaPeso}</th>
          {podeArquivar ? <th scope="col">{t.colunaAccoes}</th> : null}
        </tr>
      </thead>
      <tbody>
        {variantes.map((v) => (
          <tr key={v.id}>
            <td data-rotulo={t.artigosSku}>
              <code translate="no">{v.sku}</code>
            </td>
            <td data-rotulo={t.colunaEstado}>
              {textoDe(t, `estadoVariante_${v.estado}`, v.estado)}
            </td>
            <td data-rotulo={t.colunaUnidade}>
              {textoDe(t, `unidade_${v.unidade_de_venda}`, v.unidade_de_venda)}
            </td>
            <td data-rotulo={t.colunaGtin}>
              {v.gtin === null ? "—" : <code translate="no">{v.gtin}</code>}
            </td>
            <td data-rotulo={t.colunaConteudo}>
              {v.conteudo_quantidade === null
                ? "—"
                : `${numero(v.conteudo_quantidade)} ${v.conteudo_unidade ?? ""}`.trim()}
            </td>
            <td data-rotulo={t.colunaPeso}>
              {v.peso_g === null ? "—" : `${numero(v.peso_g)} g`}
            </td>
            {podeArquivar ? (
              <td data-rotulo={t.colunaAccoes}>
                {v.estado === "activa" ? (
                  <button
                    type="button"
                    disabled={ocupado}
                    aria-label={`${t.artigoArquivarVariante} ${v.sku}`}
                    onClick={() => {
                      aoArquivar(v);
                    }}
                  >
                    {t.artigoArquivarVariante}
                  </button>
                ) : (
                  "—"
                )}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Uma imagem: os bytes pedidos com o cabeçalho do comerciante e mostrados
 * por um endereço `blob:`, apagado ao sair (docs/22 §12.1).
 */
interface EdicaoDaImagem {
  ocupado: boolean;
  primeira: boolean;
  ultima: boolean;
  aoGuardar: (corpo: {
    texto_alternativo?: string | null;
    principal?: boolean;
  }) => void;
  aoMover: (passo: -1 | 1) => void;
}

function Miniatura({
  comerciante,
  imagem,
  variantes,
  edicao,
}: {
  comerciante: string;
  imagem: ImagemArtigo;
  variantes: VarianteArtigo[];
  /** As acções da §13.1, para quem tem catalog:write; null para os outros. */
  edicao: EdicaoDaImagem | null;
}) {
  const { t, lingua, navegar } = useHub();
  const [aEditar, setAEditar] = useState(false);
  const [rascunho, setRascunho] = useState(imagem.texto_alternativo ?? "");
  const [endereco, setEndereco] = useState<string | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  // Cada «Tentar outra vez» volta a pedir os bytes desta imagem.
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    let criado: string | null = null;
    setFalha(null);
    api.bytesDaImagem(comerciante, imagem.id).then(
      (bytes) => {
        if (!vivo) return;
        criado = URL.createObjectURL(bytes);
        setEndereco(criado);
      },
      (e: unknown) => {
        if (!vivo) return;
        if (semSessao(e)) {
          navegar("/entrar", { substituir: true });
          return;
        }
        setFalha(e);
      },
    );
    return () => {
      vivo = false;
      if (criado !== null) URL.revokeObjectURL(criado);
    };
  }, [comerciante, imagem.id, navegar, tentativa]);

  const texto = imagem.texto_alternativo;
  const temTexto = texto !== null && texto.trim() !== "";
  const sku =
    imagem.variante === null
      ? null
      : (variantes.find((v) => v.id === imagem.variante)?.sku ?? null);
  return (
    <li>
      <figure>
        <div className="moldura-imagem">
          {endereco !== null ? (
            <img src={endereco} alt={temTexto ? texto : ""} />
          ) : falha !== null ? (
            <div className="falha-imagem">
              <p className="secundario" role="alert">
                {mensagemDeErro(falha, t, lingua).texto}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTentativa((n) => n + 1);
                }}
              >
                {t.tentarOutraVez}
              </button>
            </div>
          ) : (
            <p className="secundario">{t.aCarregar}</p>
          )}
        </div>
        <figcaption>
          {imagem.principal ? (
            <strong className="marca-principal">
              {t.artigoImagemPrincipal}
            </strong>
          ) : null}
          {temTexto ? (
            // O leitor de ecrã já o lê no alt da imagem: aqui é só para a
            // vista, sem o ler duas vezes (revisão do #206, P3-5).
            <span aria-hidden="true">{texto}</span>
          ) : (
            <span className="aviso-texto">{t.artigoSemTextoAlternativo}</span>
          )}
          {sku === null ? null : (
            <span className="secundario">
              {preencher(t.artigoImagemDaVariante, { sku })}
            </span>
          )}
        </figcaption>
      </figure>
      {edicao === null ? null : aEditar ? (
        <form
          className="editar-imagem"
          onSubmit={(e) => {
            e.preventDefault();
            const limpo = rascunho.trim();
            edicao.aoGuardar({
              texto_alternativo: limpo === "" ? null : limpo,
            });
            setAEditar(false);
          }}
        >
          <div className="campo">
            <label htmlFor={`alt-${imagem.id}`}>
              {t.artigoTextoAlternativo}
            </label>
            <input
              id={`alt-${imagem.id}`}
              maxLength={500}
              value={rascunho}
              onChange={(e) => {
                setRascunho(e.target.value);
              }}
            />
          </div>
          <div className="accoes-imagem">
            <button type="submit" disabled={edicao.ocupado}>
              {t.artigoGuardar}
            </button>
            <button
              type="button"
              onClick={() => {
                setRascunho(imagem.texto_alternativo ?? "");
                setAEditar(false);
              }}
            >
              {t.cancelar}
            </button>
          </div>
        </form>
      ) : (
        <div className="accoes-imagem">
          <button
            type="button"
            disabled={edicao.ocupado}
            onClick={() => {
              setRascunho(imagem.texto_alternativo ?? "");
              setAEditar(true);
            }}
          >
            {t.artigoEditarTexto}
          </button>
          {imagem.principal ? null : (
            <button
              type="button"
              disabled={edicao.ocupado}
              onClick={() => {
                edicao.aoGuardar({ principal: true });
              }}
            >
              {t.artigoTornarPrincipal}
            </button>
          )}
          {edicao.primeira ? null : (
            <button
              type="button"
              disabled={edicao.ocupado}
              onClick={() => {
                edicao.aoMover(-1);
              }}
            >
              {t.artigoMoverAntes}
            </button>
          )}
          {edicao.ultima ? null : (
            <button
              type="button"
              disabled={edicao.ocupado}
              onClick={() => {
                edicao.aoMover(1);
              }}
            >
              {t.artigoMoverDepois}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Publicacoes({
  publicacoes,
  data,
}: {
  publicacoes: PublicacaoArtigo[];
  data: (iso: string) => string;
}) {
  const { t } = useHub();
  // A data do estado em que está: publicada, arquivada ou verificada.
  const quando = (p: PublicacaoArtigo) =>
    p.estado === "arquivado"
      ? p.arquivado_em
      : p.estado === "publicado"
        ? p.publicado_em
        : p.verificado_em;
  return (
    // Cinco colunas, duas com identificadores longos: cartões até 960 px,
    // como as chaves (revisão do #206, P2-2).
    <table className="tabela-larga">
      <thead>
        <tr>
          <th scope="col">{t.colunaCanal}</th>
          <th scope="col">{t.colunaMercado}</th>
          <th scope="col">{t.colunaEstado}</th>
          <th scope="col">{t.colunaData}</th>
          <th scope="col">{t.colunaMotivo}</th>
        </tr>
      </thead>
      <tbody>
        {publicacoes.map((p) => {
          const d = quando(p);
          return (
            <tr key={p.id}>
              {/* Só o identificador: a API ainda não dá os nomes (§12.2). */}
              <td data-rotulo={t.colunaCanal}>
                <code translate="no">{p.canal}</code>
              </td>
              <td data-rotulo={t.colunaMercado}>
                <code translate="no">{p.mercado}</code>
              </td>
              <td data-rotulo={t.colunaEstado}>
                {textoDe(t, `estadoPublicacao_${p.estado}`, p.estado)}
              </td>
              <td data-rotulo={t.colunaData}>{d === null ? "—" : data(d)}</td>
              <td data-rotulo={t.colunaMotivo}>
                {p.motivo_arquivo === null
                  ? "—"
                  : textoDe(
                      t,
                      `motivoArquivo_${p.motivo_arquivo}`,
                      p.motivo_arquivo,
                    )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
