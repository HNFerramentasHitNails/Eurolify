import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  api,
  ErroHub,
  PAPEIS,
  type Eu,
  type Membros,
  type Papel,
} from "../api";
import { ligacaoDoConvite } from "../convite";
import { ACarregar, CaixaDeErro, useHub } from "../contexto";
import {
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { papeisQuePodeDar } from "../papeis";
import { comRecente } from "../passkeys";
import { preencher, TAG_LINGUA, type Textos } from "../textos";
import { Copiar } from "./Copiar";

// A equipa de um comerciante: membros, convites em aberto (só o dono os
// recebe), convidar e cancelar (docs/22 §3); mudar o papel, tirar da equipa
// e sair (§10). O servidor decide quem pode o
// quê; o ecrã só não oferece o formulário a quem não convida (armazém e
// apoio) e mostra a recusa do servidor para o resto.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;

export function Equipa({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const [eu, setEu] = useState<Eu | null>(null);
  const [dados, setDados] = useState<Membros | null>(null);
  // Os erros guardam-se crus e traduzem-se ao mostrar: mudar a língua não
  // volta a pedir nada (revisão do #158, P3-7).
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  // O erro de uma acção (cancelar) fica à parte: recarregar a lista não o
  // apaga.
  const [falhaAccao, setFalhaAccao] = useState<unknown>(null);
  const erroAccao: MensagemDeErro | null =
    falhaAccao === null ? null : mensagemDeErro(falhaAccao, t, lingua);
  // A mensagem de êxito guarda a chave do texto: muda com a língua.
  // O papel guarda-se como código e traduz-se ao mostrar (P3-1).
  const [aviso, setAviso] = useState<{
    chave: keyof Textos;
    valores?: Record<string, string>;
    papel?: Papel;
  } | null>(null);
  // A mensagem de êxito recebe o foco: o botão ou a linha desaparecem
  // (revisão do #188, P3-5).
  const caixaDoAviso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aviso !== null) caixaDoAviso.current?.focus();
  }, [aviso]);
  // Uma acção de cada vez: as que pedem a passkey trocam o cookie (revisão
  // do #174, P2-3).
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  // O papel escolhido em cada linha, antes de «Mudar».
  const [escolhidos, setEscolhidos] = useState<Record<string, Papel>>({});
  // Só a resposta do último pedido conta (P3-7).
  const ultimo = useRef(0);

  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);

  const carregar = useCallback(async () => {
    if (!valido) return;
    const este = ++ultimo.current;
    try {
      const [quem, membros] = await Promise.all([
        api.eu(),
        api.membros(comerciante),
      ]);
      if (este !== ultimo.current) return;
      setFalha(null);
      setEu(quem);
      setDados(membros);
    } catch (e) {
      if (este !== ultimo.current) return;
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [valido, comerciante, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const data = (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], { dateStyle: "medium" }).format(
      new Date(iso),
    );

  const meu = eu?.comerciantes.find((c) => c.comerciante === comerciante);

  function cancelar(convite: string, email: string) {
    if (
      comerciante === null ||
      !window.confirm(preencher(t.cancelarConfirmar, { email }))
    ) {
      return;
    }
    // Uma acção de cada vez, como as outras (revisão do #188, P3-3).
    void accao(async () => {
      await api.cancelarConvite(comerciante, convite);
      setAviso({ chave: "conviteCancelado" });
      await carregar();
    });
  }

  /** Corre uma acção da equipa: uma de cada vez, e o erro à parte. */
  async function accao(fn: () => Promise<void>) {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupado(true);
    setFalhaAccao(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      // Um 401 só manda para «Entrar» se a sessão acabou (revisão do #174,
      // P1-1).
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaAccao(mostrar);
      // O membro já saiu, ou o convite já foi usado ou cancelado (outro
      // separador): a lista volta a ler-se (revisão do #158, P2-3).
      if (
        e instanceof ErroHub &&
        (e.codigo === "member.not_found" ||
          e.codigo === "invite.used" ||
          e.codigo === "invite.not_found")
      ) {
        await carregar();
      }
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  }

  /** Esquece a escolha da lista de uma linha (P3-2). */
  const esquecerEscolha = (membro: string) => {
    setEscolhidos((antes) =>
      Object.fromEntries(
        Object.entries(antes).filter(([chave]) => chave !== membro),
      ),
    );
  };

  function mudarPapel(m: Membros["membros"][number], papel: Papel) {
    if (comerciante === null || papel === m.papel) return;
    if (
      !window.confirm(
        preencher(t.papelMudarConfirmar, {
          nome: m.nome,
          papel: t[`papel_${papel}`],
        }),
      )
    ) {
      esquecerEscolha(m.membro);
      return;
    }
    void accao(async () => {
      try {
        await comRecente(() => api.mudarPapel(comerciante, m.membro, papel));
        await carregar();
        setAviso({ chave: "papelMudado", valores: { nome: m.nome }, papel });
      } finally {
        esquecerEscolha(m.membro);
      }
    });
  }

  function tirar(m: Membros["membros"][number]) {
    if (
      comerciante === null ||
      !window.confirm(preencher(t.membroTirarConfirmar, { nome: m.nome }))
    ) {
      return;
    }
    void accao(async () => {
      await comRecente(() => api.terminarMembro(comerciante, m.membro));
      await carregar();
      setAviso({ chave: "membroTirado", valores: { nome: m.nome } });
    });
  }

  function sair(m: Membros["membros"][number]) {
    if (comerciante === null || !window.confirm(t.membroSairConfirmar)) return;
    void accao(async () => {
      await comRecente(() => api.terminarMembro(comerciante, m.membro));
      // Já não é desta equipa: volta aos seus comerciantes.
      navegar("/", { substituir: true });
    });
  }

  const souDono = meu?.papel === "dono";
  // O último dono não sai: o ecrã não o oferece e diz porquê (P3-4).
  const ultimoDono =
    souDono &&
    (dados?.membros.filter((m) => m.papel === "dono").length ?? 0) <= 1;

  return (
    <section aria-labelledby="titulo">
      <p>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navegar("/");
          }}
        >
          {t.equipaVoltar}
        </a>
      </p>
      <h1 id="titulo">
        {t.equipaTitulo}
        {meu === undefined ? "" : ` — ${meu.nome}`}
      </h1>
      {!valido ? (
        <CaixaDeErro erro={{ texto: t.erroSemPermissao }} />
      ) : erro !== null && dados === null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : dados === null ? (
        <ACarregar />
      ) : (
        <>
          {erro === null ? null : <CaixaDeErro erro={erro} />}
          {erroAccao === null ? null : <CaixaDeErro erro={erroAccao} />}
          {aviso === null ? null : (
            <div
              className="sucesso"
              role="status"
              tabIndex={-1}
              ref={caixaDoAviso}
            >
              {preencher(t[aviso.chave], {
                ...aviso.valores,
                ...(aviso.papel === undefined
                  ? {}
                  : { papel: t[`papel_${aviso.papel}`] }),
              })}
            </div>
          )}
          <h2>{t.equipaMembros}</h2>
          <p className="secundario">
            {dados.membros.length === 1
              ? t.equipaContagemUm
              : preencher(t.equipaContagem, { n: dados.membros.length })}
          </p>
          <table role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  {t.colunaNome}
                </th>
                <th scope="col" role="columnheader">
                  {t.colunaEmail}
                </th>
                <th scope="col" role="columnheader">
                  {t.colunaPapel}
                </th>
                <th scope="col" role="columnheader">
                  {t.colunaDesde}
                </th>
                <th scope="col" role="columnheader">
                  <span className="so-leitores">{t.colunaAccoes}</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {dados.membros.map((m) => {
                const eu_ = m.pessoa === eu?.pessoa;
                const escolhido = escolhidos[m.membro] ?? m.papel;
                return (
                  <tr role="row" key={m.membro}>
                    <td role="cell" data-rotulo={t.colunaNome}>
                      {m.nome}
                    </td>
                    <td role="cell" data-rotulo={t.colunaEmail}>
                      {m.email}
                    </td>
                    <td role="cell" data-rotulo={t.colunaPapel}>
                      {/* Só o dono muda papéis, e nunca o seu (docs/22 §10). */}
                      {souDono && !eu_ ? (
                        <div className="linha">
                          <label
                            className="so-leitores"
                            htmlFor={`papel-${m.membro}`}
                          >
                            {preencher(t.papelMudarRotulo, { nome: m.nome })}
                          </label>
                          <select
                            id={`papel-${m.membro}`}
                            value={escolhido}
                            disabled={ocupado}
                            onChange={(e) => {
                              const p = e.target.value as Papel;
                              setEscolhidos((antes) => ({
                                ...antes,
                                [m.membro]: p,
                              }));
                            }}
                          >
                            {PAPEIS.map((p) => (
                              <option key={p} value={p}>
                                {t[`papel_${p}`]}
                              </option>
                            ))}
                          </select>
                          {escolhido === m.papel ? null : (
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => {
                                mudarPapel(m, escolhido);
                              }}
                              aria-label={`${t.papelMudar}: ${m.nome}`}
                            >
                              {t.papelMudar}
                            </button>
                          )}
                        </div>
                      ) : (
                        t[`papel_${m.papel}`]
                      )}
                    </td>
                    <td role="cell" data-rotulo={t.colunaDesde}>
                      {data(m.desde)}
                    </td>
                    <td role="cell">
                      {eu_ ? (
                        <>
                          <button
                            type="button"
                            disabled={ocupado || ultimoDono}
                            aria-describedby={
                              ultimoDono ? "ultimo-dono" : undefined
                            }
                            onClick={() => {
                              sair(m);
                            }}
                          >
                            {t.membroSair}
                          </button>
                          {ultimoDono ? (
                            <p className="secundario" id="ultimo-dono">
                              {t.membroUltimoDono}
                            </p>
                          ) : null}
                        </>
                      ) : souDono ? (
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => {
                            tirar(m);
                          }}
                          aria-label={`${t.membroTirar}: ${m.nome}`}
                        >
                          {t.membroTirar}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {dados.convites === null ? null : (
            <>
              <h2>{t.convitesTitulo}</h2>
              {dados.convites.length === 0 ? (
                <p className="secundario">{t.convitesVazio}</p>
              ) : (
                <>
                  <p className="secundario">
                    {dados.convites.length === 1
                      ? t.convitesContagemUm
                      : preencher(t.convitesContagem, {
                          n: dados.convites.length,
                        })}
                  </p>
                  <table role="table">
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col" role="columnheader">
                          {t.colunaEmail}
                        </th>
                        <th scope="col" role="columnheader">
                          {t.colunaPapel}
                        </th>
                        <th scope="col" role="columnheader">
                          {t.colunaExpira}
                        </th>
                        <th scope="col" role="columnheader">
                          <span className="so-leitores">{t.colunaAccoes}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {dados.convites.map((c) => (
                        <tr role="row" key={c.convite}>
                          <td role="cell" data-rotulo={t.colunaEmail}>
                            {c.email}
                          </td>
                          <td role="cell" data-rotulo={t.colunaPapel}>
                            {t[`papel_${c.papel}`]}
                          </td>
                          <td role="cell" data-rotulo={t.colunaExpira}>
                            {data(c.expira_em)}
                          </td>
                          <td role="cell">
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => {
                                cancelar(c.convite, c.email);
                              }}
                              aria-label={`${t.cancelarConvite}: ${c.email}`}
                            >
                              {t.cancelarConvite}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}

          {papeisQuePodeDar(meu?.papel).length === 0 ? null : (
            <Convidar
              comerciante={comerciante}
              papeis={papeisQuePodeDar(meu?.papel)}
              ocupado={ocupado}
              aoConvidar={() => void carregar()}
            />
          )}
        </>
      )}
    </section>
  );
}

function Convidar({
  comerciante,
  papeis,
  ocupado,
  aoConvidar,
}: {
  comerciante: string;
  papeis: readonly Papel[];
  ocupado: boolean;
  aoConvidar: () => void;
}) {
  const { t, lingua, navegar } = useHub();
  const [email, setEmail] = useState("");
  // Por omissão, o primeiro papel que a pessoa pode dar (P2-2).
  const [papel, setPapel] = useState<Papel>(papeis[0] ?? "apoio");
  const [aEspera, setAEspera] = useState(false);
  const [erro, setErro] = useState<MensagemDeErro | null>(null);
  const [ligacao, setLigacao] = useState<string | null>(null);

  async function aoEnviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) {
      setErro({ texto: t.erroEmail });
      return;
    }
    setErro(null);
    setAEspera(true);
    try {
      const r = await comRecente(() =>
        api.convidar(comerciante, email.trim(), papel),
      );
      setLigacao(ligacaoDoConvite(window.location.origin, r.segredo));
      setEmail("");
      aoConvidar();
    } catch (e) {
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setErro(mensagemDeErro(mostrar, t, lingua));
    } finally {
      setAEspera(false);
    }
  }

  return (
    <section className="cartao" aria-labelledby="titulo-convidar">
      <h2 id="titulo-convidar">{t.convidarTitulo}</h2>
      {erro === null ? null : <CaixaDeErro erro={erro} />}
      {ligacao !== null ? (
        <>
          <p>
            <strong>{t.convidarLigacao}</strong>
          </p>
          <div className="aviso" role="note">
            {t.convidarAviso}
          </div>
          <p className="segredo" translate="no" spellCheck={false}>
            {ligacao}
          </p>
          <div className="linha">
            <Copiar texto={ligacao} />
            <button
              type="button"
              onClick={() => {
                setLigacao(null);
              }}
            >
              {t.convidarOutro}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void aoEnviar(e)} noValidate>
          <div className="linha">
            <div className="campo">
              <label htmlFor="email">{t.convidarEmail}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                required
              />
            </div>
            <div className="campo">
              <label htmlFor="papel">{t.convidarPapel}</label>
              <select
                id="papel"
                value={papel}
                onChange={(e) => {
                  setPapel(e.target.value as Papel);
                }}
              >
                {papeis.map((p) => (
                  <option key={p} value={p}>
                    {t[`papel_${p}`]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <button
                type="submit"
                className="principal"
                disabled={aEspera || ocupado}
              >
                {t.convidarBotao}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
