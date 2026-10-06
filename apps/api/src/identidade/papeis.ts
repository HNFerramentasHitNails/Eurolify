import type { Ambito } from "./chaves.js";

// Os papéis de uma pessoa num comerciante e os âmbitos de cada um (docs/21
// §5). A base tem a mesma lista (papel_ambitos, migração 0019) e é ela que
// decide; esta serve às rotas da parte B2 e o teste confere que são iguais.

export const PAPEIS = ["dono", "gestor", "armazem", "apoio"] as const;
export type Papel = (typeof PAPEIS)[number];

export const AMBITOS_DO_PAPEL: Record<Papel, readonly Ambito[]> = {
  dono: [
    "catalog:import",
    "catalog:publish",
    "catalog:read",
    "catalog:write",
    "keys:write",
    "merchant:read",
    "merchant:write",
  ],
  gestor: [
    "catalog:import",
    "catalog:publish",
    "catalog:read",
    "catalog:write",
    "merchant:read",
  ],
  armazem: ["catalog:read"],
  apoio: ["catalog:read", "merchant:read"],
};
