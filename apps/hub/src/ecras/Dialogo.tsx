import { useEffect, useRef, type ReactNode } from "react";

// Um diálogo modal (docs/22 §30.3): o `<dialog>` do navegador prende o foco
// lá dentro e fecha-se com Esc. Ao sair, o foco volta a quem o abriu.

export function Dialogo({
  id,
  titulo,
  aoFechar,
  children,
}: {
  id: string;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const antes =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const d = ref.current;
    if (d !== null && !d.open) d.showModal();
    return () => {
      if (d?.open === true) d.close();
      antes?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialogo"
      aria-labelledby={`${id}-titulo`}
      onCancel={(e) => {
        // Esc: fecha pelo ecrã, para o estado do React ficar certo.
        e.preventDefault();
        aoFechar();
      }}
    >
      <h2 id={`${id}-titulo`}>{titulo}</h2>
      {children}
    </dialog>
  );
}
