import { describe, expect, it } from "vitest";
import { papeisQuePodeDar } from "../src/papeis";

// Os papéis que cada um pode dar num convite (docs/21 §5; revisão do #158,
// P2-2). A regra é da base; esta cópia só evita oferecer o que ela recusa.

describe("os papéis que cada um pode dar", () => {
  it("o dono dá os quatro; o gestor só armazém e apoio; os outros nenhum", () => {
    expect(papeisQuePodeDar("dono")).toEqual([
      "dono",
      "gestor",
      "armazem",
      "apoio",
    ]);
    expect(papeisQuePodeDar("gestor")).toEqual(["armazem", "apoio"]);
    expect(papeisQuePodeDar("armazem")).toEqual([]);
    expect(papeisQuePodeDar("apoio")).toEqual([]);
    expect(papeisQuePodeDar(undefined)).toEqual([]);
  });
});
