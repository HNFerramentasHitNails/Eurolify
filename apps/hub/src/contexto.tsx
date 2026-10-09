import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import type { MensagemDeErro } from "./erros";
import { preencher, type Lingua, type Textos } from "./textos";

// O que todos os ecrãs partilham: os textos da língua escolhida e a
// navegação entre páginas (sem biblioteca: o History API chega para quatro
// páginas).

export interface Contexto {
  t: Textos;
  lingua: Lingua;
  /**
   * Vai para outra página. `substituir` nos redireccionamentos (sem sessão,
   * depois de entrar ou sair), para «voltar atrás» não regressar a eles
   * (revisão do #158, P3-3).
   */
  navegar: (caminho: string, opcoes?: { substituir?: boolean }) => void;
  /**
   * «Superfícies opacas» (docs/hub-modular-glassmorphism.md): tira o vidro.
   * Só na memória da página, até fechar ou recarregar; nada no navegador.
   */
  opaco: boolean;
  mudarOpaco: (opaco: boolean) => void;
  /**
   * Uma guarda de saída: enquanto um ecrã tiver alterações por guardar,
   * regista aqui a pergunta (devolve true para sair). Vale para a navegação
   * do Hub, para o «voltar» do navegador e para «Sair» (docs/22 §13.4;
   * revisão do #217, P2-1). `null` tira-a.
   */
  definirGuarda: (pergunta: (() => boolean) | null) => void;
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
  id,
}: {
  erro: MensagemDeErro;
  aoTentar?: () => void;
  /** Para um campo a apontar para o erro (`aria-describedby`). */
  id?: string;
}) {
  const { t } = useHub();
  if (erro.neutro === true) {
    return (
      <p className="secundario" role="status" id={id}>
        {erro.texto}
      </p>
    );
  }
  return (
    <div className="erro" role="alert" id={id}>
      <p>
        <strong>{erro.texto}</strong>
      </p>
      {erro.referencia === undefined ? null : (
        <p className="secundario">
          {preencher(t.erroReferencia, { ref: erro.referencia })}
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

/**
 * Uma ligação para outra página do Hub. O clique simples navega sem
 * recarregar; com Ctrl/Cmd, Shift, Alt ou o botão do meio, fica o
 * comportamento do navegador (abrir noutro separador ou janela).
 */
export function LigacaoInterna({
  href,
  children,
  ...resto
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  href: string;
  children: ReactNode;
}) {
  const { navegar } = useHub();
  return (
    <a
      {...resto}
      href={href}
      onClick={(e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        navegar(href);
      }}
    >
      {children}
    </a>
  );
}
