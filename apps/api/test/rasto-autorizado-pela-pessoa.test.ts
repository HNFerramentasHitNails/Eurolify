import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { AutenticadorDeTeste } from "./autenticador-de-teste.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste, NO_HUB } from "./hub-de-teste.js";

// Quem autorizou, quando a pessoa age ela própria numa rota pública
// (migração 0064; issue #322; Diogo, 11/10/2026: «confirmo»): a conta nova
// pelo convite e a recuperação ficam autorizadas pela própria pessoa, que
// provou quem é no pedido. Antes ficavam vazias — «sem autorização de uma
// pessoa». Contra o PostgreSQL 18.

describe.skipIf(URL_BASE === undefined)(
  "autorizado pela própria pessoa (0064)",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a: string;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base);
      a = await registarComerciante(base.api, {
        nome: "Loja Autoriza",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
    }, 60_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    /** Os eventos da conta da pessoa, com o rasto. */
    const eventos = async (pessoa: string) =>
      (
        await sql<{
          acto: string;
          canal: string | null;
          autorizado_por: string | null;
        }>`select acto, canal, autorizado_por from evento_conta
          where pessoa_id = ${pessoa}::uuid order by quando, id`.execute(
          base.dono,
        )
      ).rows;

    it("a conta nova pelo convite fica autorizada pela própria pessoa", async () => {
      const p = await h.pessoaCom(a, "apoio", "Ana Convite");
      const linhas = await eventos(p.pessoa);
      const criada = linhas.filter((l) =>
        ["conta_criada", "convite_aceite"].includes(l.acto),
      );
      expect(criada.map((l) => l.acto).sort()).toEqual([
        "conta_criada",
        "convite_aceite",
      ]);
      for (const l of criada) {
        expect(l).toMatchObject({
          canal: "hub",
          autorizado_por: `pessoa:per_${p.pessoa}`,
        });
      }
    });

    it("a recuperação fica autorizada pela própria pessoa", async () => {
      const p = await h.pessoaCom(a, "apoio", "Rui Recupera");
      const opcoes = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: p.codigos[0] },
      });
      expect(opcoes.statusCode, opcoes.body).toBe(200);
      const fim = await h.pedir("POST", "/hub/recovery", {
        corpo: {
          email: p.email,
          codigo: p.codigos[0],
          credencial: new AutenticadorDeTeste().registar(
            opcoes.json<{ challenge: string }>().challenge,
            NO_HUB,
          ),
        },
      });
      expect(fim.statusCode, fim.body).toBe(201);
      const recuperou = (await eventos(p.pessoa)).filter(
        (l) => l.acto === "recuperou",
      );
      expect(recuperou).toEqual([
        {
          acto: "recuperou",
          canal: "hub",
          autorizado_por: `pessoa:per_${p.pessoa}`,
        },
      ]);
    });

    it("não troca quem já autorizou, nem põe ninguém sem pessoa", async () => {
      const outra = "11111111-1111-1111-1111-111111111111";
      const r = await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.autorizado_por',
          ${`pessoa:per_${outra}`}, true)`.execute(trx);
        await sql`select rasto_autorizado_pela_propria(
          '22222222-2222-2222-2222-222222222222'::uuid)`.execute(trx);
        return (
          await sql<{
            v: string;
          }>`select current_setting('eurolify.autorizado_por') as v`.execute(
            trx,
          )
        ).rows[0]?.v;
      });
      expect(r).toBe(`pessoa:per_${outra}`);
      await expect(
        sql`select rasto_autorizado_pela_propria(null)`.execute(base.dono),
      ).rejects.toThrow(/falta a pessoa/);
    });

    it("a API não pode chamar a função (só as funções da base)", async () => {
      await expect(
        sql`select rasto_autorizado_pela_propria(
          '22222222-2222-2222-2222-222222222222'::uuid)`.execute(base.api),
      ).rejects.toThrow(/permission denied/);
    });
  },
);
