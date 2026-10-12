import { agendarConclusoes } from "./stock/repositorio.js";
import { comRasto } from "./base/rasto.js";
import type { ConfigPagamentos } from "./pagamentos/adaptador.js";
import type { ConfigEnvios } from "./envios/adaptador.js";
import { agendarTrabalhoEnvios } from "./envios/etiquetas.js";
import { chavePagamentos } from "./pagamentos/cifra.js";
import { adaptadorEuPago } from "./pagamentos/eupago.js";
import { agendarTarefasPagamentos } from "./pagamentos/repositorio.js";
import { agendarAvisosDePrazo } from "./posvenda/prazo.js";
import { agendarConfirmacoes } from "./posvenda/prestador.js";
import { agendarAvisosDeTarefas } from "./tarefas/avisos.js";
import { agendarNotificacoes } from "./notificacoes/repositorio.js";
import { configSmtp, correioSmtp } from "./notificacoes/correio.js";
import type { ConfigFaturacao } from "./faturacao/adaptador.js";
import { AdaptadorMoloni } from "./faturacao/moloni.js";
import {
  agendarDocumentos,
  agendarRenovacoes,
} from "./faturacao/repositorio.js";
import { randomUUID } from "node:crypto";
import { criarApp } from "./app.js";
import { abrirBase } from "./base/ligacao.js";
import { ArmazenamentoEmDisco } from "./catalogo/armazenamento.js";
import { agendarLimpezaDosFicheiros } from "./catalogo/limpeza-ficheiros.js";
import { consultaVies } from "./clientes/vies.js";
import { agendarFilaVies } from "./clientes/vies-fila.js";
import { agendarApagamentosPendentes } from "./clientes/titular-fila.js";
import { proxyConfiavel } from "./base/limite.js";
import { serializadores } from "./base/registo.js";
import { chaveTotp } from "./identidade/palavra-passe.js";
import { configHub } from "./identidade/sessoes.js";

// Por omissão só ouve dentro da máquina (ADR-0027). Dentro do contentor o
// fluxo de publicação passa ANFITRIAO=0.0.0.0 e a porta só se liga a
// 127.0.0.1 do lado da VPS.
const anfitriao = process.env["ANFITRIAO"] ?? "127.0.0.1";
const porta = Number(process.env["PORTA"] ?? "8080");
// A ligação do eurolify_api (docs/15 §5). Sem ela, a API arranca só com as
// rotas públicas (/health, /paises, /openapi.json): é o caso da VPS enquanto
// o api.env estiver vazio (docs/19 §6).
const urlBase = process.env["BASE_DADOS_URL"];
const base =
  urlBase === undefined || urlBase === "" ? undefined : abrirBase(urlBase);

// A origem do Hub (docs/21 §3 e §11). Sem ela, as rotas do Hub não existem.
const origemHub = process.env["HUB_ORIGEM"]?.trim();
// A chave dos segredos TOTP (docs/21 §8): sem ela, não há palavra-passe.
const chaveTotpBase64 = process.env["TOTP_CHAVE"]?.trim();
const hub =
  origemHub === undefined || origemHub === ""
    ? undefined
    : {
        ...configHub(origemHub),
        ...(chaveTotpBase64 === undefined || chaveTotpBase64 === ""
          ? {}
          : {
              chaveTotp: chaveTotp(
                chaveTotpBase64,
                process.env["TOTP_CHAVE_VERSAO"]?.trim() || "1",
              ),
            }),
      };

// Na VPS a API corre num contentor: o que ela vê é o gateway da rede do
// Docker, não o cliente. Com o Hub ligado e sem PROXY_CONFIAVEL, todos os
// clientes contavam no mesmo IP — não arranca (revisão do #154, P1-1).
const textoProxy = process.env["PROXY_CONFIAVEL"]?.trim() ?? "";
if (hub !== undefined && textoProxy === "") {
  throw new Error(
    "PROXY_CONFIAVEL: com HUB_ORIGEM, diga o endereço do proxy visto pela API (na VPS, o gateway da rede Docker), ou «nenhum» se a API recebe os clientes directamente (docs/21 §14)",
  );
}
const trustProxy = proxyConfiavel(textoProxy);

// A pasta das imagens (docs/06, CQ). Sem ela, as rotas da media não existem.
const pastaMedia = process.env["MEDIA_PASTA"]?.trim();
const armazenamento =
  pastaMedia === undefined || pastaMedia === ""
    ? undefined
    : new ArmazenamentoEmDisco(pastaMedia);

// O VIES (docs/23 §13): desligado por omissão (revisão do #244, P2-5: a
// saída da VPS para a Comissão mede-se no ensaio antes de ligar). Liga-se com
// VIES_URL, o endereço da API REST do VIES
// (https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number).
const textoVies = process.env["VIES_URL"]?.trim();
const vies =
  textoVies === undefined || textoVies === ""
    ? undefined
    : consultaVies(textoVies);

// Os pagamentos (docs/26 Q3): a chave que cifra as credenciais das contas.
// Sem ela, pagar e ligar contas dá 503. A EuPago só em modo teste (0042).
const textoChavePagamentos = process.env["PAGAMENTOS_CHAVE"]?.trim();
const pagamentos: ConfigPagamentos = {
  adaptadores: { eupago: adaptadorEuPago() },
  ...(textoChavePagamentos === undefined || textoChavePagamentos === ""
    ? {}
    : {
        chave: chavePagamentos(
          textoChavePagamentos,
          process.env["PAGAMENTOS_CHAVE_VERSAO"]?.trim() || "1",
        ),
      }),
};

// Os documentos fiscais (docs/29): o adaptador de ensaio só existe nos
// testes; o Moloni liga-se com a conta de Developer do Eurolify
// (MOLONI_CLIENT_ID e MOLONI_CLIENT_SECRET; §13.6, M1), e só nas empresas
// de teste da lista MOLONI_EMPRESAS_TESTE (M8). A chave cifra as
// credenciais e os tokens das ligações (FATURACAO_CHAVE), como a dos
// pagamentos.
const textoChaveFaturacao = process.env["FATURACAO_CHAVE"]?.trim();
const moloniId = process.env["MOLONI_CLIENT_ID"]?.trim();
const moloniSegredo = process.env["MOLONI_CLIENT_SECRET"]?.trim();
// As empresas de teste do Moloni onde se pode emitir (M8; revisão do #384,
// P1-2): sem esta lista, o Moloni não liga.
const moloniEmpresas = (process.env["MOLONI_EMPRESAS_TESTE"] ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter((x) => /^\d{1,12}$/.test(x));
const faturacao: ConfigFaturacao = {
  adaptadores:
    moloniId && moloniSegredo && moloniEmpresas.length > 0
      ? {
          moloni: new AdaptadorMoloni({
            clientId: moloniId,
            clientSecret: moloniSegredo,
            empresasPermitidas: moloniEmpresas,
          }),
        }
      : {},
  ...(textoChaveFaturacao === undefined || textoChaveFaturacao === ""
    ? {}
    : {
        chave: chavePagamentos(
          textoChaveFaturacao,
          process.env["FATURACAO_CHAVE_VERSAO"]?.trim() || "1",
        ),
      }),
};

// Os envios (docs/36 §3.1): a chave que cifra as credenciais das contas de
// transportadora (ENVIOS_CHAVE), como a dos pagamentos. Na parte A não há
// adaptador de nenhuma transportadora: as contas criam-se mas não passam a
// chamada de teste (`shipping.carrier_unavailable`) até ao dos CTT (parte B).
const textoChaveEnvios = process.env["ENVIOS_CHAVE"]?.trim();
const envios: ConfigEnvios = {
  adaptadores: {},
  ...(textoChaveEnvios === undefined || textoChaveEnvios === ""
    ? {}
    : {
        chave: chavePagamentos(
          textoChaveEnvios,
          process.env["ENVIOS_CHAVE_VERSAO"]?.trim() || "1",
        ),
      }),
};

const app = criarApp(
  {
    // Um identificador por pedido que não recomeça a cada arranque: é o
    // `instance` dos erros (revisão do #106, P3-2).
    genReqId: () => randomUUID(),
    logger: { serializers: serializadores },
    // Atrás de um proxy, o IP de quem pede vem no X-Forwarded-For, e só se
    // aceita do endereço exacto do proxy, que o reescreve (docs/21 §12 e
    // §14). Sem PROXY_CONFIAVEL, conta o IP da ligação.
    trustProxy,
  },
  undefined,
  base,
  hub,
  armazenamento,
  vies,
  undefined,
  pagamentos,
  faturacao,
  envios,
);

// As tarefas agendadas correm com o canal «sistema» no rasto de auditoria
// (docs/28 §3.1): os temporizadores guardam o contexto de quem os criou.

// Os ficheiros de imagem sem uso há mais de 7 dias saem uma vez por dia
// (docs/14 §3.5; issue #179). Só com a base e a pasta das imagens.
const pararLimpeza =
  base !== undefined && armazenamento !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:limpeza_ficheiros" }, () =>
        agendarLimpezaDosFicheiros(base, armazenamento, app.log),
      )
    : () => undefined;

// A fila do VIES, de minuto a minuto (docs/23 §13.4).
const pararVies =
  base !== undefined && vies !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:fila_vies" }, () =>
        agendarFilaVies(base, vies, app.log),
      )
    : () => undefined;

// As tarefas dos pagamentos (docs/26 §5, passo 7, e Q6), de minuto a minuto:
// os pendentes que passaram do prazo e as encomendas por pagar há 24 h.
const pararPagamentos =
  base !== undefined && pagamentos.chave !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:pagamentos" }, () =>
        agendarTarefasPagamentos(base, pagamentos, app.log),
      )
    : () => undefined;

// Os reembolsos pedidos ao prestador, de minuto a minuto (docs/30 §13, P6):
// os aceites consultam-se até ele dizer «reembolsado».
const pararReembolsos =
  base !== undefined && pagamentos.chave !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:reembolsos" }, () =>
        agendarConfirmacoes(base, pagamentos, app.log),
      )
    : () => undefined;

// Os pedidos de documento, de minuto a minuto (docs/29, R11).
const pararDocumentos =
  base !== undefined && faturacao.chave !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:documentos" }, () =>
        agendarDocumentos(base, faturacao, app.log),
      )
    : () => undefined;

// Os tokens das ligações que os renovam (o Moloni), de seis em seis horas
// (docs/29 §13.4).
const pararRenovacoes =
  base !== undefined &&
  faturacao.chave !== undefined &&
  faturacao.adaptadores.moloni
    ? comRasto({ canal: "sistema", pedido: "tarefa:renovacoes" }, () =>
        agendarRenovacoes(base, faturacao, app.log),
      )
    : () => undefined;

// O aviso do prazo do reembolso, de hora a hora (docs/30 §14, R10).
const pararPrazos =
  base !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:prazos" }, () =>
        agendarAvisosDePrazo(base, app.log),
      )
    : () => undefined;

// O aviso dos casos vencidos nas filas que pedem uma pessoa, de hora a hora
// (docs/33 R6).
const pararTarefas =
  base !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:tarefas" }, () =>
        agendarAvisosDeTarefas(base, app.log),
      )
    : () => undefined;

// Os e-mails da fila das notificações, de minuto a minuto (docs/34; DX).
// Sem as cinco variáveis SMTP_*, nada sai e as notificações esperam (N8),
// mas a limpeza dos 90 dias corre na mesma. Uma configuração a meio não
// derruba a API: diz que variáveis faltam (revisão do #373, P2-5).
const smtp = configSmtp(process.env);
if (smtp.problema !== undefined) {
  app.log.error(
    { problema: smtp.problema },
    "notificações: configuração SMTP_* incompleta; nenhum e-mail sai (docs/34 §5)",
  );
} else if (smtp.config === undefined && base !== undefined) {
  app.log.info(
    "notificações: sem SMTP_* configurado; os e-mails ficam à espera (docs/34 §5)",
  );
}
const pararNotificacoes =
  base !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:notificacoes" }, () =>
        agendarNotificacoes(
          base,
          smtp.config === undefined ? undefined : correioSmtp(smtp.config),
          app.log,
        ),
      )
    : () => undefined;

// As encomendas entregues há 14 dias passam a concluídas (docs/27 Q6).
const pararConclusoes =
  base !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:conclusoes" }, () =>
        agendarConclusoes(base, app.log),
      )
    : () => undefined;

// As encomendas de um pedido de apagamento que estavam em curso limpam-se
// quando acabarem, de hora a hora (docs/23 §15.3).
const pararApagamentos =
  base !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:titular" }, () =>
        agendarApagamentosPendentes(base, app.log),
      )
    : () => undefined;

// Os envios (docs/36 §4): o seguimento das etiquetas, as incertas e os
// ficheiros a apagar, de 5 em 5 minutos. Só com a chave das credenciais.
const pararEnvios =
  base !== undefined && envios.chave !== undefined
    ? comRasto({ canal: "sistema", pedido: "tarefa:envios" }, () =>
        agendarTrabalhoEnvios(base, envios, app.log),
      )
    : () => undefined;

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.once(sinal, () => {
    pararEnvios();
    pararApagamentos();
    pararConclusoes();
    pararDocumentos();
    pararRenovacoes();
    pararLimpeza();
    pararVies();
    pararPagamentos();
    pararReembolsos();
    pararPrazos();
    pararTarefas();
    pararNotificacoes();
    app.log.info({ sinal }, "a fechar");
    app
      .close()
      .then(() => base?.destroy())
      .then(
        () => process.exit(0),
        (erro: unknown) => {
          app.log.error({ erro }, "erro ao fechar");
          process.exit(1);
        },
      );
  });
}

await app.listen({ host: anfitriao, port: porta });
