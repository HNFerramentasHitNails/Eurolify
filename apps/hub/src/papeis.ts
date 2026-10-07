import { PAPEIS, type Papel } from "./api";

// Os papéis que cada um pode dar num convite (docs/21 §5: o dono dá
// qualquer um; o gestor só armazém e apoio). A regra vive na base
// (`papel_pode_convidar`) e é ela que decide; esta cópia só serve para o
// ecrã não oferecer o que a API recusa (revisão do #158, P2-2). Por fazer:
// a API devolver a lista, para não haver cópia (eurolify-design, regra 8).
export function papeisQuePodeDar(papel: Papel | undefined): readonly Papel[] {
  if (papel === "dono") return PAPEIS;
  if (papel === "gestor") return ["armazem", "apoio"];
  return [];
}
