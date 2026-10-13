import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroHub } from "../api";
import { CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import { falhaDeAccao, mensagemDeErro, semSessao } from "../erros";
import {
  CAMPOS_DE_LISTA,
  chaveDoPar,
  enderecoFaturacao,
  escolhasDe,
  faltaNasEscolhas,
  paraGravar,
  resumoDoQueFalta,
  taxa,
  taxasParaOPar,
  type Escolhas,
  type Opcao,
  type OpcoesDoEmissor,
  type ResultadoNoEmissor,
} from "../faturacao";
import { preencher, TAG_LINGUA, type Textos } from "../textos";

// «Configurar» a ligação ao Moloni (docs/22 §32.4; Q1 em A): cada escolha
// vem de uma lista lida do Moloni, com o nome e o id lado a lado, e **nada
// vem escolhido** — as taxas de mesmo valor e zona ficam só no topo. O
// servidor relê as listas ao gravar e recusa um id que lá já não esteja.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;
const FORMATO_LIGACAO = /^isx_[0-9a-f-]{36}$/;

type Aviso = { texto: string; erro: boolean };

const ROTULO_DO_CAMPO = {
  lingua: "configurarLingua",
  vencimento: "configurarVencimento",
  unidade: "configurarUnidade",
  categoria: "configurarCategoria",
} as const;

const LISTA_DO_CAMPO = {
  lingua: "linguas",
  vencimento: "vencimentos",
  unidade: "unidades",
  categoria: "categorias",
} as const;

const opcaoSimples = (t: Textos, o: Opcao) =>
  preencher(t.configurarOpcao, { nome: o.nome, id: o.id });

export function ConfigurarFaturacao({
  comerciante,
  ligacao,
}: {
  comerciante: string | null;
  ligacao: string | null;
}) {
  const { t, lingua, navegar } = useHub();
  const valido =
    comerciante !== null &&
    FORMATO_COMERCIANTE.test(comerciante) &&
    ligacao !== null &&
    FORMATO_LIGACAO.test(ligacao);
  const [opcoes, setOpcoes] = useState<OpcoesDoEmissor | null>(null);
  const [escolhas, setEscolhas] = useState<Escolhas | null>(null);
  const [falha, setFalha] = useState<unknown>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const [gravado, setGravado] = useState(false);
  const [aTestar, setATestar] = useState(false);
  /** O texto de um artigo ou cliente escolhido por pesquisa nesta visita. */
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [releituraFalhou, setReleituraFalhou] = useState(false);
  const ultimo = useRef(0);

  const testarRef = useRef<HTMLButtonElement>(null);

  /**
   * Lê as listas. `abrir`: do zero; `manter`: as escolhas no ecrã ficam
   * (conflito, id velho); `gravado`: as escolhas passam a ser as gravadas.
   * Fora de `abrir`, o formulário nunca se desmonta (o foco e o aviso ficam;
   * revisão do #412, P2-3) e uma releitura que falha não apaga as escolhas
   * (P3-8).
   */
  const carregar = useCallback(
    async (modo: "abrir" | "manter" | "gravado") => {
      if (!valido) return;
      const este = ++ultimo.current;
      if (modo === "abrir") {
        setFalha(null);
        setOpcoes(null);
      }
      try {
        const r = await api.opcoesDoEmissor(comerciante, ligacao);
        if (este !== ultimo.current) return;
        setOpcoes(r);
        setEscolhas((e) =>
          modo === "manter" && e !== null ? e : escolhasDe(r.ligacao),
        );
      } catch (e) {
        if (este !== ultimo.current) return;
        if (semSessao(e)) {
          navegar("/entrar", { substituir: true });
          return;
        }
        if (modo === "abrir") setFalha(e);
        else setReleituraFalhou(true);
      }
    },
    [valido, comerciante, ligacao, navegar],
  );

  useEffect(() => {
    void carregar("abrir");
  }, [carregar]);

  // Depois de gravar, o foco vai para «Testar», o passo seguinte (§32.7).
  useEffect(() => {
    if (gravado) testarRef.current?.focus();
  }, [gravado]);

  if (!valido) {
    return (
      <section aria-labelledby="titulo">
        <h1 id="titulo">{t.configurarTitulo}</h1>
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      </section>
    );
  }

  const textoDaFalha = (e: unknown) =>
    e instanceof ErroHub && e.codigo === "invoices.issuer_error"
      ? preencher(t.configurarMoloniRecusou, { erro: e.detalhe ?? "" })
      : mensagemDeErro(e, t, lingua).texto;

  const mudar = (fn: (e: Escolhas) => Escolhas) => {
    setEscolhas((e) => (e === null ? e : fn(e)));
    setGravado(false);
  };

  async function gravar() {
    if (opcoes === null || escolhas === null) return;
    setAGravar(true);
    setAviso(null);
    setReleituraFalhou(false);
    try {
      const r = await api.configurarLigacao(
        comerciante as string,
        ligacao as string,
        paraGravar(escolhas, opcoes.ligacao.versao),
      );
      // O estado como a API o devolve: só uma ligação pronta passa a «por
      // testar» (P3-4).
      setAviso({
        texto:
          r.estado === "por_testar"
            ? t.configurarGravado
            : t.configurarGravadoSemMudarEstado,
        erro: false,
      });
      // Relê o que ficou gravado (e a versão nova), sem desmontar.
      await carregar("gravado");
      setGravado(true);
    } catch (x) {
      const f = await falhaDeAccao(x);
      if (f === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (f instanceof ErroHub && f.codigo === "invoices.version_conflict") {
        setAviso({ texto: t.configurarConflito, erro: true });
        await carregar("manter");
      } else if (
        f instanceof ErroHub &&
        f.codigo === "invoices.invalid_field"
      ) {
        setAviso({
          texto: preencher(t.configurarIdInvalido, { erro: f.detalhe ?? "" }),
          erro: true,
        });
        await carregar("manter");
      } else if (f instanceof ErroHub && f.codigo === "invoices.issuer_busy") {
        setAviso({ texto: t.configurarOcupado, erro: true });
      } else {
        setAviso({ texto: textoDaFalha(f), erro: true });
      }
    } finally {
      setAGravar(false);
    }
  }

  async function testar() {
    setATestar(true);
    try {
      const r = await api.testarLigacao(
        comerciante as string,
        ligacao as string,
      );
      setAviso(
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
      setAviso({ texto: mensagemDeErro(e, t, lingua).texto, erro: true });
    } finally {
      setATestar(false);
    }
  }

  const pais = (codigo: string) => {
    try {
      return (
        new Intl.DisplayNames([TAG_LINGUA[lingua]], { type: "region" }).of(
          codigo,
        ) ?? codigo
      );
    } catch {
      return codigo;
    }
  };

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={enderecoFaturacao(comerciante)}>
          {t.moloniVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">{t.configurarTitulo}</h1>
      <p className="secundario">{t.configurarExplicacao}</p>
      {falha !== null ? (
        <CaixaDeErro
          erro={{ texto: textoDaFalha(falha) }}
          aoTentar={() => void carregar("abrir")}
        />
      ) : opcoes === null || escolhas === null ? (
        <p role="status">{t.configurarALer}</p>
      ) : (
        <form
          noValidate
          className="configurar"
          onSubmit={(e) => {
            e.preventDefault();
            void gravar();
          }}
        >
          <Escolha
            id="serie"
            rotulo={t.configurarSerie}
            valor={escolhas.serie}
            grupos={[
              {
                rotulo: null,
                opcoes: opcoes.listas.series.map((o) => ({
                  id: o.id,
                  texto: opcaoSimples(t, o),
                })),
              },
            ]}
            aoMudar={(v) => {
              mudar((e) => ({ ...e, serie: v }));
            }}
          />

          <fieldset>
            <legend>{t.configurarTaxas}</legend>
            {opcoes.necessario.taxas.length === 0 ? (
              <p className="secundario">{t.configurarNadaAMapear}</p>
            ) : (
              opcoes.necessario.taxas.map((par) => {
                const k = chaveDoPar(par);
                const { batem, outras } = taxasParaOPar(
                  opcoes.listas.taxas,
                  par,
                );
                const texto = (o: (typeof batem)[number]) =>
                  preencher(t.configurarTaxaOpcao, {
                    nome: o.nome,
                    valor:
                      o.valor < 0 ? "?" : taxa(o.valor, TAG_LINGUA[lingua]),
                    zona: o.zona ?? "—",
                    id: o.id,
                  });
                return (
                  <Escolha
                    key={k}
                    id={`taxa-${k.replace("|", "-")}`}
                    rotulo={preencher(t.configurarTaxaDoPar, {
                      taxa: taxa(par.taxa, TAG_LINGUA[lingua]),
                      pais: pais(par.pais),
                    })}
                    valor={escolhas.taxas[k] ?? ""}
                    grupos={[
                      {
                        rotulo: t.configurarQueBatem,
                        opcoes: batem.map((o) => ({
                          id: o.id,
                          texto: texto(o),
                        })),
                      },
                      {
                        rotulo: t.configurarOutras,
                        opcoes: outras.map((o) => ({
                          id: o.id,
                          texto: texto(o),
                        })),
                      },
                    ]}
                    aoMudar={(v) => {
                      mudar((e) => ({ ...e, taxas: { ...e.taxas, [k]: v } }));
                    }}
                  />
                );
              })
            )}
          </fieldset>

          <fieldset>
            <legend>{t.configurarIsencoes}</legend>
            {opcoes.necessario.isencoes.length === 0 ? (
              <p className="secundario">{t.configurarNadaAMapear}</p>
            ) : (
              opcoes.necessario.isencoes.map((i) => (
                <Escolha
                  key={i.codigo}
                  id={`isencao-${i.codigo}`}
                  rotulo={preencher(t.configurarIsencaoDoCodigo, {
                    codigo: i.codigo,
                    pais: pais(i.pais),
                  })}
                  valor={escolhas.isencoes[i.codigo] ?? ""}
                  grupos={[
                    {
                      rotulo: null,
                      opcoes: opcoes.listas.isencoes.map((o) => ({
                        id: o.id,
                        texto: opcaoSimples(t, o),
                      })),
                    },
                  ]}
                  aoMudar={(v) => {
                    mudar((e) => ({
                      ...e,
                      isencoes: { ...e.isencoes, [i.codigo]: v },
                    }));
                  }}
                />
              ))
            )}
          </fieldset>

          <fieldset>
            <legend>{t.configurarMetodos}</legend>
            {opcoes.necessario.meios.length === 0 ? (
              <p className="secundario">{t.configurarNadaAMapear}</p>
            ) : (
              opcoes.necessario.meios.map((m) => (
                <Escolha
                  key={m}
                  id={`metodo-${m}`}
                  rotulo={
                    (t as Record<string, string>)[`metodoPagamento_${m}`] ?? m
                  }
                  valor={escolhas.metodos[m] ?? ""}
                  grupos={[
                    {
                      rotulo: null,
                      opcoes: opcoes.listas.metodos_pagamento.map((o) => ({
                        id: o.id,
                        texto: opcaoSimples(t, o),
                      })),
                    },
                  ]}
                  aoMudar={(v) => {
                    mudar((e) => ({ ...e, metodos: { ...e.metodos, [m]: v } }));
                  }}
                />
              ))
            )}
          </fieldset>

          {(
            [
              [t.configurarClientes, ["lingua", "vencimento"]],
              [t.configurarArtigos, ["unidade", "categoria"]],
            ] as const
          ).map(([legenda, campos]) => (
            <fieldset key={legenda}>
              <legend>{legenda}</legend>
              {campos.map((c: (typeof CAMPOS_DE_LISTA)[number]) => (
                <Escolha
                  key={c}
                  id={c}
                  rotulo={t[ROTULO_DO_CAMPO[c]]}
                  valor={escolhas.config[c]}
                  grupos={[
                    {
                      rotulo: null,
                      opcoes: opcoes.listas[LISTA_DO_CAMPO[c]].map((o) => ({
                        id: o.id,
                        texto: opcaoSimples(t, o),
                      })),
                    },
                  ]}
                  aoMudar={(v) => {
                    mudar((e) => ({ ...e, config: { ...e.config, [c]: v } }));
                  }}
                />
              ))}
            </fieldset>
          ))}

          {(
            [
              ["artigo_portes", "artigo", t.configurarPortes],
              [
                "cliente_consumidor_final",
                "cliente",
                t.configurarConsumidorFinal,
              ],
            ] as const
          ).map(([campo, tipo, legenda]) => (
            <Pesquisa
              key={campo}
              campo={campo}
              tipo={tipo}
              legenda={legenda}
              comerciante={comerciante}
              ligacao={ligacao}
              valor={escolhas.config[campo]}
              nome={nomes[`${campo}:${escolhas.config[campo]}`] ?? null}
              aoEscolher={(id, texto) => {
                setNomes((n) => ({ ...n, [`${campo}:${id}`]: texto }));
                mudar((e) => ({ ...e, config: { ...e.config, [campo]: id } }));
              }}
            />
          ))}

          <p className="secundario" role="status">
            {resumoDoQueFalta(
              t,
              faltaNasEscolhas(opcoes.necessario, escolhas),
            ) ?? t.configurarNadaFalta}
          </p>
          {aviso === null ? null : (
            <p className={aviso.erro ? "erro" : "sucesso"} role="status">
              {aviso.texto}
            </p>
          )}
          {releituraFalhou ? (
            <p className="erro" role="status">
              {t.configurarReleituraFalhou}
            </p>
          ) : null}
          <div className="accoes-tarefa">
            <button type="submit" className="principal" disabled={aGravar}>
              {aGravar ? t.configurarAGravar : t.configurarGravar}
            </button>
            {gravado ? (
              <button
                type="button"
                ref={testarRef}
                disabled={aTestar}
                onClick={() => void testar()}
              >
                {aTestar ? t.faturacaoATestar : t.faturacaoTestar}
              </button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}

/** Uma lista de escolha; nada vem escolhido (Q1 em A). */
function Escolha({
  id,
  rotulo,
  valor,
  grupos,
  aoMudar,
}: {
  id: string;
  rotulo: string;
  valor: string;
  grupos: { rotulo: string | null; opcoes: { id: string; texto: string }[] }[];
  aoMudar: (v: string) => void;
}) {
  const { t } = useHub();
  const vazia = grupos.every((g) => g.opcoes.length === 0);
  // Um id gravado que o Moloni já não devolve: fica à vista, para se trocar.
  const conhecido =
    valor === "" || grupos.some((g) => g.opcoes.some((o) => o.id === valor));
  return (
    <div className="campo">
      {/* Sem lista, não há campo: o rótulo é texto (P2-3). */}
      {vazia ? (
        <p className="rotulo">{rotulo}</p>
      ) : (
        <label htmlFor={`escolha-${id}`}>{rotulo}</label>
      )}
      {vazia ? (
        <p className="secundario">{t.configurarListaVazia}</p>
      ) : (
        <select
          id={`escolha-${id}`}
          value={valor}
          onChange={(e) => {
            aoMudar(e.target.value);
          }}
        >
          <option value="">{t.configurarPorEscolher}</option>
          {conhecido ? null : (
            <option value={valor}>
              {preencher(t.configurarEscolhidoId, { id: valor })}
            </option>
          )}
          {grupos.map((g, i) =>
            g.opcoes.length === 0 ? null : g.rotulo === null ? (
              g.opcoes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.texto}
                </option>
              ))
            ) : (
              <optgroup key={i} label={g.rotulo}>
                {g.opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.texto}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
      )}
    </div>
  );
}

/** O artigo dos portes ou o cliente «Consumidor final», por pesquisa. */
function Pesquisa({
  campo,
  tipo,
  legenda,
  comerciante,
  ligacao,
  valor,
  nome,
  aoEscolher,
}: {
  campo: string;
  tipo: "artigo" | "cliente";
  legenda: string;
  comerciante: string;
  ligacao: string;
  valor: string;
  nome: string | null;
  aoEscolher: (id: string, texto: string) => void;
}) {
  const { t, lingua, navegar } = useHub();
  const [q, setQ] = useState("");
  const [aProcurar, setAProcurar] = useState(false);
  const [resultados, setResultados] = useState<ResultadoNoEmissor[] | null>(
    null,
  );
  const [procurado, setProcurado] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const texto = (r: ResultadoNoEmissor) =>
    r.tipo === "artigo"
      ? preencher(t.configurarArtigoOpcao, {
          nome: r.nome,
          ref: r.referencia ?? "—",
          id: r.id,
        })
      : preencher(t.configurarClienteOpcao, {
          nome: r.nome,
          numero: r.numero ?? "—",
          id: r.id,
        });

  async function procurar() {
    const termo = q.trim();
    if (termo === "") return;
    setAProcurar(true);
    setErro(null);
    try {
      const r = await api.pesquisarNoEmissor(comerciante, ligacao, tipo, termo);
      setResultados(r.dados);
      setProcurado(termo);
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setErro(
        e instanceof ErroHub && e.codigo === "invoices.issuer_error"
          ? preencher(t.configurarMoloniRecusou, { erro: e.detalhe ?? "" })
          : mensagemDeErro(e, t, lingua).texto,
      );
    } finally {
      setAProcurar(false);
    }
  }

  return (
    <fieldset>
      <legend>{legenda}</legend>
      <p className="secundario">
        {valor === ""
          ? t.configurarPorEscolher
          : (nome ?? preencher(t.configurarEscolhidoId, { id: valor }))}
      </p>
      <div className="campo">
        <label htmlFor={`procurar-${campo}`}>{t.configurarPesquisa}</label>
        <input
          id={`procurar-${campo}`}
          type="search"
          autoComplete="off"
          maxLength={60}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter procura; não grava o formulário.
            if (e.key === "Enter") {
              e.preventDefault();
              void procurar();
            }
          }}
        />
      </div>
      <div className="accoes-tarefa">
        <button
          type="button"
          disabled={aProcurar || q.trim() === ""}
          onClick={() => void procurar()}
        >
          {aProcurar ? t.configurarAProcurar : t.configurarProcurar}
        </button>
      </div>
      {erro === null ? null : (
        <p className="erro" role="status">
          {erro}
        </p>
      )}
      {resultados === null ? null : resultados.length === 0 ? (
        <p className="secundario" role="status">
          {preencher(t.configurarSemResultados, { q: procurado })}
        </p>
      ) : (
        <fieldset>
          <legend>{t.configurarResultados}</legend>
          {resultados.map((r) => (
            <label key={r.id} className="opcao">
              <input
                type="radio"
                name={campo}
                value={r.id}
                checked={valor === r.id}
                onChange={() => {
                  aoEscolher(r.id, texto(r));
                }}
              />{" "}
              {texto(r)}
            </label>
          ))}
        </fieldset>
      )}
    </fieldset>
  );
}
