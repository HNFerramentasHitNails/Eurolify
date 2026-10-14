import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  api,
  ErroHub,
  type DiferencaPagamento,
  type Eu,
  type Membros,
} from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import {
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { talvezFeito } from "../faturacao";
import { entradaDe } from "../modulos";
import {
  casoDoDialogo,
  emDinheiro,
  enderecoDiferencas,
  estadoDoPagamento,
  provaEmTexto,
  separadorDe,
  TEXTO_DO_ERRO_DA_DIFERENCA,
} from "../pagamentos";
import { comRecente } from "../passkeys";
import { curto, motivoDe } from "../tarefas";
import { preencher, TAG_LINGUA, type Textos } from "../textos";
import { Dialogo } from "./Dialogo";

// A fila de diferenças de pagamento (docs/22 §34; Diogo, 14/10/2026: «sim,
// aprovo o desenho com a Q1 em a)»). O dono, o gestor e o apoio vêem; só o
// dono resolve, com o texto e a passkey outra vez (autenticação recente).
// Num pagamento incerto diz se foi pago; a API decide sempre.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;

/** O erro de resolver em linguagem comum. */
function mensagemDaDiferenca(
  e: unknown,
  t: Textos,
  lingua: Parameters<typeof mensagemDeErro>[2],
): string {
  if (e instanceof ErroHub && e.codigo !== undefined) {
    const chave = TEXTO_DO_ERRO_DA_DIFERENCA[e.codigo];
    if (chave !== undefined) return t[chave];
  }
  return mensagemDeErro(e, t, lingua).texto;
}

export function DiferencasPagamento({
  comerciante,
  consulta,
}: {
  comerciante: string | null;
  consulta: string;
}) {
  const { t, lingua, navegar } = useHub();
  const separador = separadorDe(consulta);
  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);
  const c = comerciante ?? "";
  const [dados, setDados] = useState<{
    eu: Eu;
    lista: DiferencaPagamento[];
    limite: number;
  } | null>(null);
  const [membros, setMembros] = useState<Membros["membros"]>([]);
  const [falha, setFalha] = useState<unknown>(null);
  const [aResolver, setAResolver] = useState<DiferencaPagamento | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoRef = useRef<HTMLParagraphElement>(null);
  const ultimo = useRef(0);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [eu, r] = await Promise.all([
        api.eu(),
        api.diferencasPagamento(c, separador),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setDados({ eu, lista: r.dados, limite: r.limite });
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
      return;
    }
    // O nome de quem resolveu: se falhar, fica o resto.
    if (separador === "resolvida") {
      try {
        const m = await api.membros(c);
        if (este === ultimo.current) setMembros(m.membros);
      } catch {
        // sem nomes, diz-se «uma pessoa da equipa»
      }
    }
  }, [valido, c, separador, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (aviso !== null) avisoRef.current?.focus();
  }, [aviso]);

  /** Relê a lista sem tirar a página; null se falhar. */
  const reler = useCallback(async (): Promise<DiferencaPagamento[] | null> => {
    if (!valido) return null;
    try {
      const r = await api.diferencasPagamento(c, separador);
      setDados((d) =>
        d === null ? d : { ...d, lista: r.dados, limite: r.limite },
      );
      return r.dados;
    } catch {
      return null;
    }
  }, [valido, c, separador]);

  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const meu = dados?.eu.comerciantes.find((x) => x.comerciante === c);
  const resolve = meu?.ambitos.includes("payments:resolve") === true;
  const euId =
    dados === null ? null : `per_${dados.eu.pessoa.replace(/^per_/, "")}`;
  const tag = TAG_LINGUA[lingua];
  const hora = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const quemResolveu = (por: string | null) => {
    if (por?.startsWith("pessoa:") === true) {
      const pessoa = por.slice("pessoa:".length);
      if (pessoa === euId) return t.diferencaPorSi;
      return (
        membros.find((m) => m.pessoa === pessoa)?.nome ??
        t.diferencaPessoaDesconhecida
      );
    }
    // Pela integração: nunca o identificador técnico.
    return t.diferencaPorIntegracao;
  };

  const separadores: ["aberta" | "resolvida", keyof Textos][] = [
    ["aberta", "diferencasPorResolver"],
    ["resolvida", "diferencasResolvidas"],
  ];

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.diferencasTitulo}
        {meu === undefined ? "" : ` — ${meu.nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : (
        <>
          <p>{t.diferencasExplicacao}</p>
          <nav aria-label={t.diferencasSeparadores}>
            <ul className="separadores">
              {separadores.map(([id, texto]) => (
                <li key={id}>
                  <LigacaoInterna
                    href={enderecoDiferencas(c, id)}
                    {...(id === separador
                      ? { "aria-current": "page" as const }
                      : {})}
                  >
                    {t[texto]}
                  </LigacaoInterna>
                </li>
              ))}
            </ul>
          </nav>
          {aviso === null ? null : (
            <p className="sucesso" role="status" tabIndex={-1} ref={avisoRef}>
              {aviso}
            </p>
          )}
          {erro !== null && dados === null ? (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          ) : dados === null ? (
            <ACarregar />
          ) : (
            <>
              {/* Uma releitura que falhou não esconde a lista (P3-7). */}
              {erro === null ? null : (
                <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
              )}
              {separador === "resolvida" &&
              dados.lista.length >= dados.limite ? (
                <p className="secundario" role="status">
                  {preencher(t.diferencasAsMaisRecentes, { n: dados.limite })}
                </p>
              ) : null}
            </>
          )}
          {dados === null ? null : dados.lista.length === 0 ? (
            <p role="status">
              {separador === "aberta"
                ? t.diferencasVazio
                : t.diferencasVazioResolvidas}
            </p>
          ) : (
            <table className="tabela-larga">
              <thead>
                <tr>
                  <th scope="col">{t.diferencasColunaMotivo}</th>
                  <th scope="col">{t.diferencasColunaPagamento}</th>
                  <th scope="col">{t.diferencasColunaProva}</th>
                  <th scope="col">
                    {separador === "aberta"
                      ? t.diferencasColunaChegou
                      : t.diferencasColunaResolucao}
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.lista.map((d) => (
                  <tr key={d.id}>
                    <td data-rotulo={t.diferencasColunaMotivo}>
                      {motivoDe(t, d.motivo)}
                      {separador === "aberta" && resolve ? (
                        <>
                          <br />
                          <button
                            type="button"
                            aria-label={preencher(t.diferencaResolverDe, {
                              motivo: motivoDe(t, d.motivo),
                              data: hora(d.criada_em),
                            })}
                            onClick={() => {
                              setAviso(null);
                              setAResolver(d);
                            }}
                          >
                            {t.diferencaResolver}
                          </button>
                        </>
                      ) : null}
                    </td>
                    <td data-rotulo={t.diferencasColunaPagamento}>
                      <Pagamento d={d} tag={tag} />
                    </td>
                    <td data-rotulo={t.diferencasColunaProva}>
                      {provaEmTexto(t, d, tag)}
                    </td>
                    <td
                      data-rotulo={
                        separador === "aberta"
                          ? t.diferencasColunaChegou
                          : t.diferencasColunaResolucao
                      }
                    >
                      {d.estado === "resolvida" && d.resolvida_em !== null ? (
                        <>
                          {preencher(t.diferencaResolvidaEm, {
                            data: hora(d.resolvida_em),
                            quem: quemResolveu(d.resolvida_por),
                          })}
                          <br />
                          <span className="secundario">{d.resolucao}</span>
                        </>
                      ) : (
                        hora(d.criada_em)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {aResolver === null ? null : (
        <DialogoResolver
          comerciante={c}
          diferenca={aResolver}
          reler={reler}
          aoFechar={(texto) => {
            setAResolver(null);
            if (texto !== null) setAviso(texto);
          }}
        />
      )}
    </section>
  );
}

/** O pagamento de uma diferença: método, montante, estado e encomenda. */
function Pagamento({ d, tag }: { d: DiferencaPagamento; tag: string }) {
  const { t } = useHub();
  const p = d.pagamento;
  if (p === null) return <>{t.diferencaSemPagamento}</>;
  const metodo =
    p.metodo === null
      ? null
      : ((t as Record<string, string>)[`metodoPagamento_${p.metodo}`] ??
        p.metodo);
  return (
    <>
      {[
        metodo,
        p.montante === null ? null : emDinheiro(p.montante, p.moeda, tag),
        p.estado === null ? null : estadoDoPagamento(t, p.estado),
      ]
        .filter((x) => x !== null)
        .join(" · ")}
      {p.encomenda === null ? null : (
        <>
          <br />
          <span className="secundario" translate="no" title={p.encomenda}>
            {preencher(t.decidirEncomenda, { id: curto(p.encomenda) })}
          </span>
        </>
      )}
    </>
  );
}

function DialogoResolver({
  comerciante,
  diferenca: d,
  reler,
  aoFechar,
}: {
  comerciante: string;
  diferenca: DiferencaPagamento;
  reler: () => Promise<DiferencaPagamento[] | null>;
  aoFechar: (texto: string | null) => void;
}) {
  const { t, lingua, navegar } = useHub();
  const caso = casoDoDialogo(d);
  const [resolucao, setResolucao] = useState("");
  const [pago, setPago] = useState<"capturado" | "falhado" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const idTexto = useId();
  const tag = TAG_LINGUA[lingua];

  /** Se as resolvidas já a trazem, ficou feita. */
  const jaResolvida = async () => {
    try {
      const r = await api.diferencasPagamento(comerciante, "resolvida");
      return r.dados.some((x) => x.id === d.id);
    } catch {
      return false;
    }
  };

  async function enviar() {
    const texto = resolucao.trim();
    if (texto === "") {
      setErro(t.diferencaFaltaTexto);
      return;
    }
    if (caso === "incerto" && pago === null) {
      setErro(t.diferencaFaltaPago);
      return;
    }
    setErro(null);
    setAEnviar(true);
    try {
      await comRecente(() =>
        api.resolverDiferenca(comerciante, d.id, {
          resolucao: texto,
          ...(caso === "incerto" && pago !== null ? { pagamento: pago } : {}),
        }),
      );
      await reler();
      aoFechar(t.diferencaResolvida);
    } catch (e) {
      const f = await falhaDeAccao(e);
      if (f === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      if (f instanceof ErroHub && f.codigo === "payments.immutable") {
        // Já resolvida (por outra pessoa, ou a resposta perdeu-se).
        await reler();
        aoFechar(t.diferencaJaResolvida);
        return;
      }
      if (f instanceof ErroHub && talvezFeito(f)) {
        // A resposta perdeu-se: se já está resolvida, ficou feito (§34.2).
        if (await jaResolvida()) {
          await reler();
          aoFechar(t.diferencaResolvida);
          return;
        }
        setErro(t.diferencaNaoConfirmado);
        setAEnviar(false);
        return;
      }
      setErro(mensagemDaDiferenca(f, t, lingua));
      setAEnviar(false);
    }
  }

  return (
    <Dialogo
      id="resolver"
      titulo={t.diferencaResolverTitulo}
      aoFechar={() => {
        aoFechar(null);
      }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <p>
          <strong>{motivoDe(t, d.motivo)}</strong>
          <br />
          {provaEmTexto(t, d, tag)}
        </p>
        {caso === "reembolso" ? (
          <p className="aviso">{t.diferencaReembolsoAviso}</p>
        ) : null}
        {caso === "incerto" ? (
          <fieldset>
            <legend>{t.diferencaPagou}</legend>
            <p className="secundario">{t.diferencaPagouAviso}</p>
            <label className="opcao">
              <input
                type="radio"
                name="pago"
                aria-required="true"
                checked={pago === "capturado"}
                onChange={() => {
                  setPago("capturado");
                }}
              />{" "}
              {t.diferencaPagouSim}
            </label>
            <label className="opcao">
              <input
                type="radio"
                name="pago"
                aria-required="true"
                checked={pago === "falhado"}
                onChange={() => {
                  setPago("falhado");
                }}
              />{" "}
              {t.diferencaPagouNao}
            </label>
          </fieldset>
        ) : null}
        <div className="campo">
          <label htmlFor={idTexto}>{t.diferencaOQueSeFez}</label>
          <textarea
            id={idTexto}
            value={resolucao}
            maxLength={2000}
            rows={4}
            required
            onChange={(e) => {
              setResolucao(e.target.value);
            }}
          />
        </div>
        {erro === null ? null : <CaixaDeErro erro={{ texto: erro }} />}
        <div className="accoes-tarefa">
          <button type="submit" className="principal" disabled={aEnviar}>
            {aEnviar ? t.aCarregar : t.diferencaConfirmar}
          </button>
          <button
            type="button"
            // Durante o envio não se fecha: o pedido seguia e a lista ficava
            // velha (revisão do #458, P3-6).
            disabled={aEnviar}
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
