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
  type PrecosNaLista,
  type PrecoVariante,
  type VarianteArtigo,
} from "../api";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import { mensagemDeErro, semSessao } from "../erros";
import { preencher, TAG_LINGUA, type Lingua, type Textos } from "../textos";
import { textoDe } from "./Artigo";

// Os preços do artigo na ficha (docs/22 §17.3), só para consulta: uma caixa
// por lista activa, com o mercado, a moeda e se os preços incluem IVA, e uma
// linha por variante. O Hub não calcula nada: o montante, a redução, o preço
// de referência e o preço por unidade vêm do servidor.

/** O nome de cada unidade do preço por unidade (docs/20 §10.3). */
const UNIDADE: Record<string, string> = {
  kg: "kg",
  l: "l",
  m: "m",
  m2: "m²",
  m3: "m³",
};

type Estado =
  | { tipo: "a_carregar" }
  | { tipo: "pronto"; listas: PrecosNaLista[]; cursor: string | null }
  | { tipo: "erro"; erro: unknown };

export function PrecosDoArtigo({
  comerciante,
  artigo,
  variantes,
}: {
  comerciante: string;
  artigo: string;
  /** As variantes da ficha, pela ordem dela (também as arquivadas). */
  variantes: VarianteArtigo[];
}) {
  const { t, lingua, navegar } = useHub();
  const [estado, setEstado] = useState<Estado>({ tipo: "a_carregar" });
  const [falhaMais, setFalhaMais] = useState<unknown>(null);
  const [aCarregarMais, setACarregarMais] = useState(false);
  const focarDepois = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const falhou = useCallback(
    (e: unknown): boolean => {
      if (!montado.current) return false;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return false;
      }
      return true;
    },
    [navegar],
  );

  const carregar = useCallback(async () => {
    setEstado({ tipo: "a_carregar" });
    try {
      const p = await api.precosDoArtigo(comerciante, artigo, null);
      if (!montado.current) return;
      setEstado({
        tipo: "pronto",
        listas: p.dados,
        cursor: p.ha_mais ? p.cursor_seguinte : null,
      });
    } catch (e) {
      if (falhou(e)) setEstado({ tipo: "erro", erro: e });
    }
  }, [comerciante, artigo, falhou]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O foco muda antes de pintar (como na ficha, revisão do #223).
  useLayoutEffect(() => {
    if (focarDepois.current === null) return;
    document.getElementById(focarDepois.current)?.focus();
    focarDepois.current = null;
  }, [estado, falhaMais]);

  async function mostrarMais() {
    if (estado.tipo !== "pronto" || estado.cursor === null || aCarregarMais) {
      return;
    }
    setACarregarMais(true);
    // O erro anterior e o «Tentar outra vez» ficam até à resposta: o foco
    // não cai na página enquanto se espera (revisão do #252, P3-8).
    try {
      const p = await api.precosDoArtigo(comerciante, artigo, estado.cursor);
      if (!montado.current) return;
      const primeira = p.dados[0];
      if (primeira !== undefined) {
        focarDepois.current = `precos-${primeira.lista.id}`;
      }
      setFalhaMais(null);
      setEstado((antes) =>
        antes.tipo !== "pronto"
          ? antes
          : {
              tipo: "pronto",
              listas: [...antes.listas, ...p.dados],
              cursor: p.ha_mais ? p.cursor_seguinte : null,
            },
      );
    } catch (e) {
      if (falhou(e)) {
        setFalhaMais(e);
        focarDepois.current = "precos-falha-mais";
      }
    } finally {
      if (montado.current) setACarregarMais(false);
    }
  }

  if (estado.tipo === "a_carregar") return <ACarregar />;
  if (estado.tipo === "erro") {
    const e = estado.erro;
    if (
      e instanceof ErroHub &&
      e.estado === 403 &&
      e.codigo === "member.role_escalation"
    ) {
      return <CaixaDeErro erro={{ texto: t.precosSemPermissao }} />;
    }
    if (e instanceof ErroHub && e.estado === 403) {
      return <CaixaDeErro erro={{ texto: t.artigosSemPermissao }} />;
    }
    if (e instanceof ErroHub && e.estado === 404) {
      return <CaixaDeErro erro={{ texto: t.artigoNaoExiste }} />;
    }
    return (
      <CaixaDeErro
        erro={mensagemDeErro(e, t, lingua)}
        aoTentar={() => void carregar()}
      />
    );
  }
  if (estado.listas.length === 0) {
    return <p className="secundario">{t.precosSemListas}</p>;
  }
  return (
    <>
      {estado.listas.map((l) => (
        <ListaDePrecos
          key={l.lista.id}
          lista={l}
          variantes={variantes}
          lingua={lingua}
        />
      ))}
      {falhaMais === null ? null : (
        <div id="precos-falha-mais" tabIndex={-1}>
          <CaixaDeErro
            erro={mensagemDeErro(falhaMais, t, lingua)}
            aoTentar={() => void mostrarMais()}
          />
        </div>
      )}
      {estado.cursor === null ? null : (
        <p>
          <button
            type="button"
            aria-disabled={aCarregarMais}
            onClick={() => void mostrarMais()}
          >
            {aCarregarMais ? t.aCarregar : t.precosMostrarMais}
          </button>
        </p>
      )}
    </>
  );
}

/** «7,90 €» a partir dos cêntimos, na moeda da lista. */
function dinheiro(centimos: number, moeda: string, lingua: Lingua): string {
  return new Intl.NumberFormat(TAG_LINGUA[lingua], {
    style: "currency",
    currency: moeda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centimos / 100);
}

function ListaDePrecos({
  lista,
  variantes,
  lingua,
}: {
  lista: PrecosNaLista;
  variantes: VarianteArtigo[];
  lingua: Lingua;
}) {
  const { t } = useHub();
  const id = `precos-${lista.lista.id}`;
  const porVariante = new Map(lista.precos.map((p) => [p.variante, p]));
  const mercado = lista.mercado;
  return (
    <section className="lista-precos" aria-labelledby={id}>
      <h3 id={id} tabIndex={-1}>
        {lista.lista.nome}
      </h3>
      <p className="secundario">
        {lista.lista.tipo === "b2b" ? t.precosListaB2b : t.precosListaBase}
        {" · "}
        {mercado.nome}
        {mercado.estado === "activo"
          ? null
          : ` (${textoDe(t, `estadoMercado_${mercado.estado}`, mercado.estado)})`}
        {" · "}
        <span translate="no">{mercado.moeda}</span>
        {" · "}
        {mercado.preco_inclui_iva ? t.precosComIva : t.precosSemIva}
      </p>
      <table className="tabela-larga" aria-labelledby={id}>
        <thead>
          <tr>
            <th scope="col">{t.artigosSku}</th>
            <th scope="col">{t.colunaPreco}</th>
            <th scope="col">{t.colunaPrecoUnidade}</th>
          </tr>
        </thead>
        <tbody>
          {variantes.map((v) => {
            const p = porVariante.get(v.id);
            return (
              <tr key={v.id}>
                <td data-rotulo={t.artigosSku}>
                  <span translate="no">{v.sku}</span>
                  {v.estado === "arquivada" ? (
                    <span className="secundario">
                      {" "}
                      ({t.estadoVariante_arquivada})
                    </span>
                  ) : null}
                </td>
                <td data-rotulo={t.colunaPreco}>
                  {p === undefined ? (
                    <span className="secundario">{t.precosSemPreco}</span>
                  ) : (
                    <Preco preco={p} moeda={mercado.moeda} lingua={lingua} />
                  )}
                </td>
                <td data-rotulo={t.colunaPrecoUnidade}>
                  {p === undefined || p.gratuito || p.preco_por_unidade === null
                    ? "—"
                    : porUnidade(p.preco_por_unidade, mercado.moeda, lingua, t)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** O preço de uma variante: o montante, ou a redução com o de antes. */
function Preco({
  preco,
  moeda,
  lingua,
}: {
  preco: PrecoVariante;
  moeda: string;
  lingua: Lingua;
}) {
  const { t } = useHub();
  const data = (iso: string) =>
    // Com a hora: o fim é o instante em que deixa de valer (revisão do #252,
    // P3-5), na hora deste dispositivo, como os outros ecrãs do Hub.
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const condicoes: string[] = [];
  if (preco.quantidade_minima !== 1) {
    condicoes.push(preencher(t.precosMinimo, { n: preco.quantidade_minima }));
  }
  if (preco.multiplo !== 1) {
    condicoes.push(preencher(t.precosMultiplo, { n: preco.multiplo }));
  }
  const r = preco.reducao;
  return (
    <>
      {preco.gratuito ? (
        t.precosGratuito
      ) : r === null ? (
        dinheiro(preco.montante, moeda, lingua)
      ) : (
        <>
          <strong>{dinheiro(r.montante, moeda, lingua)}</strong>
          <br />
          <span className="secundario">
            {preencher(t.precosAntes, {
              preco: dinheiro(r.preco_referencia, moeda, lingua),
            })}
            {r.fim === null
              ? null
              : ` ${preencher(t.precosAte, { data: data(r.fim) })}`}
          </span>
        </>
      )}
      {condicoes.length === 0 ? null : (
        <>
          <br />
          <span className="secundario">{condicoes.join(" · ")}</span>
        </>
      )}
    </>
  );
}

/**
 * «526,6667 €/l, com quatro casas»: o valor da API tal como vem, formatado a
 * partir do texto (sem passar por um número, que perde casas em valores
 * grandes; revisão do #252, P3-6).
 */
function porUnidade(
  u: NonNullable<PrecoVariante["preco_por_unidade"]>,
  moeda: string,
  lingua: Lingua,
  t: Textos,
): string {
  const [inteira = "0", casas = ""] = u.valor.split(".");
  const formato = new Intl.NumberFormat(TAG_LINGUA[lingua], {
    style: "currency",
    currency: moeda,
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  const inteiraFormatada = new Intl.NumberFormat(TAG_LINGUA[lingua], {
    useGrouping: true,
  }).format(BigInt(inteira));
  let jaPosInteira = false;
  const valor = formato
    .formatToParts(1)
    .map((parte) => {
      if (parte.type === "integer") {
        if (jaPosInteira) return "";
        jaPosInteira = true;
        return inteiraFormatada;
      }
      if (parte.type === "group") return "";
      if (parte.type === "fraction") return casas.padEnd(4, "0").slice(0, 4);
      return parte.value;
    })
    .join("");
  return preencher(t.precosPorUnidade, {
    valor,
    unidade: UNIDADE[u.unidade] ?? u.unidade,
  });
}
