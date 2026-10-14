import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import type { ConfigEnvios } from "../src/envios/adaptador.js";
import { recifrarContas } from "../src/envios/chave.js";
import { receberAviso } from "../src/envios/etiquetas.js";
import {
  criarConta,
  definirCredenciais,
  testarConta,
} from "../src/envios/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import {
  assinarAviso,
  CHAVE_BOA,
  transportadoraFalsa,
} from "./transportadora-falsa.js";

// A troca da chave das credenciais (docs/36 §25; migração 0103): com a
// ENVIOS_CHAVE nova e a antiga em ENVIOS_CHAVE_ANTERIOR, as contas ainda na
// antiga leem-se (credenciais e segredo dos avisos) e a volta passa-as para
// a nova sem mudar o estado; sem a anterior, ficam por ler e contam-se;
// credenciais novas continuam a devolver a conta a rascunho.

const SEGREDO = "segredo-dos-avisos-da-troca";

describe.skipIf(URL_BASE === undefined)("Envios: trocar a chave", () => {
  let base: BaseDeTeste;
  const ctt = transportadoraFalsa();
  const v1 = chavePagamentos(randomBytes(32).toString("base64"), "1");
  const v2 = chavePagamentos(randomBytes(32).toString("base64"), "2");
  const so1: ConfigEnvios = { chave: v1, adaptadores: { ctt: ctt.adaptador } };
  const so2: ConfigEnvios = { chave: v2, adaptadores: { ctt: ctt.adaptador } };
  const troca: ConfigEnvios = { ...so2, chaveAnterior: v1 };

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 180_000);

  afterAll(async () => {
    await base.fechar();
  });

  /** Um comerciante com uma conta pronta, cifrada com `cfg`. */
  async function contaPronta(cfg: ConfigEnvios) {
    const c = await registarComerciante(base.api, {
      nome: "Loja",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const id = await comComerciante(base.api, c, async (trx) => {
      const id = await criarConta(trx, c, {
        transportadora: "ctt",
        nome: "CTT",
        remetente: {
          nome: "Armazém",
          linha1: "Rua 1",
          codigo_postal: "1000-001",
          localidade: "Lisboa",
          pais: "PT",
        },
      });
      await definirCredenciais(
        trx,
        c,
        id,
        { credenciais: { chave: CHAVE_BOA }, segredo_aviso: SEGREDO },
        "pessoa:teste",
        cfg,
      );
      return id;
    });
    await testarConta(base.api, c, id, cfg);
    return { c, id };
  }

  const conta = (c: string, id: string) =>
    comComerciante(base.api, c, (trx) =>
      trx
        .selectFrom("conta_transportadora")
        .select(["estado", "chave_versao", "credenciais_cifra", "testada_em"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow(),
    );

  /** Se o segredo dos avisos da conta abre com `cfg` (o aviso fica válido). */
  async function avisoValido(c: string, id: string, cfg: ConfigEnvios) {
    const corpo = JSON.stringify({ eventos: [] });
    await receberAviso(
      base.api,
      c,
      id,
      { "x-assinatura": assinarAviso(corpo, SEGREDO) },
      corpo,
      cfg,
    );
    const { rows } = await sql<{ valida: boolean }>`
      select assinatura_valida as valida from aviso_transportadora
      where conta_id = ${id}::uuid order by id desc limit 1`.execute(base.dono);
    return rows[0]?.valida;
  }

  /** Corre a volta até não sobrar nenhuma conta na anterior (outros testes). */
  async function recifrarTudo(cfg: ConfigEnvios) {
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = await recifrarContas(base.api, cfg, 1000);
      total += r.recifradas;
      if (r.recifradas === 0) break;
    }
    return total;
  }

  it("durante a troca, a conta na anterior lê-se e a volta passa-a para a nova, pronta", async () => {
    const { c, id } = await contaPronta(so1);
    // Só com a nova não se lê (como até aqui).
    await expect(testarConta(base.api, c, id, so2)).rejects.toMatchObject({
      codigo: "shipping.account_not_ready",
    });
    // Com a anterior ligada, lê-se: credenciais e segredo dos avisos.
    await testarConta(base.api, c, id, troca);
    expect(await avisoValido(c, id, troca)).toBe(true);
    const antes = await conta(c, id);
    expect(antes).toMatchObject({ estado: "pronta", chave_versao: "1" });

    expect(await recifrarTudo(troca)).toBeGreaterThanOrEqual(1);
    const depois = await conta(c, id);
    // A cifra mudou, a versão é a nova, e a conta continua pronta.
    expect(depois.estado).toBe("pronta");
    expect(depois.chave_versao).toBe("2");
    expect(depois.testada_em).toEqual(antes.testada_em);
    expect(
      Buffer.compare(
        depois.credenciais_cifra ?? Buffer.alloc(0),
        antes.credenciais_cifra ?? Buffer.alloc(0),
      ),
    ).not.toBe(0);
    // Já só com a nova (a anterior tirada), tudo se lê.
    await testarConta(base.api, c, id, so2);
    expect(await avisoValido(c, id, so2)).toBe(true);
  });

  it("sem a anterior ligada, as contas na antiga só se contam", async () => {
    const { c, id } = await contaPronta(so1);
    const r = await recifrarContas(base.api, so2, 1000);
    expect(r.recifradas).toBe(0);
    expect(r.faltam).toBeGreaterThanOrEqual(1);
    expect(await conta(c, id)).toMatchObject({ chave_versao: "1" });
    // E o aviso de uma conta que não se lê fica inválido, não rebenta.
    expect(await avisoValido(c, id, so2)).toBe(false);
    await recifrarTudo(troca);
  });

  it("duas voltas ao mesmo tempo passam cada conta uma vez, e fica legível", async () => {
    const { c, id } = await contaPronta(so1);
    const [a, b] = await Promise.all([
      recifrarContas(base.api, troca, 1000),
      recifrarContas(base.api, troca, 1000),
    ]);
    expect(a.falhas + b.falhas).toBe(0);
    expect(await conta(c, id)).toMatchObject({
      estado: "pronta",
      chave_versao: "2",
    });
    await testarConta(base.api, c, id, so2);
  });

  it("credenciais novas na mesma versão continuam a devolver a conta a rascunho", async () => {
    const { c, id } = await contaPronta(so2);
    // Pela base, como faria um caminho que se esquecesse do estado (0103).
    await comComerciante(base.api, c, (trx) =>
      trx
        .updateTable("conta_transportadora")
        .set({ credenciais_cifra: Buffer.from("outra") })
        .where("id", "=", id)
        .execute(),
    );
    expect(await conta(c, id)).toMatchObject({
      estado: "rascunho",
      testada_em: null,
    });
  });

  it("uma cifra que a anterior não abre fica como está e conta como falha", async () => {
    const { c, id } = await contaPronta(so1);
    const estragada = chavePagamentos(randomBytes(32).toString("base64"), "1");
    const r = await recifrarContas(
      base.api,
      { ...so2, chaveAnterior: estragada },
      1000,
    );
    expect(r.falhas).toBeGreaterThanOrEqual(1);
    expect(await conta(c, id)).toMatchObject({
      estado: "pronta",
      chave_versao: "1",
    });
    await recifrarTudo(troca);
  });
});
