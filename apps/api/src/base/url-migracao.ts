// Que base o migrador usa (revisão do #43, P1-4). Só a AUSÊNCIA da variável
// é tolerada, e só até à data de fim: é uma rede temporária para a VPS, cujo
// /etc/eurolify/migrar.env (só do migrador; a API não o recebe) ainda está
// vazio (preparar.sh, passo 10). Acaba quando o pedido ao script da VPS puser
// lá a ligação do migrador — ou a 31/10/2026, o que vier primeiro
// (`AGENTS.md`: uma rede temporária tem data de fim).
export const FIM_DA_REDE_SEM_BASE = "2026-11-01T00:00:00Z";

export type DecisaoMigracao =
  { tipo: "sem_base"; aviso: string } | { tipo: "migrar"; url: string };

export function decidirMigracao(
  env: Readonly<Record<string, string | undefined>>,
  agora: Date,
): DecisaoMigracao {
  const url = env["BASE_DADOS_URL_MIGRACAO"];
  if (url === undefined) {
    if (agora.getTime() >= Date.parse(FIM_DA_REDE_SEM_BASE)) {
      throw new Error(
        `migrar: falta BASE_DADOS_URL_MIGRACAO e a rede «sem base» acabou a ${FIM_DA_REDE_SEM_BASE}`,
      );
    }
    return {
      tipo: "sem_base",
      aviso: `migrar: sem BASE_DADOS_URL_MIGRACAO — a base ainda não está configurada neste ambiente; nenhuma migração aplicada (tolerado até ${FIM_DA_REDE_SEM_BASE}).`,
    };
  }
  if (url.trim() === "") {
    throw new Error(
      "migrar: BASE_DADOS_URL_MIGRACAO está definida mas vazia — configuração errada, não se publica sem migrar",
    );
  }
  return { tipo: "migrar", url };
}
