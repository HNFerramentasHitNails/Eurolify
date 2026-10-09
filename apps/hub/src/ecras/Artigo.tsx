import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  EnvioCancelado,
  enviarImagem,
  ErroHub,
  TAMANHO_MAXIMO_IMAGEM,
  TIPOS_DE_IMAGEM,
  type FichaArtigo,
  type ImagemArtigo,
  type PublicacaoArtigo,
  type VarianteArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { PrecosDoArtigo } from "./PrecosDoArtigo";
import { celulaDoCanal, celulaDoMercado, type Celula } from "../publicacoes";
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
  // O histórico (docs/22 §16): só com catalog:history (o dono e o gestor).
  const [podeVerHistorico, setPodeVerHistorico] = useState(false);
  // Uma acção de cada vez; o erro dela fica à vista até à seguinte.
  const [ocupado, setOcupado] = useState(false);
  // Mover uma imagem que gravou uma parte e falhou na outra.
  const [ordemAMeio, setOrdemAMeio] = useState(false);
  const [falhaAccao, setFalhaAccao] = useState<unknown>(null);
  // Um envio de imagem em curso: as outras acções da ficha esperam, para a
  // ligação no fim não encontrar outra acção a meio (revisão do #235, P3-3).
  const [aEnviarImagem, setAEnviarImagem] = useState(false);
  const ocupadoNaFicha = ocupado || aEnviarImagem;
  const [aviso, setAviso] = useState<Aviso | null>(() => {
    const q = new URLSearchParams(consulta);
    if (q.get("criado") === "1") return "criado";
    // A resposta de criar perdeu-se e o artigo já lá estava (§14.2).
    if (q.get("criado") === "ja") return "jaCriado";
    return q.get("guardado") === "1" ? "guardado" : null;
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

  // Só a resposta do último pedido de cada parte conta: uma acção recarrega
  // sem esperar, e uma resposta antiga que chegue depois repunha o que outra
  // gravação já mudou (issue #251).
  const ultimaFicha = useRef(0);
  const ultimasImagens = useRef(0);
  const ultimasPublicacoes = useRef(0);

  // `manter`: depois de uma acção, recarrega sem tirar a parte do ecrã, para
  // o foco e as miniaturas ficarem (revisão do #217, P2-2 e P3-8).
  const carregarImagens = useCallback(
    async (manter = false) => {
      if (!valido) return;
      const este = ++ultimasImagens.current;
      if (!manter) setImagens({ tipo: "a_carregar" });
      try {
        const dados = await api.imagensDoArtigo(comerciante, artigo);
        if (este !== ultimasImagens.current) return;
        if (montado.current) setImagens({ tipo: "pronto", dados });
      } catch (e) {
        if (este !== ultimasImagens.current) return;
        aoFalhar(e, (erro) => {
          setImagens({ tipo: "erro", erro });
        });
      }
    },
    [valido, comerciante, artigo, aoFalhar],
  );

  // `manter`: depois de uma acção, recarrega sem tirar a parte do ecrã, para
  // o foco e as miniaturas ficarem (revisão do #217, P2-2 e P3-8).
  const carregarPublicacoes = useCallback(
    async (manter = false) => {
      if (!valido) return;
      const este = ++ultimasPublicacoes.current;
      if (!manter) setPublicacoes({ tipo: "a_carregar" });
      try {
        const r = await api.publicacoesDoArtigo(comerciante, artigo);
        if (este !== ultimasPublicacoes.current) return;
        if (montado.current) setPublicacoes({ tipo: "pronto", dados: r.dados });
      } catch (e) {
        if (este !== ultimasPublicacoes.current) return;
        aoFalhar(e, (erro) => {
          setPublicacoes({ tipo: "erro", erro });
        });
      }
    },
    [valido, comerciante, artigo, aoFalhar],
  );

  const carregarFicha = useCallback(
    async (manter = false) => {
      if (!valido) return;
      const este = ++ultimaFicha.current;
      if (!manter) setFicha({ tipo: "a_carregar" });
      try {
        const [dados, eu] = await Promise.all([
          api.artigo(comerciante, artigo),
          api.eu(),
        ]);
        if (este !== ultimaFicha.current || !montado.current) return;
        const ambitos =
          eu.comerciantes.find((c) => c.comerciante === comerciante)?.ambitos ??
          [];
        setPodeEscrever(ambitos.includes("catalog:write"));
        setPodeVerHistorico(ambitos.includes("catalog:history"));
        setFicha({ tipo: "pronto", dados });
        void carregarImagens(manter);
        void carregarPublicacoes(manter);
      } catch (e) {
        if (este !== ultimaFicha.current) return;
        aoFalhar(e, (erro) => {
          setFicha({ tipo: "erro", erro });
        });
      }
    },
    [
      valido,
      comerciante,
      artigo,
      aoFalhar,
      carregarImagens,
      carregarPublicacoes,
    ],
  );

  useEffect(() => {
    void carregarFicha();
  }, [carregarFicha]);

  // A marca «guardado» (vinda da edição) ou «criado» (vinda de criar,
  // docs/22 §14.4) sai do endereço: recarregar a página não volta a dizê-lo.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("guardado") === null && q.get("criado") === null) return;
    q.delete("guardado");
    q.delete("criado");
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${q.toString()}`,
    );
  }, []);

  // O aviso de que gravou recebe o foco: o botão usado pode ter saído do
  // ecrã (revisão do #217, P2-2 e P3-6).
  // O foco muda depois de o React pôr o aviso no ecrã e antes de o pintar:
  // um pedido de animação podia chegar antes do aviso e perder-se. Ao abrir
  // vindo da edição ou de criar, o aviso só aparece quando a ficha chega.
  const avisoRef = useRef<HTMLParagraphElement>(null);
  const avisoPorFocar = useRef(aviso !== null);
  const focarAviso = () => {
    avisoPorFocar.current = true;
  };
  useLayoutEffect(() => {
    if (!avisoPorFocar.current || avisoRef.current === null) return;
    avisoPorFocar.current = false;
    avisoRef.current.focus();
  }, [aviso, ficha.tipo]);

  // O mesmo para a falha de uma acção (issue #251).
  const erroRef = useRef<HTMLDivElement>(null);
  const erroPorFocar = useRef(false);
  useLayoutEffect(() => {
    if (!erroPorFocar.current || erroRef.current === null) return;
    erroPorFocar.current = false;
    erroRef.current.focus();
  }, [falhaAccao, ordemAMeio]);

  /**
   * Corre uma acção da §13 e diz se gravou. Um conflito de versão (outra
   * pessoa mudou) ou um 404 recarregam a ficha, para o ecrã mostrar o que
   * está guardado agora.
   */
  async function agir(
    fn: () => Promise<void>,
    avisoFinal: Aviso = "guardado",
  ): Promise<boolean> {
    if (ocupado) return false;
    setOcupado(true);
    setFalhaAccao(null);
    setOrdemAMeio(false);
    setAviso(null);
    try {
      await fn();
      if (!montado.current) return false;
      setAviso(avisoFinal);
      focarAviso();
      return true;
    } catch (e) {
      if (!montado.current) return false;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return false;
      }
      setFalhaAccao(e);
      erroPorFocar.current = true;
      if (e instanceof ErroHub && (e.estado === 409 || e.estado === 404)) {
        void carregarFicha(true);
      }
      return false;
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
      // Uma leitura da ficha ainda a caminho é mais antiga do que isto.
      ultimaFicha.current++;
      setFicha({ tipo: "pronto", dados });
      // Arquivar arquiva as publicações (§4.1).
      void carregarPublicacoes(true);
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
      await carregarFicha(true);
    });
  }

  /**
   * Grava uma imagem e recarrega as imagens e as publicações (C2). Diz se
   * gravou: o formulário do texto só fecha se sim (revisão do #217, P2-3).
   */
  function guardarImagem(
    m: ImagemArtigo,
    corpo: { texto_alternativo?: string | null; principal?: boolean },
  ): Promise<boolean> {
    if (!valido) return Promise.resolve(false);
    return agir(async () => {
      await api.alterarImagem(comerciante, m.id, {
        versao: m.versao,
        ...corpo,
      });
      if (!montado.current) return;
      void carregarImagens(true);
      void carregarPublicacoes(true);
    });
  }

  /** Tira a imagem do artigo, com confirmação (docs/22 §15.4). */
  function tirarImagem(m: ImagemArtigo) {
    if (!valido || !window.confirm(t.artigoConfirmarTirarImagem)) return;
    void agir(async () => {
      await api.tirarImagem(comerciante, m.id);
      if (!montado.current) return;
      await carregarImagens(true);
      void carregarPublicacoes(true);
    }, "imagemTirada");
  }

  /**
   * Liga um ficheiro já enviado ao artigo (docs/22 §15.2). Uma resposta
   * perdida relê as imagens: se o ficheiro já lá está, ficou ligado (a base
   * não impede o mesmo ficheiro duas vezes). Diz se ficou ligado.
   */
  function ligarImagem(
    ficheiro: string,
    textoAlternativo: string | null,
  ): Promise<boolean> {
    if (!valido || imagens.tipo !== "pronto") return Promise.resolve(false);
    const principal = imagens.dados.length === 0;
    // As imagens de antes: depois de uma resposta perdida, só conta uma
    // imagem NOVA com este ficheiro (o mesmo ficheiro dá o mesmo fil_, e o
    // artigo pode já o ter; revisão do #235, P2-3).
    const antes = new Set(imagens.dados.map((m) => m.id));
    return agir(async () => {
      try {
        await api.ligarImagem(comerciante, artigo, {
          ficheiro,
          texto_alternativo: textoAlternativo,
          principal,
        });
      } catch (e) {
        const semResposta =
          !(e instanceof ErroHub) ||
          e.estado === 0 ||
          (e.estado >= 500 && e.codigo === undefined);
        if (!semResposta) throw e;
        const agora = await api.imagensDoArtigo(comerciante, artigo);
        const nova = agora.some(
          (m) => m.ficheiro.id === ficheiro && !antes.has(m.id),
        );
        if (!nova) throw e;
      }
      if (!montado.current) return;
      await carregarImagens(true);
      void carregarPublicacoes(true);
    }, "imagemAcrescentada");
  }

  /**
   * Troca uma imagem com a vizinha (a API ordena pela posição e depois pelo
   * id): duas gravações, as das duas imagens (revisão do #217, P2-4). Se as
   * duas tiverem a mesma posição, a ordem nova grava-se em posições 0, 1,
   * 2…. Não é atómico: se falhar a meio, o ecrã di-lo e mostra o que ficou;
   * uma rota de ordem atómica fica pedida ao dono do catálogo (#77).
   */
  function moverImagem(indice: number, para: number) {
    if (imagens.tipo !== "pronto" || !valido) return;
    const a = imagens.dados[indice];
    const b = imagens.dados[para];
    if (a === undefined || b === undefined) return;
    let escritas: { m: ImagemArtigo; posicao: number }[];
    if (a.posicao !== b.posicao) {
      escritas = [
        { m: a, posicao: b.posicao },
        { m: b, posicao: a.posicao },
      ];
    } else {
      const ordem = [...imagens.dados];
      ordem.splice(indice, 1);
      ordem.splice(para, 0, a);
      escritas = ordem
        .map((m, posicao) => ({ m, posicao }))
        .filter(({ m, posicao }) => m.posicao !== posicao);
    }
    let feitas = 0;
    void agir(async () => {
      try {
        for (const { m, posicao } of escritas) {
          await api.alterarImagem(comerciante, m.id, {
            versao: m.versao,
            posicao,
          });
          feitas++;
        }
      } catch (e) {
        if (feitas > 0 && montado.current) setOrdemAMeio(true);
        throw e;
      } finally {
        // Também se uma das gravações falhar: o ecrã mostra o que ficou.
        if (montado.current) void carregarImagens(true);
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
            ocupado={ocupadoNaFicha}
            destinoEditar={`/artigos/${artigo}/editar?${voltar.toString()}`}
            destinoHistorico={
              podeVerHistorico
                ? `/artigos/${artigo}/historico?${voltar.toString()}`
                : null
            }
            aoMudarEstado={mudarEstado}
          />
          {aviso === null ? null : (
            <p
              className="secundario"
              role="status"
              tabIndex={-1}
              ref={avisoRef}
            >
              {t[TEXTO_DO_AVISO[aviso]]}
            </p>
          )}
          {falhaAccao === null && !ordemAMeio ? null : (
            // O foco vem para aqui quando uma acção falha: o botão usado
            // esteve desactivado e o foco ia para o início da página (#251).
            <div tabIndex={-1} ref={erroRef} className="falha-accao">
              {ordemAMeio ? (
                <p className="erro-campo" role="alert">
                  {t.artigoOrdemAMeio}
                </p>
              ) : null}
              {falhaAccao === null ? null : (
                <CaixaDeErro erro={mensagemDeErro(falhaAccao, t, lingua)} />
              )}
            </div>
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
            ocupado={ocupadoNaFicha}
            aoArquivar={arquivarVariante}
          />
          <h2>{t.artigoPrecos}</h2>
          <div className="precos-artigo">
            <PrecosDoArtigo
              comerciante={comerciante}
              artigo={artigo}
              variantes={ficha.dados.variantes}
            />
          </div>
          <h2>{t.artigoImagens}</h2>
          {podeEscrever && imagens.tipo === "pronto" ? (
            <NovaImagem
              comerciante={comerciante}
              ocupado={ocupado}
              publicado={
                publicacoes.tipo === "pronto" &&
                publicacoes.dados.some((x) => x.estado === "publicado")
              }
              aoEnviar={setAEnviarImagem}
              aoLigar={ligarImagem}
            />
          ) : null}
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
                          ocupado: ocupadoNaFicha,
                          primeira: i === 0,
                          ultima: i === todas.length - 1,
                          aoGuardar: (corpo) => guardarImagem(m, corpo),
                          aoTirar: () => {
                            tirarImagem(m);
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
export function textoDe(t: Textos, chave: string, valor: string): string {
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
  destinoHistorico,
  aoMudarEstado,
}: {
  ficha: FichaArtigo;
  data: (iso: string) => string;
  podeEscrever: boolean;
  ocupado: boolean;
  destinoEditar: string;
  /** null para quem não tem catalog:history. */
  destinoHistorico: string | null;
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
        {destinoHistorico === null ? null : (
          <>
            {" · "}
            <a
              href={destinoHistorico}
              onClick={(e) => {
                e.preventDefault();
                navegar(destinoHistorico);
              }}
            >
              {t.artigoHistorico}
            </a>
          </>
        )}
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
    <table className="tabela-larga variantes-artigo">
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
  /** Diz se gravou: o formulário do texto só fecha se sim. */
  aoGuardar: (corpo: {
    texto_alternativo?: string | null;
    principal?: boolean;
  }) => Promise<boolean>;
  aoMover: (passo: -1 | 1) => void;
  aoTirar: () => void;
}

/** Os avisos de que uma acção gravou, e o texto de cada um. */
type Aviso =
  "guardado" | "criado" | "jaCriado" | "imagemAcrescentada" | "imagemTirada";
const TEXTO_DO_AVISO: Record<Aviso, keyof Textos> = {
  guardado: "artigoGuardado",
  criado: "artigoCriado",
  jaCriado: "artigoJaCriado",
  imagemAcrescentada: "artigoImagemAcrescentada",
  imagemTirada: "artigoImagemTirada",
};

/** O erro de um envio, em linguagem comum (docs/22 §15.4). */
function erroDoEnvio(erro: unknown): keyof Textos | null {
  if (!(erro instanceof ErroHub)) return null;
  if (erro.estado === 413) return "artigoImagemGrande";
  if (erro.codigo === "media_type.unsupported") return "artigoImagemTipo";
  if (erro.codigo === "request.invalid") return "artigoImagemIlegivel";
  // O limite dos envios do comerciante e o limite geral por IP dão o mesmo
  // código: o texto serve aos dois (revisão do #235, P3-1).
  if (erro.codigo === "rate_limit.exceeded") return "artigoImagemOutroEnvio";
  if (erro.codigo === "catalog.media_quota_exceeded") {
    return "artigoImagemSemEspaco";
  }
  return null;
}

/**
 * O tipo verdadeiro de uma imagem, pelos primeiros bytes: um PNG gravado
 * como `.jpg` vai como PNG (revisão do #235, P3-2). A API confere na mesma;
 * se não for nenhum dos três, fica o tipo que o navegador deu.
 */
async function tipoDaImagem(f: File): Promise<string> {
  const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
  const comeca = (...xs: number[]) => xs.every((x, i) => b[i] === x);
  if (comeca(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (comeca(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  const riff = String.fromCharCode(...b.slice(0, 4));
  const webp = String.fromCharCode(...b.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return f.type;
}

/**
 * Acrescentar uma imagem (docs/22 §15.4): escolher o ficheiro, ver a
 * pré-visualização, escrever o texto alternativo e guardar. Os bytes vão
 * primeiro (com o progresso e «Cancelar»); depois liga-se ao artigo. O
 * ecrã confere o tipo e o tamanho antes de enviar; a API confere na mesma.
 */
function NovaImagem({
  comerciante,
  ocupado,
  publicado,
  aoEnviar,
  aoLigar,
}: {
  comerciante: string;
  ocupado: boolean;
  /** O artigo está à venda nalguma loja: guardar sem texto tira-o (C2). */
  publicado: boolean;
  /** Avisa a ficha de que há um envio em curso. */
  aoEnviar: (emCurso: boolean) => void;
  aoLigar: (ficheiro: string, texto: string | null) => Promise<boolean>;
}) {
  const { t, lingua, navegar } = useHub();
  const entrada = useRef<HTMLInputElement>(null);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [semTexto, setSemTexto] = useState(false);
  const [recusa, setRecusa] = useState<keyof Textos | null>(null);
  // Muda em cada recusa, também na mesma duas vezes: o foco volta a ir para
  // onde deve (revisão do #235, P3-5).
  const [vezes, setVezes] = useState(0);
  const [falha, setFalha] = useState<unknown>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [aLigar, setALigar] = useState(false);
  // O ficheiro já enviado: se ligar falhar, não se volta a enviar.
  const [enviado, setEnviado] = useState<string | null>(null);
  const cancelar = useRef<AbortController | null>(null);
  const focarDepois = useRef<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      cancelar.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (escolhido === null) return;
    const url = URL.createObjectURL(escolhido);
    setPrevia(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [escolhido]);
  // O foco muda antes de pintar (como na ficha, revisão do #223).
  useLayoutEffect(() => {
    if (focarDepois.current === null) return;
    document.getElementById(focarDepois.current)?.focus();
    focarDepois.current = null;
  }, [escolhido, vezes, falha, progresso, aLigar]);
  const aindaAqui = () => vivo.current;

  function recusar(chave: keyof Textos, foco: string) {
    setRecusa(chave);
    setVezes((n) => n + 1);
    focarDepois.current = foco;
  }

  function limpar() {
    setEscolhido(null);
    setPrevia(null);
    setTexto("");
    setSemTexto(false);
    setRecusa(null);
    setFalha(null);
    setProgresso(null);
    setEnviado(null);
    if (entrada.current !== null) entrada.current.value = "";
    focarDepois.current = "nova-imagem-botao";
    setVezes((n) => n + 1);
  }

  function aoEscolher(f: File | undefined) {
    setFalha(null);
    if (f === undefined) return;
    if (!TIPOS_DE_IMAGEM.includes(f.type)) {
      setEscolhido(null);
      recusar("artigoImagemTipo", "nova-imagem-recusa");
      return;
    }
    if (f.size > TAMANHO_MAXIMO_IMAGEM) {
      setEscolhido(null);
      recusar("artigoImagemGrande", "nova-imagem-recusa");
      return;
    }
    setRecusa(null);
    setEnviado(null);
    setEscolhido(f);
    focarDepois.current = "nova-imagem-texto";
  }

  async function guardar(e: React.SyntheticEvent) {
    e.preventDefault();
    if (escolhido === null || progresso !== null || aLigar || ocupado) return;
    const limpo = texto.trim();
    if (limpo === "" && !semTexto) {
      recusar("artigoImagemSemTexto", "nova-imagem-texto");
      return;
    }
    // Sem texto, num artigo à venda: a API reverifica as publicações e as
    // que não passam saem de venda; escrever o texto depois não as repõe
    // (revisão do #235, P2-1).
    if (
      limpo === "" &&
      publicado &&
      !window.confirm(t.artigoImagemSemTextoConfirmar)
    ) {
      return;
    }
    setRecusa(null);
    setFalha(null);
    let ficheiro = enviado;
    if (ficheiro === null) {
      const controlo = new AbortController();
      cancelar.current = controlo;
      setProgresso(0);
      aoEnviar(true);
      try {
        const tipo = await tipoDaImagem(escolhido);
        const r = await enviarImagem(
          comerciante,
          tipo === escolhido.type
            ? escolhido
            : escolhido.slice(0, escolhido.size, tipo),
          (p) => {
            if (aindaAqui()) setProgresso(p);
          },
          controlo.signal,
        );
        ficheiro = r.id;
        if (aindaAqui()) setEnviado(r.id);
      } catch (erro) {
        if (!aindaAqui()) return;
        setProgresso(null);
        if (erro instanceof EnvioCancelado) return;
        if (semSessao(erro)) {
          navegar("/entrar", { substituir: true });
          return;
        }
        const chave = erroDoEnvio(erro);
        if (chave !== null) recusar(chave, "nova-imagem-recusa");
        else {
          setFalha(erro);
          focarDepois.current = "nova-imagem-recusa";
        }
        return;
      } finally {
        cancelar.current = null;
        if (aindaAqui()) aoEnviar(false);
      }
    }
    if (!aindaAqui()) return;
    setProgresso(null);
    setALigar(true);
    try {
      const ligou = await aoLigar(ficheiro, limpo === "" ? null : limpo);
      if (ligou && aindaAqui()) limpar();
    } finally {
      if (aindaAqui()) setALigar(false);
    }
  }

  const erro =
    recusa !== null
      ? t[recusa]
      : falha !== null
        ? mensagemDeErro(falha, t, lingua).texto
        : null;
  const textoEmFalta = recusa === "artigoImagemSemTexto";
  // Anunciado de 25 em 25 %, para um leitor de ecrã não ler cada 1 %
  // (revisão do #235, P3-6); a barra mostra o valor certo.
  const degrau = progresso === null ? null : Math.floor(progresso / 25) * 25;

  return (
    <div className="nova-imagem">
      <input
        ref={entrada}
        id="nova-imagem-ficheiro"
        type="file"
        accept={TIPOS_DE_IMAGEM.join(",")}
        className="so-leitores"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          aoEscolher(e.target.files?.[0]);
        }}
      />
      {escolhido === null ? (
        <p>
          <button
            type="button"
            id="nova-imagem-botao"
            disabled={ocupado}
            aria-describedby="nova-imagem-regras"
            onClick={() => entrada.current?.click()}
          >
            {t.artigoAcrescentarImagem}
          </button>{" "}
          <span id="nova-imagem-regras" className="secundario">
            {t.artigoImagemRegras}
          </span>
        </p>
      ) : (
        <form className="editar-imagem" onSubmit={(e) => void guardar(e)}>
          <div className="previa-imagem">
            {previa === null ? null : <img src={previa} alt="" />}
            <p className="secundario">
              {preencher(t.artigoImagemEscolhida, {
                nome: escolhido.name,
                tamanho: tamanhoLegivel(escolhido.size, lingua),
              })}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="nova-imagem-texto">
              {t.artigoTextoAlternativo}
            </label>
            <input
              id="nova-imagem-texto"
              maxLength={500}
              value={texto}
              aria-invalid={textoEmFalta}
              aria-describedby={
                textoEmFalta
                  ? "nova-imagem-recusa nova-imagem-ajuda"
                  : "nova-imagem-ajuda"
              }
              onChange={(e) => {
                setTexto(e.target.value);
                if (textoEmFalta) setRecusa(null);
              }}
            />
            <p id="nova-imagem-ajuda" className="secundario">
              {t.artigoImagemTextoAjuda}
            </p>
          </div>
          <label className="opcao">
            <input
              type="checkbox"
              checked={semTexto}
              onChange={(e) => {
                setSemTexto(e.target.checked);
                if (textoEmFalta) setRecusa(null);
              }}
            />
            {t.artigoImagemSemTextoAgora}
          </label>
          {progresso === null ? null : (
            <div className="campo">
              <label htmlFor="nova-imagem-progresso">
                {t.artigoImagemProgresso}
              </label>
              <progress
                id="nova-imagem-progresso"
                max={100}
                value={progresso}
              />
              <p role="status" className="secundario">
                {preencher(t.artigoImagemAEnviar, { p: degrau ?? 0 })}
              </p>
            </div>
          )}
          <div className="accoes-imagem">
            <button
              type="submit"
              className="principal"
              disabled={ocupado || progresso !== null || aLigar}
            >
              {aLigar ? t.aCarregar : t.artigoGuardar}
            </button>
            {/* Enquanto liga, já não se cancela: a imagem ficava ligada sem
                aviso (revisão do #235, P3-4). */}
            <button
              type="button"
              disabled={aLigar}
              onClick={() => {
                if (progresso !== null) {
                  cancelar.current?.abort();
                  setProgresso(null);
                  return;
                }
                limpar();
              }}
            >
              {t.cancelar}
            </button>
          </div>
        </form>
      )}
      {erro === null ? null : (
        <p
          id="nova-imagem-recusa"
          className="erro-campo"
          role="alert"
          tabIndex={-1}
        >
          {erro}
        </p>
      )}
    </div>
  );
}

/** «2,4 MB», «850 KB»: o tamanho do ficheiro na língua do ecrã. */
function tamanhoLegivel(bytes: number, lingua: string): string {
  const mb = bytes / (1024 * 1024);
  const f = new Intl.NumberFormat(lingua, { maximumFractionDigits: 1 });
  return mb >= 1 ? `${f.format(mb)} MB` : `${f.format(bytes / 1024)} KB`;
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
            // Só fecha se gravou: num erro, o que se escreveu fica à vista
            // (revisão do #217, P2-3).
            void edicao
              .aoGuardar({ texto_alternativo: limpo === "" ? null : limpo })
              .then((gravou) => {
                if (gravou) setAEditar(false);
              });
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
                void edicao.aoGuardar({ principal: true });
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
          <button
            type="button"
            disabled={edicao.ocupado}
            onClick={edicao.aoTirar}
          >
            {t.artigoTirarImagem}
          </button>
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
    // Cinco colunas (e, sem o nome, um identificador longo): cartões até
    // 960 px, como as chaves (revisão do #206, P2-2).
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
              {/* O nome; a loja ou o identificador por baixo só quando o
                  nome se repete (§18.2, §19.2). */}
              <td data-rotulo={t.colunaCanal}>
                <CelulaPublicacao celula={celulaDoCanal(publicacoes, p)} />
              </td>
              <td data-rotulo={t.colunaMercado}>
                <CelulaPublicacao celula={celulaDoMercado(publicacoes, p)} />
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

/** O canal ou o mercado de uma publicação (docs/22 §19.2). */
function CelulaPublicacao({ celula }: { celula: Celula }) {
  const { t } = useHub();
  switch (celula.tipo) {
    case "identificador":
      return <code translate="no">{celula.identificador}</code>;
    case "nome":
      return <>{celula.nome}</>;
    case "nome_e_loja":
      return (
        <>
          {celula.nome}
          <br />
          <span className="secundario">
            {/* Só para leitores de ecrã: diz que é a loja (decisão do
                Diogo, 09/10/2026; revisão do #275, P3-6). */}
            <span className="so-leitores">{t.publicacaoLoja} </span>
            {celula.loja}
          </span>
        </>
      );
    case "nome_e_identificador":
      return (
        <>
          {celula.nome}
          <br />
          <code className="secundario" translate="no">
            {celula.identificador}
          </code>
        </>
      );
  }
}
