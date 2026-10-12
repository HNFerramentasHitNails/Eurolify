import { describe, expect, it } from "vitest";
import {
  consultaDe,
  curto,
  DECIDE_A_FILA,
  doEndereco,
  enderecoDe,
  FILAS_TAREFAS,
  horasDesde,
  instanteDe,
  limiteDoPrazo,
  motivoDe,
  relogioDe,
} from "../src/tarefas";
import { TEXTOS } from "../src/textos";
import { FILAS } from "../../api/src/tarefas/filas";
import { FILAS_TAREFAS as FILAS_DA_API } from "../../api/src/base/esquema";

// O ecrã «A decidir» (docs/22 §28): o filtro, o motivo e as horas no fuso
// do comerciante. A régua de quem decide cada fila é a da API: este teste vê
// se uma muda sem a outra.

describe("as filas e quem as decide", () => {
  it("as sete filas são as da API, pela mesma ordem", () => {
    expect([...FILAS_TAREFAS]).toEqual([...FILAS_DA_API]);
  });

  it("o âmbito que decide cada fila é o da régua da API", () => {
    for (const f of FILAS_TAREFAS) {
      expect(DECIDE_A_FILA[f], f).toBe(FILAS[f].decidir);
    }
  });

  it("cada fila tem nome nas três línguas", () => {
    for (const l of ["pt", "es", "en"] as const) {
      for (const f of FILAS_TAREFAS) {
        expect(TEXTOS[l][`fila_${f}`].trim(), `${l} ${f}`).not.toBe("");
      }
    }
  });
});

describe("o filtro", () => {
  it("vai do endereço à consulta da API", () => {
    expect(consultaDe("meus", null, null)).toBe("limite=25&responsavel=eu");
    expect(consultaDe("sem", "problema", null)).toBe(
      "limite=25&responsavel=sem&fila=problema",
    );
    expect(consultaDe("vencidas", null, "abc")).toBe(
      "limite=25&vencida=true&cursor=abc",
    );
    expect(consultaDe("todos", null, null)).toBe("limite=25");
  });

  it("um valor desconhecido no endereço não conta", () => {
    expect(doEndereco("?filtro=vencidas&fila=reembolso")).toEqual({
      filtro: "vencidas",
      fila: "reembolso",
    });
    expect(doEndereco("?filtro=x&fila=y")).toEqual({
      filtro: "todos",
      fila: null,
    });
  });

  it("o endereço leva o comerciante e só o que não é por omissão", () => {
    expect(enderecoDe("mer_1", "todos", null)).toBe(
      "/a-decidir?comerciante=mer_1",
    );
    expect(enderecoDe("mer_1", "sem", "pagamento")).toBe(
      "/a-decidir?comerciante=mer_1&filtro=sem&fila=pagamento",
    );
  });
});

describe("o motivo", () => {
  it("cada código pelo seu texto; vários, todos; um desconhecido, como está", () => {
    expect(motivoDe(TEXTOS.pt, "incerto")).toBe("estado incerto");
    expect(motivoDe(TEXTOS.pt, "emissor_por_configurar,taxa_sem_mapa")).toBe(
      "falta configurar o emissor; taxa de IVA sem correspondência no emissor",
    );
    expect(motivoDe(TEXTOS.en, "email,telefone")).toBe(
      "same email; same phone",
    );
    expect(motivoDe(TEXTOS.pt, "codigo_novo")).toBe("codigo_novo");
  });

  it("o identificador encurtado mostra o prefixo e os últimos 4", () => {
    expect(curto("pdi_0190a0b1-0000-7000-8000-000000000190")).toBe("pdi_…0190");
  });
});

describe("as horas no fuso do comerciante", () => {
  it("Lisboa no inverno é UTC e no verão UTC+1", () => {
    expect(instanteDe("2026-01-15T09:30", "Europe/Lisbon")).toBe(
      "2026-01-15T09:30:00.000Z",
    );
    expect(instanteDe("2026-07-15T09:30", "Europe/Lisbon")).toBe(
      "2026-07-15T08:30:00.000Z",
    );
    expect(instanteDe("2026-07-15T09:30", "Europe/Madrid")).toBe(
      "2026-07-15T07:30:00.000Z",
    );
  });

  it("ida e volta dão o mesmo relógio", () => {
    for (const r of [
      "2026-03-29T00:30",
      "2026-10-25T03:15",
      "2026-12-31T23:59",
    ]) {
      const i = instanteDe(r, "Europe/Lisbon");
      expect(i).not.toBeNull();
      expect(relogioDe(i ?? "", "Europe/Lisbon"), r).toBe(r);
    }
  });

  it("a hora que não existe (o salto de março) passa para a seguinte", () => {
    // Em Lisboa, a 29/03/2026, das 01:00 salta-se para as 02:00.
    const i = instanteDe("2026-03-29T01:30", "Europe/Lisbon");
    expect(relogioDe(i ?? "", "Europe/Lisbon")).toBe("2026-03-29T02:30");
  });

  it("a hora que se repete (o recuo de Outubro) fica a segunda, a do inverno", () => {
    // Em Lisboa, a 25/10/2026, das 02:00 volta-se à 01:00: 01:30 acontece
    // duas vezes (00:30Z e 01:30Z).
    expect(instanteDe("2026-10-25T01:30", "Europe/Lisbon")).toBe(
      "2026-10-25T01:30:00.000Z",
    );
  });

  it("um texto fora do formato não dá instante", () => {
    expect(instanteDe("29/03/2026 10:00", "Europe/Lisbon")).toBeNull();
    expect(instanteDe("", "Europe/Lisbon")).toBeNull();
  });

  it("o limite é o fim do último dia legal; há quanto tempo em horas inteiras", () => {
    // A meia-noite do dia seguinte, como a base (0066, tarefas_mudar_prazo).
    expect(limiteDoPrazo("2026-10-20")).toBe("2026-10-21T00:00");
    expect(limiteDoPrazo("2026-12-31")).toBe("2027-01-01T00:00");
    expect(limiteDoPrazo(null)).toBeNull();
    const agora = Date.parse("2026-10-12T12:00:00Z");
    expect(horasDesde("2026-10-12T09:30:00Z", agora)).toBe(2);
    expect(horasDesde("2026-10-13T09:30:00Z", agora)).toBe(0);
  });
});
