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
