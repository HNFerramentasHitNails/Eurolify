import { useState } from "react";
import { useHub } from "../contexto";

/** «Copiar» para a área de transferência, com a confirmação anunciada. */
export function Copiar({ texto }: { texto: string }) {
  const { t } = useHub();
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(texto).then(() => {
          setCopiado(true);
        });
      }}
    >
      <span aria-live="polite">{copiado ? t.copiado : t.copiar}</span>
    </button>
  );
}
