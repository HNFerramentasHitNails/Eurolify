import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AMBITOS_DA_LOJA,
  CAMINHOS_FORA,
  repartir,
  type Contrato,
} from "../scripts/filtro.mjs";

// O SDK contra o contrato (docs/39 §3): o contrato é a cópia que um teste da
// API confere com o que a API publica; os tipos gerados vêm dele. Se um dos
// três divergir, falha aqui ou lá.

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), "utf8");
const contrato = JSON.parse(ler("../contrato/openapi.json")) as Contrato;
const { loja, administracao, fora } = repartir(contrato);

const METODOS = ["get", "put", "post", "delete", "patch"];
const operacoes = (c: Contrato) =>
  Object.entries(c.paths).flatMap(([caminho, item]) =>
    Object.keys(item)
      .filter((m) => METODOS.includes(m))
      .map((m) => `${m} ${caminho}`),
  );

describe("o que entra no SDK", () => {
  it("cada operação do contrato está num só sítio: Loja, Administração ou fora", () => {
    const todas = operacoes(contrato).sort();
    const repartidas = [
      ...operacoes(loja),
      ...operacoes(administracao),
      ...fora.map((f) => `${f.metodo} ${f.caminho}`),
    ].sort();
    expect(repartidas).toEqual(todas);
    expect(new Set(repartidas).size).toBe(repartidas.length);
  });

  it("a Loja só leva rotas públicas ou da chave pública", () => {
    for (const item of Object.values(loja.paths)) {
      for (const op of Object.values(item)) {
        expect(AMBITOS_DA_LOJA).toContain(op["x-ambito"]);
      }
    }
    expect(Object.keys(loja.paths).length).toBeGreaterThan(0);
  });

  it("a Administração não leva rotas do Hub, da Loja nem sem âmbito", () => {
    for (const item of Object.values(administracao.paths)) {
      for (const op of Object.values(item)) {
        expect(typeof op["x-ambito"]).toBe("string");
        expect(AMBITOS_DA_LOJA).not.toContain(op["x-ambito"]);
        expect(String(op["x-ambito"])).not.toMatch(/^sessao/);
      }
    }
  });

  it("nenhum aviso de prestador nem rota do Hub chega ao SDK", () => {
    const entradas = [...operacoes(loja), ...operacoes(administracao)];
    expect(entradas.filter((e) => /\/webhooks\/|\/hub\//.test(e))).toEqual([]);
  });

  it("cada exclusão por caminho ainda existe no contrato (a lista não apodrece)", () => {
    for (const regra of CAMINHOS_FORA) {
      expect(
        Object.keys(contrato.paths).some((c) => regra.test(c)),
        String(regra),
      ).toBe(true);
    }
  });

  it("as rotas de ficheiros ficam de fora com a razão dita", () => {
    const pdf = fora.find((f) => f.caminho === "/invoices/{id}/pdf");
    expect(pdf?.razao).toMatch(/não é JSON/);
  });
});

describe("os tipos gerados acompanham o contrato", () => {
  const caminhosGerados = (nome: string) =>
    [...ler(`../src/gerado/${nome}.ts`).matchAll(/^ {4}"(\/[^"]*)": \{$/gm)]
      .map((m) => m[1])
      .sort();

  it("Loja: os caminhos gerados são os do contrato filtrado", () => {
    expect(caminhosGerados("loja")).toEqual(Object.keys(loja.paths).sort());
  });

  it("Administração: os caminhos gerados são os do contrato filtrado", () => {
    expect(caminhosGerados("administracao")).toEqual(
      Object.keys(administracao.paths).sort(),
    );
  });
});
