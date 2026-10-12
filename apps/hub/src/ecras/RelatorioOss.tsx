import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroHub, type Eu, type Membros } from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import { falhaDeAccao, mensagemDeErro, semSessao } from "../erros";
import {
  BALDES,
  CLASSIFICAVEIS,
  enderecoFaturacao,
  enderecoOss,
  fechoDe,
  FORA_DA_UE,
  hojeEm,
  lerTrimestre,
  linhasAClassificar,
  montante,
  nomeDoPeriodo,
  paisesDoBalde,
  taxa,
  textoDoImpedimento,
  trimestreAnterior,
  trimestreDe,
  trimestreSeguinte,
  trimestresParaEscolher,
  type Balde,
  type Classificavel,
  type DocumentoAClassificar,
  type RelatorioOss as Relatorio,
  FUSO_DO_RELATORIO,
  talvezFeito,
  TEXTO_DO_ERRO_DO_RELATORIO,
} from "../faturacao";
import { comRecente } from "../passkeys";
import { curto } from "../tarefas";
import { preencher, TAG_LINGUA, type Lingua, type Textos } from "../textos";
import { Dialogo } from "./Dialogo";

/**
 * O erro do relatório em linguagem comum, com o pormenor da API quando o
 * desenho o pede (a linha recusada, o motivo; revisão do #408, P2-1).
 */
function mensagemOss(e: unknown, t: Textos, lingua: Lingua): string {
  if (e instanceof ErroHub && e.codigo !== undefined) {
    const chave = (
      TEXTO_DO_ERRO_DO_RELATORIO as Record<string, keyof Textos | undefined>
    )[e.codigo];
    if (chave !== undefined) {
      const base = t[chave];
      return e.detalhe === undefined
        ? base
        : `${base} ${preencher(t.ossPormenor, { p: e.detalhe })}`;
    }
  }
  return mensagemDeErro(e, t, lingua).texto;
}

// O relatório OSS de um período (docs/22 §30.3; docs/37): os cinco baldes,
// as alterações, o que fica à parte, o limiar e o que impede o fecho, como a
// API os devolve. O ecrã não soma nem decide: mostra, deixa classificar o
// que a API diz que se classifica e fechar quando ela deixa. Os números
// ajudam; quem declara é a empresa.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_ENTIDADE = /^lgl_[0-9a-f-]{36}$/;

/** Um montante; o negativo leva o sinal e o texto, não só a cor (§30.3). */
function Valor({ c, moeda }: { c: number; moeda: string }) {
  const { t, lingua } = useHub();
  const texto = montante(c, TAG_LINGUA[lingua], moeda);
  if (c >= 0) return <>{texto}</>;
  return (
    <span className="valor-negativo">
      {texto} <span className="secundario">{t.ossNegativo}</span>
    </span>
  );
}

const nomeDoPais = (lingua: Lingua, codigo: string | null, t: Textos) => {
  if (codigo === null) return t.ossPaisPorSaber;
  try {
    const nome = new Intl.DisplayNames([TAG_LINGUA[lingua]], {
      type: "region",
    }).of(codigo);
    return nome === undefined || nome === codigo
      ? codigo
      : `${nome} (${codigo})`;
  } catch {
    return codigo;
  }
};

const diaDe = (lingua: Lingua, dia: string) =>
  new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${dia}T00:00:00Z`));

export function RelatorioOss({
  comerciante,
  consulta,
}: {
  comerciante: string | null;
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const q = new URLSearchParams(consulta);
  const entidade = q.get("entidade");
  const pedido = q.get("periodo");
  const periodo = lerTrimestre(pedido);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const entidadeValida = entidade !== null && FORMATO_ENTIDADE.test(entidade);
  const [hoje] = useState(() => hojeEm(new Date()));

  const [eu, setEu] = useState<Eu | null>(null);
  const [membros, setMembros] = useState<Membros["membros"]>([]);
  const [nomeEntidade, setNomeEntidade] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aClassificar, setAClassificar] = useState<string | null>(null);
  const [aFechar, setAFechar] = useState(false);
  const [aDescarregar, setADescarregar] = useState(false);
  const [falhaCsv, setFalhaCsv] = useState<string | null>(null);
  const avisoRef = useRef<HTMLParagraphElement>(null);

  const pronto = valido && entidadeValida && periodo !== null;

  const carregar = useCallback(async () => {
    if (!pronto) return;
    setFalha(null);
    setRelatorio(null);
    try {
      const [quem, r] = await Promise.all([
        api.eu(),
        api.relatorioOss(comerciante, entidade, periodo),
      ]);
      setEu(quem);
      setRelatorio(r);
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
      return;
    }
    // O nome de quem fechou e o da entidade: se falharem, fica o resto.
    const [m, f] = await Promise.allSettled([
      api.membros(comerciante),
      api.faturacao(comerciante),
    ]);
    if (m.status === "fulfilled") setMembros(m.value.membros);
    if (f.status === "fulfilled") {
      const e = f.value.entidades.find((x) => x.id === entidade);
      if (e !== undefined) setNomeEntidade(e.nome);
    }
  }, [pronto, comerciante, entidade, periodo, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (aviso !== null) avisoRef.current?.focus();
  }, [aviso]);

  /** Relê o relatório sem tirar a página; null se falhar. */
  const reler = useCallback(async (): Promise<Relatorio | null> => {
    if (!pronto) return null;
    try {
      const r = await api.relatorioOss(comerciante, entidade, periodo);
      setRelatorio(r);
      return r;
    } catch {
      return null;
    }
  }, [pronto, comerciante, entidade, periodo]);

  const titulo = (
    <h1 id="titulo">
      {t.ossTitulo}
      {nomeEntidade === null ? "" : ` — ${nomeEntidade}`}
    </h1>
  );
  const voltar = valido ? (
    <p>
      <LigacaoInterna href={enderecoFaturacao(comerciante)}>
        {t.moloniVoltar}
      </LigacaoInterna>
    </p>
  ) : null;

  if (!valido) {
    return (
      <section aria-labelledby="titulo">
        {titulo}
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      </section>
    );
  }
  if (!entidadeValida) {
    return (
      <section aria-labelledby="titulo">
        {voltar}
        {titulo}
        <CaixaDeErro erro={{ texto: t.ossEntidadeEmFalta }} />
      </section>
    );
  }

  const opcoes = trimestresParaEscolher(hoje);
  if (periodo !== null && !opcoes.some((o) => o.periodo === periodo)) {
    opcoes.push({ periodo, emCurso: false });
  }
  const irPara = (p: string) => {
    navegar(enderecoOss(comerciante, entidade, p));
  };
  const actual = trimestreDe(hoje);
  const escolha = (
    <div className="linha">
      {periodo === null ? null : (
        <button
          type="button"
          onClick={() => {
            irPara(trimestreAnterior(periodo));
          }}
        >
          {t.ossAnterior}
        </button>
      )}
      <div className="campo">
        <label htmlFor="periodo-oss">{t.ossPeriodo}</label>
        <select
          id="periodo-oss"
          value={periodo ?? ""}
          onChange={(e) => {
            if (e.target.value !== "") irPara(e.target.value);
          }}
        >
          {periodo === null ? <option value="">{pedido ?? ""}</option> : null}
          {opcoes.map((o) => (
            <option key={o.periodo} value={o.periodo}>
              {o.emCurso
                ? preencher(t.ossEmCurso, {
                    periodo: nomeDoPeriodo(t, o.periodo),
                  })
                : nomeDoPeriodo(t, o.periodo)}
            </option>
          ))}
        </select>
      </div>
      {periodo === null || periodo >= actual ? null : (
        <button
          type="button"
          onClick={() => {
            irPara(trimestreSeguinte(periodo));
          }}
        >
          {t.ossSeguinte}
        </button>
      )}
    </div>
  );

  if (periodo === null) {
    return (
      <section aria-labelledby="titulo">
        {voltar}
        {titulo}
        <CaixaDeErro erro={{ texto: t.ossPeriodoInvalido }} />
        {escolha}
      </section>
    );
  }

  // O comerciante já conferido, para as funções de dentro.
  const loja: string = comerciante;
  const meu = eu?.comerciantes.find((c) => c.comerciante === comerciante);
  const ambitos = meu?.ambitos ?? [];
  const euId = eu === null ? null : `per_${eu.pessoa.replace(/^per_/, "")}`;
  const quemFechou = (por: string) => {
    if (por.startsWith("pessoa:")) {
      const pessoa = por.slice("pessoa:".length);
      if (pessoa === euId) return t.ossPorSi;
      return (
        membros.find((m) => m.pessoa === pessoa)?.nome ??
        t.ossPessoaDesconhecida
      );
    }
    // Pela integração: nunca o identificador técnico (revisão do #408, P3-6).
    return t.ossPorIntegracao;
  };
  // No fuso do relatório (Lisboa), não no do navegador (P3-7).
  const dataHora = (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
      dateStyle: "medium",
      timeZone: FUSO_DO_RELATORIO,
    }).format(new Date(iso));

  async function descarregar(r: Relatorio) {
    setADescarregar(true);
    setFalhaCsv(null);
    try {
      const csv = await api.registosOss(loja, r.entidade_legal, r.periodo);
      const url = URL.createObjectURL(csv);
      const a = document.createElement("a");
      a.href = url;
      a.download = `registos-oss-${r.periodo}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaCsv(mensagemOss(e, t, lingua));
    } finally {
      setADescarregar(false);
    }
  }

  return (
    <section aria-labelledby="titulo">
      {voltar}
      {titulo}
      {escolha}
      <p className="aviso">{t.ossAjuda}</p>
      {aviso === null ? null : (
        <p className="sucesso" role="status" tabIndex={-1} ref={avisoRef}>
          {aviso}
        </p>
      )}
      {falha !== null ? (
        <CaixaDeErro
          erro={mensagemDeErro(falha, t, lingua)}
          aoTentar={() => void carregar()}
        />
      ) : relatorio === null ? (
        <ACarregar />
      ) : (
        <Conteudo
          r={relatorio}
          comerciante={comerciante}
          entidade={entidade}
          ambitos={ambitos}
          quemFechou={quemFechou}
          dataHora={dataHora}
          classificar={(doc) => {
            setAviso(null);
            setAClassificar(doc);
          }}
          fechar={() => {
            setAviso(null);
            setAFechar(true);
          }}
          descarregar={() => void descarregar(relatorio)}
          aDescarregar={aDescarregar}
          falhaCsv={falhaCsv}
        />
      )}
      {aClassificar === null || relatorio === null ? null : (
        <DialogoClassificar
          comerciante={comerciante}
          documento={aClassificar}
          classificavel={relatorio.classificavel}
          hoje={hoje}
          reler={reler}
          aoFechar={(texto) => {
            setAClassificar(null);
            if (texto !== null) setAviso(texto);
          }}
        />
      )}
      {aFechar && relatorio !== null ? (
        <DialogoFechar
          comerciante={comerciante}
          relatorio={relatorio}
          reler={reler}
          aoFechar={(texto) => {
            setAFechar(false);
            if (texto !== null) setAviso(texto);
          }}
        />
      ) : null}
    </section>
  );
}

function Conteudo({
  r,
  comerciante,
  entidade,
  ambitos,
  quemFechou,
  dataHora,
  classificar,
  fechar,
  descarregar,
  aDescarregar,
  falhaCsv,
}: {
  r: Relatorio;
  comerciante: string;
  entidade: string;
  ambitos: readonly string[];
  quemFechou: (por: string) => string;
  dataHora: (iso: string) => string;
  classificar: (doc: string) => void;
  fechar: () => void;
  descarregar: () => void;
  aDescarregar: boolean;
  falhaCsv: string | null;
}) {
  const { t, lingua } = useHub();
  const tag = TAG_LINGUA[lingua];
  const fecho = fechoDe(r, ambitos);
  const nomePeriodo = nomeDoPeriodo(t, r.periodo);
  const podeClassificar = r.fechado === null && ambitos.includes("tax:write");

  return (
    <>
      <p>
        {r.fechado === null ? (
          <strong>{t.ossAberto}</strong>
        ) : (
          <strong>
            {preencher(t.ossFechadoPor, {
              data: dataHora(r.fechado.em),
              nome: quemFechou(r.fechado.por),
              versao: r.fechado.versao_regra,
            })}
          </strong>
        )}
      </p>

      {BALDES.map((b) => {
        const balde = r.baldes.find((x) => x.balde === b);
        return (
          <section key={b} aria-labelledby={`balde-${b}`} className="balde-oss">
            <h2 id={`balde-${b}`}>{t[`balde_${b}`]}</h2>
            {balde === undefined || balde.linhas.length === 0 ? (
              <p className="secundario">{t.ossBaldeVazio}</p>
            ) : (
              <>
                <p>
                  {t.colunaBase}: <Valor c={balde.base} moeda={r.moeda} /> ·{" "}
                  {t.colunaIva}: <Valor c={balde.iva} moeda={r.moeda} />
                </p>
                <table className="tabela-media">
                  <thead>
                    <tr>
                      <th scope="col">{t.colunaPais}</th>
                      <th scope="col">{t.colunaTaxa}</th>
                      <th scope="col">{t.colunaBase}</th>
                      <th scope="col">{t.colunaIva}</th>
                      <th scope="col">{t.colunaDocumentos}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balde.linhas.map((l) => (
                      <tr key={`${l.pais} ${String(l.taxa)}`}>
                        <td data-rotulo={t.colunaPais}>
                          {nomeDoPais(lingua, l.pais, t)}
                        </td>
                        <td data-rotulo={t.colunaTaxa}>{taxa(l.taxa, tag)}</td>
                        <td data-rotulo={t.colunaBase}>
                          <Valor c={l.base} moeda={r.moeda} />
                        </td>
                        <td data-rotulo={t.colunaIva}>
                          <Valor c={l.iva} moeda={r.moeda} />
                        </td>
                        <td data-rotulo={t.colunaDocumentos}>{l.documentos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        );
      })}

      {r.alteracoes.length === 0 ? null : (
        <section aria-labelledby="alteracoes-oss">
          <h2 id="alteracoes-oss">{t.ossAlteracoesTitulo}</h2>
          <table className="tabela-media">
            <thead>
              <tr>
                <th scope="col">{t.colunaPeriodoOriginal}</th>
                <th scope="col">{t.colunaBalde}</th>
                <th scope="col">{t.colunaPais}</th>
                <th scope="col">{t.colunaTaxa}</th>
                <th scope="col">{t.colunaBase}</th>
                <th scope="col">{t.colunaIva}</th>
              </tr>
            </thead>
            <tbody>
              {r.alteracoes.map((a) => (
                <tr
                  key={`${a.periodo_original} ${a.balde} ${a.pais} ${String(a.taxa)}`}
                >
                  <td data-rotulo={t.colunaPeriodoOriginal}>
                    {nomeDoPeriodo(t, a.periodo_original)}
                  </td>
                  <td data-rotulo={t.colunaBalde}>{t[`balde_${a.balde}`]}</td>
                  <td data-rotulo={t.colunaPais}>
                    {nomeDoPais(lingua, a.pais, t)}
                  </td>
                  <td data-rotulo={t.colunaTaxa}>{taxa(a.taxa, tag)}</td>
                  <td data-rotulo={t.colunaBase}>
                    <Valor c={a.base} moeda={r.moeda} />
                  </td>
                  <td data-rotulo={t.colunaIva}>
                    <Valor c={a.iva} moeda={r.moeda} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="a-parte-oss" className="a-parte-oss">
        <h2 id="a-parte-oss">{t.ossAParteTitulo}</h2>
        <h3>{t.ossEmitidasFora}</h3>
        {r.a_parte.emitidas_fora.length === 0 ? (
          <p className="secundario">{t.ossNada}</p>
        ) : (
          <ul className="lista-oss">
            {r.a_parte.emitidas_fora.map((x) => (
              <li key={x.documento}>
                <span translate="no" title={x.documento}>
                  {curto(x.documento)}
                </span>{" "}
                · {nomeDoPais(lingua, x.pais, t)} ·{" "}
                <Valor c={x.total} moeda={r.moeda} /> ·{" "}
                {x.numero_declarado === null
                  ? t.ossSemNumero
                  : preencher(t.ossNumeroDeclarado, {
                      numero: x.numero_declarado,
                    })}
                {x.alteracao_de === null
                  ? ""
                  : ` · ${preencher(t.ossAlteracaoDe, {
                      periodo: nomeDoPeriodo(t, x.alteracao_de),
                    })}`}
              </li>
            ))}
          </ul>
        )}
        <h3>{t.ossSistemaProprio}</h3>
        {r.a_parte.sistema_proprio.length === 0 ? (
          <p className="secundario">{t.ossNada}</p>
        ) : (
          <ul className="lista-oss">
            {r.a_parte.sistema_proprio.map((x) => (
              <li key={x.encomenda}>
                <span translate="no" title={x.encomenda}>
                  {curto(x.encomenda)}
                </span>{" "}
                · {nomeDoPais(lingua, x.pais, t)} ·{" "}
                <Valor c={x.total} moeda={r.moeda} />
              </li>
            ))}
          </ul>
        )}
        <h3>{t.ossPorEmitir}</h3>
        {r.a_parte.por_emitir.length === 0 ? (
          <p className="secundario">{t.ossNada}</p>
        ) : (
          <ul className="lista-oss">
            {r.a_parte.por_emitir.map((x) => (
              <li key={x.documento}>
                <span translate="no" title={x.documento}>
                  {curto(x.documento)}
                </span>{" "}
                ·{" "}
                <span translate="no" title={x.encomenda}>
                  {curto(x.encomenda)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="limiar-oss">
        <h2 id="limiar-oss">{t.ossLimiarTitulo}</h2>
        <p>
          {preencher(t.ossLimiar, {
            ano: r.limiar.ano,
            valor: montante(r.limiar.vendas_a_distancia_base, tag, r.moeda),
            limiar: montante(r.limiar.limiar, tag, r.moeda),
          })}
        </p>
        <p className="secundario">
          {preencher(t.ossLimiarAnterior, {
            ano: r.limiar.ano_anterior,
            valor: montante(r.limiar.ano_anterior_base, tag, r.moeda),
          })}
        </p>
        {r.limiar.passou ? <p className="aviso">{t.ossLimiarPassou}</p> : null}
        {r.limiar.documentos_excluidos === 0 ? null : (
          <p className="aviso">
            {r.limiar.documentos_excluidos === 1
              ? t.ossLimiarPorBaixoUm
              : preencher(t.ossLimiarPorBaixo, {
                  n: r.limiar.documentos_excluidos,
                })}
          </p>
        )}
      </section>

      <section aria-labelledby="impedimentos-oss">
        <h2 id="impedimentos-oss">{t.ossImpedimentosTitulo}</h2>
        {r.impedimentos.length === 0 ? (
          <p>{t.ossSemImpedimentos}</p>
        ) : (
          <ul className="impedimentos-oss">
            {r.impedimentos.map((i) => (
              <li key={i.motivo}>
                <p>
                  <strong>{textoDoImpedimento(t, i)}</strong>
                </p>
                {i.motivo === "linhas_desalinhadas" ? (
                  <p className="secundario">{t.ossLinhasDesalinhadasAjuda}</p>
                ) : i.motivo === "outra_moeda" ? (
                  <p className="secundario">{t.ossOutraMoedaAjuda}</p>
                ) : i.motivo === "sinal_inesperado" ? (
                  <p className="secundario">{t.ossSinalAjuda}</p>
                ) : i.motivo === "divergente" ||
                  i.motivo === "declarado_divergente" ? (
                  <p>
                    <LigacaoInterna
                      href={`/a-decidir?${new URLSearchParams({ comerciante, fila: "documento_fiscal" }).toString()}`}
                    >
                      {t.ossVerADecidir}
                    </LigacaoInterna>
                  </p>
                ) : i.motivo === "periodo_anterior_aberto" ? (
                  <p>
                    <LigacaoInterna
                      href={enderecoOss(
                        comerciante,
                        entidade,
                        trimestreAnterior(r.periodo),
                      )}
                    >
                      {t.ossVerPeriodoAnterior}
                    </LigacaoInterna>
                  </p>
                ) : null}
                {i.documentos.length === 0 ? null : (
                  <ul className="lista-simples">
                    {i.documentos.map((d) => (
                      <li key={d} className="accoes-tarefa">
                        <span translate="no" title={d}>
                          {curto(d)}
                        </span>
                        {podeClassificar &&
                        CLASSIFICAVEIS.includes(i.motivo) ? (
                          <button
                            type="button"
                            aria-label={preencher(t.ossClassificarDoc, {
                              doc: curto(d),
                            })}
                            onClick={() => {
                              classificar(d);
                            }}
                          >
                            {t.ossClassificar}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="accoes-oss" className="cartao">
        <h2 id="accoes-oss" className="so-leitores">
          {t.ossTitulo}
        </h2>
        <p>
          <button
            type="button"
            disabled={aDescarregar}
            aria-describedby="aviso-csv"
            onClick={descarregar}
          >
            {aDescarregar ? t.aCarregar : t.ossDescarregar}
          </button>
        </p>
        <p className="secundario" id="aviso-csv">
          {t.ossDescarregarAviso}
        </p>
        {falhaCsv === null ? null : <CaixaDeErro erro={{ texto: falhaCsv }} />}
        {fecho.tipo === "pode" ? (
          <p>
            <button type="button" className="principal" onClick={fechar}>
              {preencher(t.ossFechar, { periodo: nomePeriodo })}
            </button>
          </p>
        ) : fecho.tipo === "em_curso" ? (
          <p>
            <button type="button" disabled>
              {preencher(t.ossSoDepoisDe, {
                data: diaDe(lingua, fecho.depois),
              })}
            </button>
          </p>
        ) : fecho.tipo === "impedido" ? (
          <p className="secundario">{t.ossImpedido}</p>
        ) : fecho.tipo === "posterior_fechado" ? (
          <p className="aviso">{t.ossPosteriorFechado}</p>
        ) : fecho.tipo === "so_leitura" ? (
          <p className="secundario">{t.ossSoLeitura}</p>
        ) : null}
      </section>
    </>
  );
}

interface Escolha {
  balde: Balde | "";
  pais: string;
  codigoFora: string;
}

function DialogoClassificar({
  comerciante,
  documento,
  classificavel,
  hoje,
  reler,
  aoFechar,
}: {
  comerciante: string;
  documento: string;
  classificavel: Classificavel;
  hoje: string;
  reler: () => Promise<Relatorio | null>;
  /** Com o texto do aviso, quando ficou feito (ou já estava). */
  aoFechar: (texto: string | null) => void;
}) {
  const { t, lingua, navegar } = useHub();
  const [doc, setDoc] = useState<DocumentoAClassificar | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [escolhas, setEscolhas] = useState<Escolha[]>([]);
  const [data, setData] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const tag = TAG_LINGUA[lingua];

  useEffect(() => {
    let vivo = true;
    api.documentoOss(comerciante, documento).then(
      (d) => {
        if (!vivo) return;
        setDoc(d);
        setEscolhas(
          d.linhas.map(() => ({ balde: "", pais: "", codigoFora: "" })),
        );
      },
      (e: unknown) => {
        if (vivo) setFalha(e);
      },
    );
    return () => {
      vivo = false;
    };
  }, [comerciante, documento]);

  const mudar = (i: number, nova: Partial<Escolha>) => {
    setEscolhas((l) => l.map((e, j) => (j === i ? { ...e, ...nova } : e)));
  };

  async function gravar() {
    if (doc === null) return;
    const linhas = linhasAClassificar(escolhas);
    if (linhas === null) {
      setErro(t.classificarFaltaLinhas);
      return;
    }
    if (doc.data_prova === null && data === "") {
      setErro(t.classificarFaltaData);
      return;
    }
    if (motivo.trim() === "") {
      setErro(t.classificarFaltaMotivo);
      return;
    }
    setErro(null);
    setAGravar(true);
    try {
      await api.classificarOss(comerciante, {
        documento,
        linhas,
        ...(doc.data_prova === null ? { data } : {}),
        motivo: motivo.trim(),
      });
      await reler();
      aoFechar(t.classificarFeito);
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (
        e instanceof ErroHub &&
        e.codigo === "tax_reports.already_classified"
      ) {
        await reler();
        aoFechar(t.classificarJaClassificado);
        return;
      }
      if (e instanceof ErroHub && talvezFeito(e)) {
        // A resposta perdeu-se: se o documento já não impede o fecho, ficou
        // feito (docs/22 §30.2).
        const r = await reler();
        if (
          r !== null &&
          !r.impedimentos.some((i) => i.documentos.includes(documento))
        ) {
          aoFechar(t.classificarFeito);
          return;
        }
        setErro(t.ossNaoConfirmado);
        setAGravar(false);
        return;
      }
      setErro(mensagemOss(e, t, lingua));
      setAGravar(false);
    }
  }

  return (
    <Dialogo
      id="classificar"
      titulo={preencher(t.classificarTitulo, { doc: curto(documento) })}
      aoFechar={() => {
        aoFechar(null);
      }}
    >
      {falha !== null ? (
        <>
          <CaixaDeErro erro={mensagemDeErro(falha, t, lingua)} />
          <button
            type="button"
            onClick={() => {
              aoFechar(null);
            }}
          >
            {t.cancelar}
          </button>
        </>
      ) : doc === null ? (
        <ACarregar />
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void gravar();
          }}
        >
          <p>
            <strong>
              {preencher(t.classificarDocumento, {
                tipo: t[`tipoDocumento_${doc.tipo}`],
                numero: doc.numero,
              })}
            </strong>
            {" · "}
            {preencher(t.classificarTotal, {
              total: montante(doc.total, TAG_LINGUA[lingua], doc.moeda),
            })}
            {" · "}
            {doc.data_prova === null
              ? t.classificarSemData
              : preencher(t.classificarDataDaProva, {
                  data: diaDe(lingua, doc.data_prova),
                })}
          </p>
          <p className="so-leitores">{t.classificarLinhas}</p>
          {doc.linhas.map((l, i) => {
            const e = escolhas[i] ?? {
              balde: "" as const,
              pais: "",
              codigoFora: "",
            };
            const { paises, foraDaUe } = paisesDoBalde(classificavel, e.balde);
            const n = i + 1;
            return (
              <fieldset
                key={`${String(i)} ${l.descricao}`}
                className="linha-classificar"
              >
                <legend>
                  {preencher(t.classificarLinha, { n, descricao: l.descricao })}
                </legend>
                <dl className="valores-linha">
                  <div>
                    <dt>{t.colunaQuantidade}</dt>
                    <dd>{l.quantidade}</dd>
                  </div>
                  <div>
                    <dt>{t.colunaTaxa}</dt>
                    <dd>{taxa(l.taxa, tag)}</dd>
                  </div>
                  <div>
                    <dt>{t.colunaBase}</dt>
                    <dd>{montante(l.base, tag, doc.moeda)}</dd>
                  </div>
                  <div>
                    <dt>{t.colunaIva}</dt>
                    <dd>{montante(l.iva, tag, doc.moeda)}</dd>
                  </div>
                </dl>
                <div className="linha">
                  <div className="campo">
                    <label htmlFor={`balde-${String(n)}`}>
                      {preencher(t.classificarBalde, { n })}
                    </label>
                    <select
                      id={`balde-${String(n)}`}
                      value={e.balde}
                      onChange={(ev) => {
                        const balde =
                          BALDES.find((b) => b === ev.target.value) ?? "";
                        const r = paisesDoBalde(classificavel, balde);
                        // Com um só país possível (o nacional), já escolhido.
                        const unico =
                          r.paises.length === 1 && !r.foraDaUe
                            ? (r.paises[0] ?? "")
                            : "";
                        mudar(i, { balde, pais: unico, codigoFora: "" });
                      }}
                    >
                      <option value="">{t.classificarEscolher}</option>
                      {BALDES.map((b) => (
                        <option key={b} value={b}>
                          {t[`balde_${b}`]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="campo">
                    <label htmlFor={`pais-${String(n)}`}>
                      {preencher(t.classificarPais, { n })}
                    </label>
                    <select
                      id={`pais-${String(n)}`}
                      value={e.pais}
                      disabled={e.balde === ""}
                      onChange={(ev) => {
                        mudar(i, { pais: ev.target.value, codigoFora: "" });
                      }}
                    >
                      <option value="">{t.classificarEscolher}</option>
                      {paises.map((p) => (
                        <option key={p} value={p}>
                          {nomeDoPais(lingua, p, t)}
                        </option>
                      ))}
                      {foraDaUe ? (
                        <option value={FORA_DA_UE}>
                          {t.classificarForaDaUe}
                        </option>
                      ) : null}
                    </select>
                  </div>
                  {e.pais === FORA_DA_UE ? (
                    <div className="campo">
                      <label htmlFor={`fora-${String(n)}`}>
                        {preencher(t.classificarCodigoFora, { n })}
                      </label>
                      <input
                        id={`fora-${String(n)}`}
                        maxLength={2}
                        autoComplete="off"
                        value={e.codigoFora}
                        onChange={(ev) => {
                          mudar(i, {
                            codigoFora: ev.target.value.toUpperCase(),
                          });
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
          {doc.data_prova === null ? (
            <div className="campo">
              <label htmlFor="data-classificar">{t.classificarData}</label>
              <input
                id="data-classificar"
                type="date"
                min={doc.data_minima}
                max={hoje}
                value={data}
                aria-describedby="data-classificar-ajuda"
                onChange={(ev) => {
                  setData(ev.target.value);
                }}
              />
              <p className="secundario" id="data-classificar-ajuda">
                {t.classificarDataAjuda}
              </p>
            </div>
          ) : null}
          <div className="campo">
            <label htmlFor="motivo-classificar">{t.classificarMotivo}</label>
            <textarea
              id="motivo-classificar"
              maxLength={500}
              rows={2}
              value={motivo}
              aria-describedby="motivo-classificar-ajuda"
              onChange={(ev) => {
                setMotivo(ev.target.value);
              }}
            />
            <p className="secundario" id="motivo-classificar-ajuda">
              {t.decidirMotivoAjuda}
            </p>
          </div>
          <p className="aviso">{t.classificarAviso}</p>
          {erro === null ? null : <CaixaDeErro erro={{ texto: erro }} />}
          <div className="accoes-tarefa">
            <button type="submit" className="principal" disabled={aGravar}>
              {aGravar ? t.aCarregar : t.classificarGravar}
            </button>
            <button
              type="button"
              onClick={() => {
                aoFechar(null);
              }}
            >
              {t.cancelar}
            </button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

function DialogoFechar({
  comerciante,
  relatorio: r,
  reler,
  aoFechar,
}: {
  comerciante: string;
  relatorio: Relatorio;
  reler: () => Promise<Relatorio | null>;
  aoFechar: (texto: string | null) => void;
}) {
  const { t, lingua, navegar } = useHub();
  const [confirmo, setConfirmo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aFechar, setAFechar] = useState(false);
  const porEmitir = r.a_parte.por_emitir;
  const nome = nomeDoPeriodo(t, r.periodo);

  async function fechar() {
    if (porEmitir.length > 0 && !confirmo) {
      setErro(t.fecharFaltaConfirmacao);
      return;
    }
    setErro(null);
    setAFechar(true);
    try {
      await comRecente(() =>
        api.fecharOss(
          comerciante,
          r.entidade_legal,
          r.periodo,
          porEmitir.length > 0,
        ),
      );
      await reler();
      aoFechar(t.fecharFeito);
    } catch (e) {
      const f = await falhaDeAccao(e);
      if (f === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (f instanceof ErroHub && f.codigo === "tax_reports.already_closed") {
        await reler();
        aoFechar(t.fecharJaFechado);
        return;
      }
      if (f instanceof ErroHub && f.codigo === "tax_reports.not_closable") {
        await reler();
        aoFechar(t.fecharMudou);
        return;
      }
      if (f instanceof ErroHub && talvezFeito(f)) {
        // A resposta perdeu-se: se já está fechado, ficou feito (§30.2).
        const lido = await reler();
        if (lido?.fechado != null) {
          aoFechar(t.fecharFeito);
          return;
        }
        setErro(t.ossNaoConfirmado);
        setAFechar(false);
        return;
      }
      setErro(mensagemOss(f, t, lingua));
      setAFechar(false);
    }
  }

  return (
    <Dialogo
      id="fechar"
      titulo={preencher(t.fecharTitulo, { periodo: nome })}
      aoFechar={() => {
        aoFechar(null);
      }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void fechar();
        }}
      >
        <p>{t.fecharTexto}</p>
        {porEmitir.length === 0 ? null : (
          <fieldset>
            <legend>{t.fecharPorEmitirTitulo}</legend>
            <ul className="lista-oss">
              {porEmitir.map((x) => (
                <li key={x.documento}>
                  <span translate="no" title={x.documento}>
                    {curto(x.documento)}
                  </span>{" "}
                  ·{" "}
                  <span translate="no" title={x.encomenda}>
                    {curto(x.encomenda)}
                  </span>
                </li>
              ))}
            </ul>
            <label className="opcao">
              <input
                type="checkbox"
                checked={confirmo}
                onChange={(e) => {
                  setConfirmo(e.target.checked);
                }}
              />{" "}
              {t.fecharConfirmoPorEmitir}
            </label>
          </fieldset>
        )}
        {erro === null ? null : <CaixaDeErro erro={{ texto: erro }} />}
        <div className="accoes-tarefa">
          <button type="submit" className="principal" disabled={aFechar}>
            {aFechar ? t.aCarregar : t.fecharConfirmar}
          </button>
          <button
            type="button"
            onClick={() => {
              aoFechar(null);
            }}
          >
            {t.cancelar}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
