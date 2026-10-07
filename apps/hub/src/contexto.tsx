import { createContext, useContext } from "react";
import type { MensagemDeErro } from "./erros";
import type { Lingua, Textos } from "./textos";

// O que todos os ecrãs partilham: os textos da língua escolhida e a
// navegação entre páginas (sem biblioteca: o History API chega para quatro
// páginas).

export interface Contexto {
  t: Textos;
  lingua: Lingua;
  navegar: (caminho: string) => void;
}

export const ContextoHub = createContext<Contexto | null>(null);

export function useHub(): Contexto {
  const c = useContext(ContextoHub);
  if (c === null) throw new Error("fora do ContextoHub");
  return c;
}

/** Uma caixa de erro, anunciada aos leitores de ecrã. */
export function CaixaDeErro({
  erro,
  aoTentar,
}: {
  erro: MensagemDeErro;
  aoTentar?: () => void;
}) {
  const { t } = useHub();
  return (
    <div className="erro" role="alert">
      <p>
        <strong>{erro.texto}</strong>
      </p>
      {erro.referencia === undefined ? null : (
        <p className="secundario">
          {t.erroReferencia.replace("{ref}", erro.referencia)}
        </p>
      )}
      {aoTentar === undefined ? null : (
        <button type="button" onClick={aoTentar}>
          {t.tentarOutraVez}
        </button>
      )}
    </div>
  );
}

/** «A carregar», anunciado sem roubar o foco. */
export function ACarregar() {
  const { t } = useHub();
  return (
    <p className="secundario" role="status">
      {t.aCarregar}
    </p>
  );
}
