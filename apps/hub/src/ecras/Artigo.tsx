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

// A ficha do artigo, só para consulta (docs/22 §12.2): o artigo com as
// variantes, as imagens e as publicações, pelas mesmas funções da API
// (GET /hub/products/{id}, …/media, /hub/media/{id}/file e
// …/publications). Cada parte carrega e falha sozinha; o cabeçalho
// primeiro, as imagens e as publicações depois de o artigo existir.

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
      const dados = await api.artigo(comerciante, artigo);
      if (!montado.current) return;
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
          <Cabecalho ficha={ficha.dados} data={data} />
          <h2>{t.artigoDescricao}</h2>
          {ficha.dados.descricao === null ||
          ficha.dados.descricao.trim() === "" ? (
            <p className="secundario">{t.artigoSemDescricao}</p>
          ) : (
            <p className="descricao-artigo">{ficha.dados.descricao}</p>
          )}
          <h2>{t.artigoVariantes}</h2>
          <Variantes variantes={ficha.dados.variantes} />
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
              {imagens.dados.map((m) => (
                <Miniatura
                  key={m.id}
                  comerciante={comerciante}
                  imagem={m}
                  variantes={ficha.dados.variantes}
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

function Cabecalho({
  ficha,
  data,
}: {
  ficha: FichaArtigo;
  data: (iso: string) => string;
}) {
  const { t } = useHub();
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
    </div>
  );
}

function Variantes({ variantes }: { variantes: VarianteArtigo[] }) {
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
function Miniatura({
  comerciante,
  imagem,
  variantes,
}: {
  comerciante: string;
  imagem: ImagemArtigo;
  variantes: VarianteArtigo[];
}) {
  const { t, lingua, navegar } = useHub();
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
