import { useState } from "react";
import { useHub } from "../contexto";

/** «Copiar» para a área de transferência, com a confirmação anunciada. */
export function Copiar({ texto }: { texto: string }) {
  const { t } = useHub();
  const [estado, setEstado] = useState<"antes" | "copiado" | "falhou">("antes");
  return (
    <>
      <button
        type="button"
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
