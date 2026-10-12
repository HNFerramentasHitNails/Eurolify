import { useState } from "react";
import { useHub } from "../contexto";

/**
 * «Copiar» para a área de transferência, com a confirmação anunciada. O
 * `rotulo` dá um nome próprio ao botão quando há vários na página.
 */
export function Copiar({ texto, rotulo }: { texto: string; rotulo?: string }) {
  const { t } = useHub();
  const [estado, setEstado] = useState<"antes" | "copiado" | "falhou">("antes");
  return (
    <>
      <button
        type="button"
        {...(rotulo === undefined ? {} : { "aria-label": rotulo })}
        onClick={() => {
          navigator.clipboard.writeText(texto).then(
            () => {
              setEstado("copiado");
            },
            () => {
              setEstado("falhou");
            },
          );
        }}
      >
        <span aria-live="polite">
          {estado === "copiado" ? t.copiado : t.copiar}
        </span>
      </button>
      {estado === "falhou" ? (
        <p className="secundario" role="status">
          {t.copiarFalhou}
        </p>
      ) : null}
    </>
  );
}
