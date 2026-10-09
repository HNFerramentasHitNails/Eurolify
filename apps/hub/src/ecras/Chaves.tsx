import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  AMBITOS_SERVIDOR,
  api,
  ErroHub,
  type Ambito,
  type ChaveApi,
  type Eu,
  type Membros,
} from "../api";
import { autorDe, estadoDaChave, fimDoDia, type Autor } from "../chaves";
import { ACarregar, CaixaDeErro, useHub, LigacaoInterna } from "../contexto";
import {
  ErroDoEcra,
  falhaDeAccao,
  mensagemDeErro,
  semSessao,
  type MensagemDeErro,
} from "../erros";
import { comRecente } from "../passkeys";
import { preencher, TAG_LINGUA, type Textos } from "../textos";
import { Copiar } from "./Copiar";
import { entradaDe } from "../modulos";

// As chaves de API de um comerciante (docs/22 §9.3): a lista, criar uma
// chave de servidor (o segredo aparece uma vez) e revogar. Só o dono as gere
// (`keys:write`); a API decide e recusa o resto. As chaves públicas precisam
// de uma loja, e ainda não há forma de as criar: o ecrã não as oferece.

const FORMATO_COMERCIANTE = /^mer_[0-9a-f-]{36}$/;

interface Dados {
  eu: Eu;
  membros: Membros["membros"];
  chaves: ChaveApi[];
}

export const rotuloDoAmbito = (t: Textos, a: Ambito) =>
  t[`ambito_${a.replace(":", "_")}` as keyof Textos];

export function Chaves({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const [dados, setDados] = useState<Dados | null>(null);
  // Os erros guardam-se crus e traduzem-se ao mostrar (revisão do #158, P3-7).
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  const [falhaAccao, setFalhaAccao] = useState<unknown>(null);
  const erroAccao: MensagemDeErro | null =
    falhaAccao === null ? null : mensagemDeErro(falhaAccao, t, lingua);
  const [sucesso, setSucesso] = useState<keyof Textos | null>(null);
  // Uma acção de cada vez: revogar e criar pedem a passkey, que troca o
  // cookie (revisão do #174, P2-3).
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const ultimo = useRef(0);
  // Com um segredo acabado de criar à vista, uma sessão que acabou não tira
  // a pessoa da página antes de o guardar (revisão do #183, P3-4).
  const segredoAVista = useRef(false);
  // As chaves revogadas aqui: um segredo à vista de uma delas sai (P3-10).
  const [revogadas, setRevogadas] = useState<readonly string[]>([]);
  // A mensagem de êxito recebe o foco: o botão de revogar desaparece (P3-6).
  const caixaDeSucesso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sucesso !== null) caixaDeSucesso.current?.focus();
  }, [sucesso]);

  const valido = comerciante !== null && FORMATO_COMERCIANTE.test(comerciante);

  const carregar = useCallback(async (): Promise<boolean> => {
    if (!valido) return false;
    const este = ++ultimo.current;
    try {
      const [eu, membros, chaves] = await Promise.all([
        api.eu(),
        api.membros(comerciante),
        api.chaves(comerciante),
      ]);
      if (este !== ultimo.current) return false;
      setFalha(null);
      setDados({ eu, membros: membros.membros, chaves: chaves.dados });
      return true;
    } catch (e) {
      if (este !== ultimo.current) return false;
      if (semSessao(e) && !segredoAVista.current) {
        navegar("/entrar", { substituir: true });
        return false;
      }
      setFalha(e);
      return false;
    }
  }, [valido, comerciante, navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const correr = useCallback(async (fn: () => Promise<void>) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupado(true);
    try {
      await fn();
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  }, []);

  const falhou = useCallback(
    async (e: unknown) => {
      // Um 401 só manda para «Entrar» se a sessão acabou (revisão do #174,
      // P1-1).
      const mostrar = await falhaDeAccao(e);
      if (mostrar === null) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalhaAccao(mostrar);
    },
    [navegar],
  );

  const data = (iso: string) =>
    new Intl.DateTimeFormat(TAG_LINGUA[lingua], { dateStyle: "medium" }).format(
      new Date(iso),
    );

  function revogar(c: ChaveApi) {
    if (
      comerciante === null ||
      !window.confirm(preencher(t.chaveRevogarConfirmar, { nome: c.nome }))
    ) {
      return;
    }
    setFalhaAccao(null);
    setSucesso(null);
    void correr(async () => {
      try {
        await comRecente(() => api.revogarChave(comerciante, c.id));
        setRevogadas((antes) => [...antes, c.id]);
        if (await carregar()) setSucesso("chaveRevogada");
      } catch (e) {
        await falhou(e);
        // Já revogada ou apagada noutro separador: a lista volta a ler-se.
        if (
          e instanceof ErroHub &&
          (e.codigo === "key.already_revoked" || e.codigo === "key.not_found")
        ) {
          await carregar();
        }
      }
    });
  }

  const meu = dados?.eu.comerciantes.find((c) => c.comerciante === comerciante);
  const agora = new Date();
  const textoDoAutor = (a: Autor) =>
    a.autor === "voce"
      ? t.autorVoce
      : a.autor === "operador"
        ? t.autorOperador
        : a.autor === "membro"
          ? a.nome
          : a.autor === "chave"
            ? a.nome === null
              ? t.autorChaveSemNome
              : preencher(t.autorChave, { nome: a.nome })
            : a.autor === "antigo"
              ? t.autorAntigo
              : t.autorDesconhecido;

  return (
    <section aria-labelledby="titulo">
      <p>
        <LigacaoInterna href={entradaDe(comerciante)}>
          {t.equipaVoltar}
        </LigacaoInterna>
      </p>
      <h1 id="titulo">
        {t.chavesTitulo}
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
          <p>{t.chavesExplicacao}</p>
          {erro === null ? null : (
            <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
          )}
          {erroAccao === null ? null : <CaixaDeErro erro={erroAccao} />}
          {sucesso === null ? null : (
            <div
              className="sucesso"
              role="status"
              tabIndex={-1}
              ref={caixaDeSucesso}
            >
              {t[sucesso]}
            </div>
          )}
          <p className="secundario">
            {dados.chaves.length === 0
              ? t.chavesVazio
              : dados.chaves.length === 1
                ? t.chavesContagemUm
                : preencher(t.chavesContagem, { n: dados.chaves.length })}
          </p>
          {dados.chaves.length === 0 ? null : (
            <table className="tabela-larga">
              <thead>
                <tr>
                  <th scope="col">{t.colunaNome}</th>
                  <th scope="col">{t.colunaTipo}</th>
                  <th scope="col">{t.colunaAmbitos}</th>
                  <th scope="col">{t.colunaPrefixo}</th>
                  <th scope="col">{t.colunaCriadaPor}</th>
                  <th scope="col">{t.colunaExpira}</th>
                  <th scope="col">{t.colunaEstado}</th>
                  <th scope="col">
                    <span className="so-leitores">{t.colunaAccoes}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.chaves.map((c) => {
                  const estado = estadoDaChave(c, agora);
                  return (
                    <tr key={c.id}>
                      <td data-rotulo={t.colunaNome}>{c.nome}</td>
                      <td data-rotulo={t.colunaTipo}>{t[`tipo_${c.tipo}`]}</td>
                      <td data-rotulo={t.colunaAmbitos}>
                        {c.ambitos.map((a) => rotuloDoAmbito(t, a)).join(", ")}
                      </td>
                      <td data-rotulo={t.colunaPrefixo}>
                        <code>{c.prefixo}…</code>
                      </td>
                      <td data-rotulo={t.colunaCriadaPor}>
                        <span>
                          {textoDoAutor(
                            autorDe(
                              c.criada_por,
                              dados.eu.pessoa,
                              dados.membros,
                              dados.chaves,
                            ),
                          )}
                        </span>
                        <br />
                        <span className="secundario">{data(c.criada_em)}</span>
                      </td>
                      <td data-rotulo={t.colunaExpira}>
                        {c.expira_em === null ? t.semPrazo : data(c.expira_em)}
                      </td>
                      <td data-rotulo={t.colunaEstado}>
                        {estado.estado === "activa"
                          ? t.estadoActiva
                          : preencher(
                              estado.estado === "revogada"
                                ? t.estadoRevogada
                                : t.estadoExpirada,
                              { data: data(estado.em) },
                            )}
                      </td>
                      <td>
                        {estado.estado === "activa" ? (
                          <button
                            type="button"
                            onClick={() => {
                              revogar(c);
                            }}
                            disabled={ocupado}
                            aria-label={`${t.chaveRevogar}: ${c.nome}`}
                          >
                            {t.chaveRevogar}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <CriarChave
            comerciante={comerciante}
            ocupado={ocupado}
            correr={correr}
            revogadas={revogadas}
            aoMostrarSegredo={(sim) => {
              segredoAVista.current = sim;
            }}
            aoCriar={async () => {
              setSucesso(null);
              setFalhaAccao(null);
              await carregar();
            }}
          />
        </>
      )}
    </section>
  );
}

function CriarChave({
  comerciante,
  ocupado,
  correr,
  revogadas,
  aoMostrarSegredo,
  aoCriar,
}: {
  comerciante: string;
  ocupado: boolean;
  correr: (fn: () => Promise<void>) => Promise<void>;
  revogadas: readonly string[];
  aoMostrarSegredo: (sim: boolean) => void;
  aoCriar: () => Promise<void>;
}) {
  const { t, lingua, navegar } = useHub();
  const [nome, setNome] = useState("");
  const [ambitos, setAmbitos] = useState<Ambito[]>([]);
  const [expira, setExpira] = useState("");
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);
  // O segredo só vive aqui enquanto se mostra; «Já o guardei» apaga-o, e sai
  // ao deixar a página (docs/22 §9.4).
  const [criada, setCriada] = useState<{
    id: string;
    nome: string;
    segredo: string;
  } | null>(null);
  useEffect(() => {
    aoMostrarSegredo(criada !== null);
  }, [criada, aoMostrarSegredo]);
  // A chave do segredo à vista foi revogada: o segredo já não serve (P3-10).
  useEffect(() => {
    if (criada !== null && revogadas.includes(criada.id)) setCriada(null);
  }, [criada, revogadas]);
  // Que campo tem o erro do ecrã, para lhe apontar (P3-7).
  const [campoInvalido, setCampoInvalido] = useState<
    "nome" | "ambitos" | "expira" | null
  >(null);
  const descrito = (campo: "nome" | "ambitos" | "expira") =>
    campoInvalido === campo
      ? { "aria-invalid": true, "aria-describedby": "erro-chave" }
      : {};
  const aviso = useRef<HTMLDivElement>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const [focar, setFocar] = useState<"aviso" | "nome" | null>(null);
  useEffect(() => {
    if (focar === "aviso") aviso.current?.focus();
    if (focar === "nome") campoNome.current?.focus();
  }, [focar, criada]);
  useEffect(() => {
    const aoSair = () => {
      // Já, antes de o navegador congelar a página (P3-5).
      flushSync(() => {
        setCriada(null);
      });
    };
    window.addEventListener("pagehide", aoSair);
    return () => {
      window.removeEventListener("pagehide", aoSair);
    };
  }, []);

  // O mínimo do calendário: hoje, que vale até ao fim do dia (P3-1).
  const hoje = new Date();
  const minimo = `${String(hoje.getFullYear())}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  function aoEnviar(evento: SyntheticEvent) {
    evento.preventDefault();
    const limpo = nome.trim();
    // Sem data, sem prazo; uma data que não existe ou já passou é recusada.
    const expiraEm = expira === "" ? undefined : (fimDoDia(expira) ?? "");
    const problema: keyof Textos | null =
      limpo.length < 1 || limpo.length > 100
        ? "erroNome"
        : ambitos.length === 0
          ? "erroChaveAmbitos"
          : expiraEm !== undefined &&
              (expiraEm === "" || new Date(expiraEm) <= new Date())
            ? "erroChaveExpira"
            : null;
    if (problema !== null) {
      setFalha(new ErroDoEcra(problema));
      setCampoInvalido(
        problema === "erroNome"
          ? "nome"
          : problema === "erroChaveAmbitos"
            ? "ambitos"
            : "expira",
      );
      return;
    }
    setFalha(null);
    setCampoInvalido(null);
    void correr(async () => {
      try {
        const r = await comRecente(() =>
          api.criarChave(comerciante, {
            nome: limpo,
            ambitos,
            ...(expiraEm === undefined ? {} : { expira_em: expiraEm }),
          }),
        );
        setCriada({ id: r.id, nome: r.nome, segredo: r.segredo });
        setFocar("aviso");
        setNome("");
        setAmbitos([]);
        setExpira("");
        await aoCriar();
      } catch (e) {
        // O erro fica junto do formulário; um 401 só manda para «Entrar» se
        // a sessão acabou (revisão do #174, P1-1).
        const mostrar = await falhaDeAccao(e);
        if (mostrar === null) {
          navegar("/entrar", { substituir: true });
          return;
        }
        // Sem resposta (rede, 5xx), a chave pode ter ficado criada sem
        // ninguém ter o segredo: a lista relê-se e o ecrã di-lo (P2-1).
        if (
          mostrar instanceof ErroHub &&
          (mostrar.estado === 0 || mostrar.estado >= 500)
        ) {
          setFalha(new ErroDoEcra("erroChaveTalvezCriada"));
          await aoCriar();
          return;
        }
        setFalha(mostrar);
      }
    });
  }

  return (
    <section className="cartao" aria-labelledby="titulo-criar-chave">
      <h2 id="titulo-criar-chave">{t.criarChaveTitulo}</h2>
      {criada !== null ? (
        <>
          <p>
            <strong>
              {preencher(t.chaveSegredoTitulo, { nome: criada.nome })}
            </strong>
          </p>
          <div className="aviso" role="note" tabIndex={-1} ref={aviso}>
            {t.chaveSegredoAviso}
          </div>
          <p className="segredo" translate="no" spellCheck={false}>
            {criada.segredo}
          </p>
          <div className="linha">
            <Copiar texto={criada.segredo} />
            <button
              type="button"
              className="principal"
              onClick={() => {
                setCriada(null);
                setFocar("nome");
              }}
            >
              {t.chaveFechar}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t.criarChaveExplicacao}</p>
          {erro === null ? null : <CaixaDeErro erro={erro} id="erro-chave" />}
          <form onSubmit={aoEnviar} noValidate>
            <div className="campo">
              <label htmlFor="nome-chave">{t.chaveNome}</label>
              <input
                id="nome-chave"
                ref={campoNome}
                name="nome-chave"
                autoComplete="off"
                maxLength={100}
                value={nome}
                {...descrito("nome")}
                onChange={(e) => {
                  setNome(e.target.value);
                }}
                required
              />
            </div>
            <fieldset className="campo" {...descrito("ambitos")}>
              <legend>{t.chaveAmbitos}</legend>
              {AMBITOS_SERVIDOR.map((a) => (
                <label key={a} className="opcao">
                  <input
                    type="checkbox"
                    name="ambitos"
                    value={a}
                    checked={ambitos.includes(a)}
                    onChange={(e) => {
                      setAmbitos((antes) =>
                        e.target.checked
                          ? [...antes, a]
                          : antes.filter((x) => x !== a),
                      );
                    }}
                  />{" "}
                  {rotuloDoAmbito(t, a)}
                </label>
              ))}
              {/* O que «Gerir chaves» dá a quem a tiver (revisão do #183, P2-2). */}
              <p className="secundario">{t.ambitoKeysAviso}</p>
            </fieldset>
            <div className="campo">
              <label htmlFor="expira-chave">{t.chaveExpira}</label>
              <input
                id="expira-chave"
                name="expira-chave"
                type="date"
                min={minimo}
                value={expira}
                {...descrito("expira")}
                onChange={(e) => {
                  setExpira(e.target.value);
                }}
              />
            </div>
            <button type="submit" className="principal" disabled={ocupado}>
              {t.chaveCriar}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
