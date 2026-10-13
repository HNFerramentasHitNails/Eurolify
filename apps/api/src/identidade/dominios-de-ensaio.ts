// REDE TEMPORÁRIA (revisão do #165, P2-1; Diogo, 13/10/2026: «A»): enquanto
// o ensaio está no Reino Unido e não recebe dados pessoais (ADR-0018/0019),
// os convites só aceitam endereços que não são de ninguém. FIM: na migração
// para Paris, no máximo a 31/03/2027 (ADR-0019) — então decide-se, com o
// Diogo ou o Bruno, o que a substitui (docs/19 §6.0).

/**
 * Os domínios reservados para testes (RFC 2606 e 6761). É a mesma lista do
 * fluxo «operar» (`.github/workflows/operar.yml`).
 */
export const DOMINIO_DE_TESTE =
  /@([a-z0-9-]+\.)*([a-z0-9-]+\.(test|example|invalid)|example\.(com|net|org))$/;

/**
 * O convite pelo Hub: os domínios de teste e as caixas da própria empresa
 * (`@eurolify.eu`, ex.: `avisos@eurolify.eu`), só o domínio exacto, sem
 * subdomínios. O operador continua só com os de teste.
 */
export function emailAceiteNoConviteDoHub(email: string): boolean {
  const e = email.trim().toLowerCase();
  // Primeiro a forma: um «@» só e sem espaços, para que «a@gmail.com@x.test»
  // não passe pelo domínio de teste do fim (revisão do #417, P2-1).
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) return false;
  return DOMINIO_DE_TESTE.test(e) || /@eurolify\.eu$/.test(e);
}
