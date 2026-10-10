import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { erroBase, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { sessaoDo } from "./autenticacao.js";
import type { Ambito } from "./chaves.js";
import {
  criarChavePelaSessao,
  listarChaves,
  revogarChavePelaSessao,
} from "./repositorio.js";
import {
  Chave,
  ParametroChave,
  paraResposta,
  PedidoCriarChave,
  RespostaChaveCriada,
  RespostaChaves,
} from "./rotas.js";
import { SemCorpo } from "./hub.js";
import { erroConta } from "./sessoes.js";

// Rotas do Hub da parte B3c (docs/21 §4.3 e §12; migração 0025): as chaves
// de API do comerciante pelo Hub, com a sessão de uma pessoa cujo papel tem
// `keys:write` (hoje, o dono) e autenticação recente para criar e revogar
// (BA, P-T8). Os corpos e as respostas são os de /keys (docs/19 §6.1). Ao
// criar e revogar, a base confere tudo outra vez (o papel, a autenticação
// recente, as regras); a lista confere o papel aqui, com a sessão resolvida
// pela base, e chama `chave_listar()` — o mesmo nível de confiança do
// GET /keys (revisão do #149, P3-3).

export function rotasDasChavesDoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/hub/keys",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As chaves do comerciante, sem o segredo nem o resumo (só quem tem keys:write: o dono).",
        response: { 200: RespostaChaves, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      if (!sessao.ambitos.includes("keys:write")) {
        throw erroConta("member.role_escalation", "o papel não gere chaves");
      }
      const lista = await listarChaves(base, sessao.comercianteId ?? "");
      return { dados: lista.map(paraResposta) };
    },
  );

  rotas.post(
    "/hub/keys",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Cria uma chave pelo Hub (só o dono, com autenticação recente). O segredo só aparece nesta resposta. A chave fica em nome da pessoa e é revogada se ela sair da equipa.",
        body: PedidoCriarChave,
        response: { 201: RespostaChaveCriada, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      const corpo = pedido.body;
      const publica = corpo.tipo === "publica";
      if (publica && corpo.ambitos !== undefined) {
        throw erroBase(
          "request.invalid",
          "a chave pública não leva âmbitos: tem `storefront`",
        );
      }
      if (!publica && corpo.ambitos === undefined) {
        throw erroBase(
          "request.invalid",
          "a chave de servidor precisa de `ambitos`",
        );
      }
      if (publica !== (corpo.loja !== undefined)) {
        throw erroBase(
          "request.invalid",
          "`loja` é obrigatória na chave pública e proibida na de servidor",
        );
      }
      if (publica && corpo.agente_ia === true) {
        throw erroBase(
          "request.invalid",
          "só uma chave de servidor pode ser de um agente de IA",
        );
      }
      const expiraEm =
        corpo.expira_em === undefined ? null : new Date(corpo.expira_em);
      if (expiraEm !== null && Number.isNaN(expiraEm.getTime())) {
        throw erroBase("request.invalid", "`expira_em` não é uma data válida");
      }
      const ambitos: Ambito[] = publica
        ? ["storefront"]
        : (corpo.ambitos ?? []);
      const { chave, segredo } = await comComerciante(
        base,
        sessao.comercianteId ?? "",
        (trx) =>
          criarChavePelaSessao(trx, sessao.segredo, {
            tipo: corpo.tipo,
            lojaId: corpo.loja?.slice("sto_".length) ?? null,
            nome: corpo.nome,
            ambitos,
            expiraEm,
            agenteIa: corpo.agente_ia === true,
          }),
      );
      void resposta.header("cache-control", "no-store").code(201);
      return { ...paraResposta(chave), segredo };
    },
  );

  rotas.post(
    "/hub/keys/:id/revoke",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Revoga uma chave do comerciante pelo Hub (só o dono, com autenticação recente), de imediato e sem volta.",
        params: ParametroChave,
        body: SemCorpo,
        response: { 200: Chave, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const sessao = sessaoDo(pedido);
      const id = pedido.params.id.slice("key_".length);
      const revogada = await comComerciante(
        base,
        sessao.comercianteId ?? "",
        (trx) => revogarChavePelaSessao(trx, sessao.segredo, id),
      );
      return paraResposta(revogada);
    },
  );
}
