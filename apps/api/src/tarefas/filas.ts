import type { Ambito } from "../identidade/chaves.js";
import type { FilaTarefa } from "../base/esquema.js";

// As filas que pedem uma pessoa (docs/33 §1; decisão DW): o prefixo do caso
// na API, o âmbito que a lê e o que a decide. A base tem a mesma régua
// (`tarefas_filas()`, migração 0066) e é ela que decide quem pode ser
// responsável; esta serve às rotas, e um teste confere que são iguais.

export interface Fila {
  prefixo: string;
  ler: Ambito;
  decidir: Ambito;
}

export const FILAS: Record<FilaTarefa, Fila> = {
  pagamento: {
    prefixo: "pdi",
    ler: "payments:read",
    decidir: "payments:resolve",
  },
  documento_fiscal: {
    prefixo: "inv",
    ler: "invoices:read",
    decidir: "invoices:write",
  },
  duplicado_cliente: {
    prefixo: "dup",
    ler: "customers:read",
    decidir: "customers:merge",
  },
  prazo_reembolso: {
    prefixo: "rma",
    ler: "returns:read",
    decidir: "refunds:write",
  },
  livre_resolucao: {
    prefixo: "wdr",
    ler: "returns:read",
    decidir: "returns:write",
  },
  problema: { prefixo: "prb", ler: "returns:read", decidir: "refunds:write" },
  reembolso: { prefixo: "rfd", ler: "refunds:read", decidir: "refunds:write" },
};
