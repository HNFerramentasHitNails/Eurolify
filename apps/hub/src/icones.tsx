import type { IdModulo } from "./modulos";

// Os ícones dos módulos: SVG desenhado aqui, sem bibliotecas nem pedidos a
// outros sítios. Decorativos: o nome é o rótulo visível ao lado.

const TRACOS: Record<IdModulo, readonly string[]> = {
  // Duas pessoas.
  equipa: [
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M2.5 20a6.5 6.5 0 0 1 13 0",
    "M16 4.3a3.5 3.5 0 0 1 0 6.4",
    "M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
  ],
  // Uma caixa.
  artigos: [
    "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z",
    "M3.5 7.5 12 12l8.5-4.5",
    "M12 12v9",
  ],
  // Uma lista com um visto e um relógio.
  decidir: [
    "M4 6h9",
    "M4 12h6",
    "M4 18h5",
    "M17.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z",
    "M17.5 14.5v2l1.5 1",
  ],
  // Um saco de compras.
  encomendas: ["M5 8h14l-1 12H6L5 8Z", "M9 8V6.5a3 3 0 0 1 6 0V8"],
  // Uma folha com linhas e um canto dobrado.
  faturacao: [
    "M6 3h8.5L19 7.5V21H6V3Z",
    "M14.5 3v4.5H19",
    "M9 11.5h7",
    "M9 15h7",
    "M9 18.5h4",
  ],
  // Uma caixa com uma seta para fora.
  expedir: [
    "M3.5 8 11 4l7.5 4v8L11 20l-7.5-4V8Z",
    "M3.5 8 11 12l7.5-4",
    "M11 12v8",
    "M16 14h5.5",
    "M19 11.5 21.5 14 19 16.5",
  ],
  // Uma caixa com uma seta para trás.
  devolucoes: [
    "M5.5 8 13 4l7.5 4v8L13 20l-7.5-4V8Z",
    "M5.5 8 13 12l7.5-4",
    "M13 12v8",
    "M8 14H2.5",
    "M5 11.5 2.5 14 5 16.5",
  ],
  // Um camião.
  envios: [
    "M2.5 6.5h11v10h-11Z",
    "M13.5 10h4l3 3.5v3h-7",
    "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  ],
  // Um cartão com uma marca de atenção.
  pagamentos: [
    "M2.5 6h19v12h-19Z",
    "M2.5 10h19",
    "M6 14.5h4",
    "M17 13v1.5",
    "M17 16.5v.01",
  ],
  // Uma chave.
  chaves: [
    "M8 15.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z",
    "M12.5 11H21",
    "M18 11v3.5",
    "M21 11v2.5",
  ],
};

export function IconeModulo({ id }: { id: IdModulo }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACOS[id].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * O triângulo do aviso (docs/22 §26.2): vai sempre com o texto ao lado, para
 * o aviso não se dizer só pela cor. Decorativo para os leitores de ecrã.
 */
export function IconeAviso() {
  return (
    <svg
      className="icone-aviso"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}
