import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroHub, type Eu } from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import { falhaDeAccao, mensagemDeErro, semSessao } from "../erros";
import {
  CHAVE_PEDIDO_MOLONI,
  enderecoFaturacao,
  enderecoOss,
  estadoMostrado,
  hojeEm,
  ligacaoDaEntidade,
  lerPedidoMoloni,
  nomeDoPeriodo,
  regressoDe,
  resumoDoPeriodo,
  ultimoTrimestreAcabado,
  type EntidadeFaturacao,
  type Faturacao as DadosFaturacao,
  type LigacaoFaturacao,
  talvezFeito,
  type PedidoMoloni,
  type RelatorioOss,
} from "../faturacao";
import { entradaDe } from "../modulos";
import { comRecente } from "../passkeys";
import { horasDesde } from "../tarefas";
import { preencher, TAG_LINGUA, type Lingua, type Textos } from "../textos";
import { Dialogo } from "./Dialogo";

// O ecrã «Faturação» (docs/22 §30; Q1 em A): por entidade legal, a ligação
// ao software de faturação (ligar, ligar outra vez e testar, só o dono) e a
// entrada para o relatório OSS do último trimestre acabado. Criar a ligação
// e os mapas fica pela integração. Quem pode o quê decide-o a API.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const EMPRESA = /^[0-9]{1,12}$/;

type OssDaEntidade = { relatorio: RelatorioOss } | { falha: unknown };

/** «há 2 dias», com os textos do «A decidir». */
function haQuanto(t: Textos, desde: string): string {
  const h = horasDesde(desde, Date.now());
  if (h < 1) return t.decidirHaMenosDeUmaHora;
  if (h < 24) {
    return h === 1 ? t.decidirHaUmaHora : preencher(t.decidirHaHoras, { n: h });
  }
  const d = Math.floor(h / 24);
  return d === 1 ? t.decidirHaUmDia : preencher(t.decidirHaDias, { n: d });
}

const nomeDoAdaptador = (t: Textos, adaptador: string) =>
  (t as Record<string, string>)[`adaptador_${adaptador}`] ?? adaptador;

const dataCurta = (lingua: Lingua, iso: string) =>
  new Intl.DateTimeFormat(TAG_LINGUA[lingua], { dateStyle: "medium" }).format(
    new Date(iso),
  );

export function Faturacao({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const [eu, setEu] = useState<Eu | null>(null);
  const [dados, setDados] = useState<DadosFaturacao | null>(null);
  const [oss, setOss] = useState<Record<string, OssDaEntidade>>({});
  const [falha, setFalha] = useState<unknown>(null);
  const [aLigar, setALigar] = useState<LigacaoFaturacao | null>(null);
  const ultimo = useRef(0);
  const [periodo] = useState(() => ultimoTrimestreAcabado(hojeEm(new Date())));

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    setFalha(null);
    setDados(null);
    setOss({});
    try {
      const [quem, d] = await Promise.all([
        api.eu(),
        api.faturacao(comerciante),
      ]);
      if (este !== ultimo.current) return;
      setEu(quem);
      setDados(d);
      const ambitos =
        quem.comerciantes.find((c) => c.comerciante === comerciante)?.ambitos ??
        [];
      if (!ambitos.includes("tax:read")) return;
      // Um relatório por entidade; a falha de um não esconde os outros.
      await Promise.all(
        d.entidades.map(async (e) => {
          let r: OssDaEntidade;
          try {
            r = {
              relatorio: await api.relatorioOss(comerciante, e.id, periodo),
            };
          } catch (erro) {
            r = { falha: erro };
          }
          if (este !== ultimo.current) return;
          setOss((o) => ({ ...o, [e.id]: r }));
        }),
      );
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, navegar, periodo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** Relê só as ligações (depois de testar), sem tirar a página. */
  const relerLigacoes = useCallback(async () => {
    if (!valido) return;
    try {
      const d = await api.faturacao(comerciante);
      setDados(d);
    } catch {
      // Fica o que estava; a mensagem do teste já diz o resultado.
    }
  }, [valido, comerciante]);

  if (!valido) {
    return (
      <section aria-labelledby="titulo">
        <h1 id="titulo">{t.faturacaoTitulo}</h1>
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      </section>
    );
  }

  const meu = eu?.comerciantes.find((c) => c.comerciante === comerciante);
  const ambitos = meu?.ambitos ?? [];
  const varias = (dados?.entidades.length ?? 0) > 1;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.faturacaoTitulo}
        {meu === undefined ? "" : ` — ${meu.nome}`}
      </h1>
      <p className="secundario">{t.faturacaoExplicacao}</p>
      {falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : dados === null ? (
        <ACarregar />
      ) : dados.entidades.length === 0 ? (
        <p>{t.faturacaoSemEntidades}</p>
      ) : (
        dados.entidades.map((e) => (
          <Entidade
            key={e.id}
            entidade={e}
            varias={varias}
            ligacao={ligacaoDaEntidade(e.id, dados.ligacoes)}
            ambitos={ambitos}
            comerciante={comerciante}
            periodo={periodo}
            oss={oss[e.id]}
            ligar={setALigar}
            depoisDeTestar={relerLigacoes}
          />
        ))
      )}
      {aLigar === null ? null : (
        <DialogoLigar
          comerciante={comerciante}
          ligacao={aLigar}
          aoFechar={() => {
            setALigar(null);
          }}
        />
      )}
    </section>
  );
}

function Entidade({
  entidade: e,
  varias,
  ligacao: l,
  ambitos,
  comerciante,
  periodo,
  oss,
  ligar,
  depoisDeTestar,
}: {
  entidade: EntidadeFaturacao;
  varias: boolean;
  ligacao: LigacaoFaturacao | null;
  ambitos: readonly string[];
  comerciante: string;
  periodo: string;
  oss: OssDaEntidade | undefined;
  ligar: (l: LigacaoFaturacao) => void;
  depoisDeTestar: () => Promise<void>;
}) {
  const { t, lingua } = useHub();
  const Titulo = varias ? "h3" : "h2";
  const nome = preencher(t.faturacaoEntidade, { nome: e.nome, pais: e.pais });
  const conteudo = (
    <>
      <section aria-labelledby={`ligacao-${e.id}`} className="cartao">
        <Titulo id={`ligacao-${e.id}`}>{t.faturacaoLigacaoTitulo}</Titulo>
        {e.emissor === "sistema_proprio" ? (
          <p>{t.faturacaoSistemaProprio}</p>
        ) : e.emissor === "por_configurar" && l === null ? (
          <p>{t.faturacaoPorConfigurar}</p>
        ) : l === null ? (
          <p>{t.faturacaoSemLigacao}</p>
        ) : (
          <Ligacao
            ligacao={l}
            podeMudar={ambitos.includes("invoices:accounts")}
            ligar={ligar}
            comerciante={comerciante}
            depoisDeTestar={depoisDeTestar}
          />
        )}
      </section>
      {ambitos.includes("tax:read") ? (
        <section aria-labelledby={`oss-${e.id}`} className="cartao">
          <Titulo id={`oss-${e.id}`}>{t.faturacaoOssTitulo}</Titulo>
          <p>
            <LigacaoInterna href={enderecoOss(comerciante, e.id, periodo)}>
              {preencher(t.faturacaoOssAbrir, {
                periodo: nomeDoPeriodo(t, periodo),
              })}
            </LigacaoInterna>
          </p>
          {oss === undefined ? (
            <ACarregar />
          ) : "falha" in oss ? (
            <CaixaDeErro erro={mensagemDeErro(oss.falha, t, lingua)} />
          ) : (
            <p className="secundario">
              {resumoDoPeriodo(t, oss.relatorio, (iso) =>
                dataCurta(lingua, iso),
              )}
            </p>
          )}
        </section>
      ) : null}
    </>
  );
  if (!varias) {
    return (
      <>
        <p className="secundario">{nome}</p>
        {conteudo}
      </>
    );
  }
  return (
    <section aria-labelledby={`entidade-${e.id}`}>
      <h2 id={`entidade-${e.id}`}>{nome}</h2>
      {conteudo}
    </section>
  );
}

function Ligacao({
  ligacao: l,
  podeMudar,
  ligar,
  comerciante,
  depoisDeTestar,
}: {
  ligacao: LigacaoFaturacao;
  podeMudar: boolean;
  ligar: (l: LigacaoFaturacao) => void;
  comerciante: string;
  depoisDeTestar: () => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const [aTestar, setATestar] = useState(false);
  const [resultado, setResultado] = useState<{
    texto: string;
    erro: boolean;
  } | null>(null);
  const estado = estadoMostrado(l);

  async function testar() {
    setATestar(true);
    setResultado(null);
    try {
      const r = await api.testarLigacao(comerciante, l.id);
      setResultado(
        r.estado === "pronta"
          ? { texto: t.faturacaoTestePronto, erro: false }
          : {
              texto:
                r.erro === null
                  ? t.faturacaoTesteFalhouSemErro
                  : preencher(t.faturacaoTesteFalhou, { erro: r.erro }),
              erro: true,
            },
      );
      await depoisDeTestar();
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setResultado({ texto: mensagemDeErro(e, t, lingua).texto, erro: true });
    } finally {
      setATestar(false);
    }
  }

  return (
    <>
      <p>
        <strong>{nomeDoAdaptador(t, l.adaptador)}</strong>
        {l.modo === "teste" ? (
          <>
            {" · "}
            <span className="etiqueta">{t.faturacaoModoTeste}</span>
          </>
        ) : null}
        {" · "}
        <span className="estado-ligacao" data-estado={estado}>
          {t[`estadoLigacao_${estado}`]}
        </span>
      </p>
      <p className="secundario">
        {l.testada_em === null
          ? t.faturacaoNuncaTestada
          : preencher(t.faturacaoTestada, {
              quando: haQuanto(t, l.testada_em),
            })}
      </p>
      {l.erro === null ? null : (
        <p className="erro">
          {preencher(t.faturacaoUltimoErro, { erro: l.erro })}
        </p>
      )}
      {podeMudar && l.activa ? (
        <div className="accoes-tarefa">
          {l.adaptador === "moloni" ? (
            <button
              type="button"
              onClick={() => {
                ligar(l);
              }}
            >
              {l.credenciais_em === null
                ? t.faturacaoLigarMoloni
                : t.faturacaoLigarOutraVez}
            </button>
          ) : null}
          <button
            type="button"
            disabled={aTestar}
            onClick={() => void testar()}
          >
            {aTestar ? t.faturacaoATestar : t.faturacaoTestar}
          </button>
        </div>
      ) : null}
      {resultado === null ? null : (
        <p className={resultado.erro ? "erro" : "sucesso"} role="status">
          {resultado.texto}
        </p>
      )}
    </>
  );
}

function DialogoLigar({
  comerciante,
  ligacao,
  aoFechar,
}: {
  comerciante: string;
  ligacao: LigacaoFaturacao;
  aoFechar: () => void;
}) {
  const { t, lingua, navegar } = useHub();
  const [empresa, setEmpresa] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  async function continuar() {
    const numero = empresa.trim();
    if (!EMPRESA.test(numero)) {
      setErro(t.ligarEmpresaInvalida);
      return;
    }
    setErro(null);
    setAEnviar(true);
    try {
      const r = await comRecente(() =>
        api.autorizarLigacao(comerciante, ligacao.id, numero),
      );
      // Só um endereço https sai daqui (conferido antes de guardar nada;
      // revisão do #408, P3-2).
      if (!r.url.startsWith("https://")) {
        setErro(t.erroGenerico);
        setAEnviar(false);
        return;
      }
      // O pedido fica neste separador para o regresso (docs/22 §30.2).
      try {
        sessionStorage.setItem(
          CHAVE_PEDIDO_MOLONI,
          JSON.stringify({
            comerciante,
            ligacao: ligacao.id,
            estado: r.estado,
            expira_em: r.expira_em,
          }),
        );
      } catch {
        setErro(t.ligarSemArmazenamento);
        setAEnviar(false);
        return;
      }
      window.location.assign(r.url);
    } catch (e) {
      const f = await falhaDeAccao(e);
      if (f === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setErro(
        f instanceof ErroHub && f.codigo === "invoices.invalid_field"
          ? t.ligarEmpresaNaoTeste
          : f instanceof ErroHub && f.codigo === "invoices.not_configured"
            ? t.ligarNaoConfigurado
            : mensagemDeErro(f, t, lingua).texto,
      );
      setAEnviar(false);
    }
  }

  return (
    <Dialogo id="ligar" titulo={t.ligarTitulo} aoFechar={aoFechar}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void continuar();
        }}
      >
        <p>{t.ligarExplicacao}</p>
        <div className="campo">
          <label htmlFor="empresa-moloni">{t.ligarEmpresa}</label>
          <input
            id="empresa-moloni"
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            value={empresa}
            aria-describedby={`empresa-ajuda${erro === null ? "" : " empresa-erro"}`}
            onChange={(ev) => {
              setEmpresa(ev.target.value);
            }}
          />
          <p className="secundario" id="empresa-ajuda">
            {t.ligarEmpresaAjuda}
          </p>
        </div>
        {erro === null ? null : (
          <CaixaDeErro erro={{ texto: erro }} id="empresa-erro" />
        )}
        <div className="accoes-tarefa">
          <button type="submit" className="principal" disabled={aEnviar}>
            {aEnviar ? t.aCarregar : t.ligarContinuar}
          </button>
          <button type="button" onClick={aoFechar}>
            {t.cancelar}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

type PassoRegresso =
  | { tipo: "a_concluir" }
  | { tipo: "ligado" }
  | { tipo: "falhou"; texto: string };

/**
 * De volta do Moloni (`/faturacao/moloni`, docs/22 §30.2): o código vem no
 * fragmento, lido e tirado do endereço ao abrir a página (App.tsx); o
 * pedido, do `sessionStorage` deste separador.
 */
export function RegressoMoloni({
  fragmento,
}: {
  fragmento: { codigo: string; estado: string | null } | null;
}) {
  const { t, lingua, navegar } = useHub();
  const [passo, setPasso] = useState<PassoRegresso>({ tipo: "a_concluir" });
  const [comerciante, setComerciante] = useState<string | null>(null);
  const [ligacao, setLigacao] = useState<string | null>(null);
  const [aTestar, setATestar] = useState(false);
  const [resultado, setResultado] = useState<{
    texto: string;
    erro: boolean;
  } | null>(null);
  // Uma vez só, também com o StrictMode (o código vale uma vez).
  const comecado = useRef(false);

  useEffect(() => {
    if (comecado.current) return;
    comecado.current = true;
    let guardado: string | null;
    try {
      guardado = sessionStorage.getItem(CHAVE_PEDIDO_MOLONI);
    } catch {
      guardado = null;
    }
    const pedido = lerPedidoMoloni(guardado);
    const r = regressoDe(fragmento, pedido, Date.now());
    if (pedido !== null) setComerciante(pedido.comerciante);
    const esquecer = () => {
      try {
        sessionStorage.removeItem(CHAVE_PEDIDO_MOLONI);
      } catch {
        // Sem armazenamento: nada a apagar.
      }
    };
    // A ligação recebeu credenciais depois deste pedido (a resposta
    // perdeu-se, mas a troca ficou feita; revisão do #408, P2-2).
    const ligacaoMudou = async (p: PedidoMoloni) => {
      try {
        const d = await api.faturacao(p.comerciante);
        const l = d.ligacoes.find((x) => x.id === p.ligacao);
        const desde = new Date(p.expira_em).getTime() - 10 * 60_000;
        return (
          l?.credenciais_em != null &&
          new Date(l.credenciais_em).getTime() >= desde
        );
      } catch {
        return false;
      }
    };
    if (r.tipo !== "concluir") {
      if (r.tipo === "expirado") esquecer();
      setPasso({
        tipo: "falhou",
        texto:
          r.tipo === "estado_diferente"
            ? t.moloniEstadoDiferente
            : r.tipo === "sem_codigo"
              ? t.moloniSemCodigo
              : t.moloniPedidoNaoVale,
      });
      return;
    }
    setLigacao(r.pedido.ligacao);
    api
      .concluirLigacao(
        r.pedido.comerciante,
        r.pedido.ligacao,
        r.codigo,
        r.pedido.estado,
      )
      .then(
        () => {
          esquecer();
          setPasso({ tipo: "ligado" });
        },
        async (e: unknown) => {
          // Sem sessão, o pedido fica: depois de entrar, dentro dos 10
          // minutos, ainda serve (revisão do #408, P3-3).
          if (semSessao(e)) {
            navegar("/entrar", { substituir: true });
            return;
          }
          // A resposta pode ter-se perdido com a ligação feita: relê antes
          // de dizer que falhou (P2-2).
          if (e instanceof ErroHub && talvezFeito(e)) {
            const feita = await ligacaoMudou(r.pedido);
            if (feita) {
              esquecer();
              setPasso({ tipo: "ligado" });
              return;
            }
            setPasso({ tipo: "falhou", texto: t.ossNaoConfirmado });
            return;
          }
          esquecer();
          let texto = mensagemDeErro(e, t, lingua).texto;
          if (e instanceof ErroHub) {
            if (e.codigo === "invoices.issuer_error") {
              // A frase do Moloni, já tapada pela API (o pormenor; P2-1).
              texto = preencher(t.moloniRecusou, { erro: e.detalhe ?? "" });
            } else if (e.codigo === "invoices.issuer_busy") {
              texto = t.moloniOcupado;
            } else if (
              e.codigo === "invoices.invalid_transition" ||
              e.codigo === "invoices.not_found"
            ) {
              texto = t.moloniPedidoNaoVale;
            }
          }
          setPasso({ tipo: "falhou", texto });
        },
      );
    // O regresso corre uma vez, com o que havia ao abrir a página.
  }, []);

  async function testar() {
    if (comerciante === null || ligacao === null) return;
    setATestar(true);
    setResultado(null);
    try {
      const r = await api.testarLigacao(comerciante, ligacao);
      setResultado(
        r.estado === "pronta"
          ? { texto: t.faturacaoTestePronto, erro: false }
          : {
              texto:
                r.erro === null
                  ? t.faturacaoTesteFalhouSemErro
                  : preencher(t.faturacaoTesteFalhou, { erro: r.erro }),
              erro: true,
            },
      );
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setResultado({ texto: mensagemDeErro(e, t, lingua).texto, erro: true });
    } finally {
      setATestar(false);
    }
  }

  return (
    <section aria-labelledby="titulo">
      <h1 id="titulo">{t.moloniTitulo}</h1>
      {passo.tipo === "a_concluir" ? (
        <p role="status">{t.moloniAConcluir}</p>
      ) : passo.tipo === "falhou" ? (
        <CaixaDeErro erro={{ texto: passo.texto }} />
      ) : (
        <>
          <p className="sucesso" role="status">
            {t.moloniLigado}
          </p>
          <p>
            <button
              type="button"
              className="principal"
              disabled={aTestar}
              onClick={() => void testar()}
            >
              {aTestar ? t.faturacaoATestar : t.faturacaoTestar}
            </button>
          </p>
          {resultado === null ? null : (
            <p className={resultado.erro ? "erro" : "sucesso"} role="status">
              {resultado.texto}
            </p>
          )}
        </>
      )}
      <p>
        <LigacaoInterna
          href={comerciante === null ? "/" : enderecoFaturacao(comerciante)}
        >
          {t.moloniVoltar}
        </LigacaoInterna>
      </p>
    </section>
  );
}
