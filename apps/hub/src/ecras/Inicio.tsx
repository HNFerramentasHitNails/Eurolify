import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, type Eu } from "../api";
import { ACarregar, CaixaDeErro, LigacaoInterna, useHub } from "../contexto";
import { mensagemDeErro, semSessao, type MensagemDeErro } from "../erros";
import { IconeModulo } from "../icones";
import {
  destinoDe,
  entradaDe,
  escolherComerciante,
  filtrarModulos,
  modulosDe,
  type Comerciante,
} from "../modulos";
import { preencher } from "../textos";

// A entrada do Hub por módulos (docs/hub-modular-glassmorphism.md, «Primeira
// implementação»; antes, só a lista dos comerciantes, docs/22 §3). O
// `/hub/me` lê-se uma vez: mudar de comerciante não faz outro pedido, por
// isso não há resposta atrasada de um comerciante a preencher outro.

export function Inicio({ comerciante }: { comerciante: string | null }) {
  const { t, lingua, navegar } = useHub();
  const [eu, setEu] = useState<Eu | null>(null);
  // O erro guarda-se cru e traduz-se ao mostrar: mudar a língua não volta a
  // pedir nada (revisão do #158, P3-7).
  const [falha, setFalha] = useState<unknown>(null);
  const erro: MensagemDeErro | null =
    falha === null ? null : mensagemDeErro(falha, t, lingua);

  const carregar = useCallback(async () => {
    setFalha(null);
    try {
      setEu(await api.eu());
    } catch (e) {
      if (semSessao(e)) {
        navegar("/entrar", { substituir: true });
        return;
      }
      setFalha(e);
    }
  }, [navegar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const escolha =
    eu === null ? null : escolherComerciante(eu.comerciantes, comerciante);

  return (
    <section aria-labelledby="titulo" className="entrada">
      <h1 id="titulo">{t.inicioTitulo}</h1>
      {erro !== null ? (
        <CaixaDeErro erro={erro} aoTentar={() => void carregar()} />
      ) : eu === null || escolha === null ? (
        <ACarregar />
      ) : (
        <>
          <p className="secundario">
            {t.inicioEntrouComo} {eu.nome} ({eu.email})
          </p>
          {escolha.tipo === "vazio" ? (
            <p>{t.inicioVazio}</p>
          ) : escolha.tipo === "escolher" ? (
            <EscolherComerciante
              comerciantes={eu.comerciantes}
              desconhecido={escolha.desconhecido}
            />
          ) : (
            <Lancador
              // Outro comerciante, outra pesquisa: nada do anterior fica.
              key={escolha.comerciante.comerciante}
              comerciante={escolha.comerciante}
              variosComerciantes={eu.comerciantes.length > 1}
            />
          )}
        </>
      )}
    </section>
  );
}

function EscolherComerciante({
  comerciantes,
  desconhecido,
}: {
  comerciantes: readonly Comerciante[];
  desconhecido: boolean;
}) {
  const { t } = useHub();
  return (
    <>
      <h2>{t.inicioEscolher}</h2>
      {desconhecido ? (
        <p className="aviso" role="status">
          {t.inicioComercianteDesconhecido}
        </p>
      ) : (
        <p className="secundario">{t.inicioEscolherExplicacao}</p>
      )}
      <ul className="lista-simples escolha-comerciante">
        {comerciantes.map((c) => (
          <li key={c.comerciante}>
            <LigacaoInterna href={entradaDe(c.comerciante)}>
              <strong>{c.nome}</strong>{" "}
              <span className="secundario">{t[`papel_${c.papel}`]}</span>
            </LigacaoInterna>
          </li>
        ))}
      </ul>
    </>
  );
}

function Lancador({
  comerciante,
  variosComerciantes,
}: {
  comerciante: Comerciante;
  variosComerciantes: boolean;
}) {
  const { t, opaco, mudarOpaco } = useHub();
  const [consulta, setConsulta] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  const idCampo = useId();
  const idTituloModulos = useId();

  const disponiveis = modulosDe(comerciante);
  const visiveis = filtrarModulos(disponiveis, consulta, t);
  const pesquisando = consulta.trim() !== "";

  return (
    <>
      <div className="contexto-comerciante">
        <p>
          <span className="secundario">{t.inicioComerciante}</span>{" "}
          <strong>{comerciante.nome}</strong>{" "}
          <span className="secundario">{t[`papel_${comerciante.papel}`]}</span>
        </p>
        {variosComerciantes ? (
          <LigacaoInterna href="/" className="ligacao-alvo">
            {t.inicioMudarComerciante}
          </LigacaoInterna>
        ) : null}
      </div>

      {disponiveis.length === 0 ? (
        <p>{t.modulosNenhum}</p>
      ) : (
        <>
          <div className="pesquisa-modulos" role="search">
            <label htmlFor={idCampo}>{t.modulosPesquisar}</label>
            <div className="pesquisa-linha">
              <input
                ref={campo}
                id={idCampo}
                type="search"
                className="vidro"
                value={consulta}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setConsulta(e.target.value);
                }}
              />
              {pesquisando ? (
                <button
                  type="button"
                  onClick={() => {
                    setConsulta("");
                    campo.current?.focus();
                  }}
                >
                  {t.modulosLimpar}
                </button>
              ) : null}
            </div>
            {/* Só se anuncia com uma pesquisa escrita; a região existe
                sempre, para os leitores de ecrã a ouvirem mudar. */}
            <p className="secundario contagem-modulos" role="status">
              {!pesquisando
                ? ""
                : visiveis.length === 1
                  ? t.modulosContagemUm
                  : preencher(t.modulosContagem, { n: visiveis.length })}
            </p>
          </div>

          <nav className="modulos" aria-labelledby={idTituloModulos}>
            <h2 id={idTituloModulos}>{t.modulosTitulo}</h2>
            {visiveis.length === 0 ? (
              <p>
                {preencher(t.modulosSemResultados, {
                  consulta: consulta.trim(),
                })}
              </p>
            ) : (
              <ul className="grelha-modulos">
                {visiveis.map((m) => (
                  <li key={m.id}>
                    <LigacaoInterna
                      href={destinoDe(m, comerciante.comerciante)}
                      className="atalho-modulo"
                    >
                      <span className="superficie-icone vidro">
                        <IconeModulo id={m.id} />
                      </span>
                      <span className="rotulo-modulo">
                        {t[`modulo_${m.id}`]}
                      </span>
                    </LigacaoInterna>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <p className="opcoes-entrada">
            <button
              type="button"
              aria-pressed={opaco}
              onClick={() => {
                mudarOpaco(!opaco);
              }}
            >
              {t.modulosOpacos}
            </button>
          </p>
        </>
      )}
    </>
  );
}
