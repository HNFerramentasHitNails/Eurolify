import { useMemo } from "react";
import { encode } from "uqr";

// Um código QR desenhado no próprio Hub (uqr, sem pedidos a outro sítio;
// docs/22 §9.2). Leva o segredo do autenticador: só se mostra enquanto a
// pessoa configura, nunca se guarda nem vai para um endereço.

export function Qr({ texto, rotulo }: { texto: string; rotulo: string }) {
  const { data, size } = useMemo(
    () => encode(texto, { ecc: "M", border: 4 }),
    [texto],
  );
  // Um só caminho com um quadrado por módulo escuro.
  const caminho = useMemo(() => {
    let d = "";
    data.forEach((linha, y) => {
      linha.forEach((escuro, x) => {
        if (escuro) d += `M${String(x)} ${String(y)}h1v1h-1z`;
      });
    });
    return d;
  }, [data]);
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={rotulo}
      shapeRendering="crispEdges"
    >
      {/* Sempre preto sobre branco, também no tema escuro: é o que os
          leitores de QR lêem melhor. */}
      <rect width={size} height={size} fill="#ffffff" />
      <path d={caminho} fill="#000000" />
    </svg>
  );
}
