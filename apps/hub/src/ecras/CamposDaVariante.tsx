import {
  ORIGENS_GTIN,
  UNIDADES_DE_CONTEUDO,
  UNIDADES_DE_VENDA,
  type VarianteArtigo,
} from "../api";
import { useHub } from "../contexto";
import { TAG_LINGUA, type Textos } from "../textos";
import {
  MAXIMO_CLASSE_ADR,
  type CampoVariante,
  type CamposVariante,
} from "../variante";

// Os campos de uma variante (docs/22 §23.2 e §24.2), partilhados por
// «Editar a variante» e «Acrescentar variante»: unidade e conteúdo, código
// de barras, peso e medidas, mercadorias perigosas. A unidade e o conteúdo
// só se editam quando `editaUnidade`; senão, lêem-se da variante guardada.

export const idDoCampo = (campo: CampoVariante) => `variante-${campo}`;

/** m² e m³ como se escrevem; os outros, como a API os diz. */
export const simbolo = (u: string) =>
  u === "m2" ? "m²" : u === "m3" ? "m³" : u;

export const conteudoDe = (x: VarianteArtigo, numero: (n: number) => string) =>
  x.conteudo_quantidade === null
    ? "—"
    : `${numero(x.conteudo_quantidade)}\u00a0${simbolo(x.conteudo_unidade ?? "")}`.trim();

export function CamposDaVariante({
  campos,
  erros,
  editaUnidade,
  guardada,
  mudar,
}: {
  campos: CamposVariante;
  erros: Partial<Record<CampoVariante, keyof Textos>>;
  editaUnidade: boolean;
  /** A variante guardada: a unidade e o conteúdo lêem-se dela. */
  guardada: VarianteArtigo | null;
  mudar: (campo: CampoVariante, valor: string) => void;
}) {
  const { t, lingua } = useHub();
  const idDe = idDoCampo;
  const numero = (n: number) =>
    new Intl.NumberFormat(TAG_LINGUA[lingua]).format(n);

  /** O erro de um campo: o texto ao lado e o que o liga ao campo. */
  function erroDe(campo: CampoVariante) {
    const texto = erros[campo];
    const id = idDe(campo);
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

  function campoDeTexto(
    campo: CampoVariante,
    rotulo: string,
    extra: {
      inputMode?: "numeric" | "text";
      maxLength?: number;
      ajuda?: string;
    } = {},
  ) {
    const id = idDe(campo);
    const e = erroDe(campo);
    const ajuda = extra.ajuda === undefined ? undefined : `${id}-ajuda`;
    return (
      <div className="campo">
        <label htmlFor={id}>{rotulo}</label>
        <input
          id={id}
          inputMode={extra.inputMode ?? "numeric"}
          maxLength={extra.maxLength}
          autoComplete="off"
          value={campos[campo]}
          {...e.props}
          aria-describedby={
            [e.props["aria-describedby"], ajuda]
              .filter((x) => x !== undefined)
              .join(" ") || undefined
          }
          onChange={(ev) => {
            mudar(campo, ev.target.value);
          }}
        />
        {extra.ajuda === undefined ? null : (
          <p id={ajuda} className="secundario">
            {extra.ajuda}
          </p>
        )}
        {e.mensagem}
      </div>
    );
  }

  return (
    <>
      <fieldset className="variante-nova">
        <legend>{t.varianteGrupoUnidade}</legend>
        {editaUnidade || guardada === null ? (
          <>
            <div className="linha">
              <div className="campo">
                <label htmlFor={idDe("unidade")}>{t.colunaUnidade}</label>
                <select
                  id={idDe("unidade")}
                  value={campos.unidade}
                  onChange={(e) => {
                    mudar("unidade", e.target.value);
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
              {campoDeTexto("quantidade", t.artigoNovoQuantidade)}
              <div className="campo">
                <label htmlFor={idDe("unidadeConteudo")}>
                  {t.artigoNovoUnidadeConteudo}
                </label>
                <select
                  id={idDe("unidadeConteudo")}
                  value={campos.unidadeConteudo}
                  {...erroDe("unidadeConteudo").props}
                  onChange={(e) => {
                    mudar("unidadeConteudo", e.target.value);
                  }}
                >
                  <option value="">{t.artigoNovoSemUnidade}</option>
                  {UNIDADES_DE_CONTEUDO.map((u) => (
                    <option key={u} value={u}>
                      {simbolo(u)}
                    </option>
                  ))}
                </select>
                {erroDe("unidadeConteudo").mensagem}
              </div>
            </div>
          </>
        ) : (
          <>
            <dl className="valores-actuais">
              <dt>{t.colunaUnidade}</dt>
              <dd>{t[`unidade_${guardada.unidade_de_venda}`]}</dd>
              <dt>{t.colunaConteudo}</dt>
              <dd>{conteudoDe(guardada, numero)}</dd>
            </dl>
            <p className="secundario">{t.varianteUnidadeSoRascunho}</p>
          </>
        )}
      </fieldset>
      <fieldset className="variante-nova">
        <legend>{t.varianteGrupoGtin}</legend>
        <div className="linha">
          {campoDeTexto("gtin", t.colunaGtin)}
          {campos.gtin.trim() === "" ? null : (
            <div className="campo">
              <label htmlFor={idDe("gtinOrigem")}>
                {t.artigoNovoGtinOrigem}
              </label>
              <select
                id={idDe("gtinOrigem")}
                value={campos.gtinOrigem}
                {...erroDe("gtinOrigem").props}
                onChange={(e) => {
                  mudar("gtinOrigem", e.target.value);
                }}
              >
                <option value="">{t.artigoNovoEscolher}</option>
                {ORIGENS_GTIN.map((o) => (
                  <option key={o} value={o}>
                    {t[`gtinOrigem_${o}`]}
                  </option>
                ))}
              </select>
              {erroDe("gtinOrigem").mensagem}
            </div>
          )}
        </div>
      </fieldset>
      <fieldset className="variante-nova">
        <legend>{t.varianteGrupoMedidas}</legend>
        <div className="linha">
          {campoDeTexto("peso", t.artigoNovoPeso)}
          {campoDeTexto("comprimento", t.artigoNovoComprimento)}
          {campoDeTexto("largura", t.artigoNovoLargura)}
          {campoDeTexto("altura", t.artigoNovoAltura)}
        </div>
        {campos.peso.trim() === "" ? (
          <p className="secundario">{t.artigoNovoSemPeso}</p>
        ) : null}
      </fieldset>
      <fieldset className="variante-nova">
        <legend>{t.varianteGrupoPerigosas}</legend>
        <div className="linha">
          {campoDeTexto("onu", t.varianteOnu, {
            inputMode: "text",
            // Com folga para espaços colados à volta (P3-2).
            maxLength: 10,
            ajuda: t.varianteOnuAjuda,
          })}
          {campoDeTexto("classeAdr", t.varianteClasseAdr, {
            inputMode: "text",
            maxLength: MAXIMO_CLASSE_ADR,
          })}
        </div>
      </fieldset>
    </>
  );
}
