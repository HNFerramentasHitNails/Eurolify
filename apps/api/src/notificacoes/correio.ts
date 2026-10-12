import { createTransport } from "nodemailer";

// O correio das notificações (docs/34, N1 e N8; docs/06, DX): o envio por
// SMTP, que o fornecedor escolhido (OVH E-mail Pro) e os serviços
// transaccionais aceitam — mudar de fornecedor é mudar a configuração. O de
// ensaio guarda os e-mails em memória, para os testes.

export interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
}

export interface Correio {
  /** Envia; devolve o `Message-ID` que o servidor aceitou. */
  enviar(m: Mensagem): Promise<{ id: string }>;
}

/**
 * De quem é a culpa de um envio que não passou (revisão do #373, P1-1):
 * - `destinatario_recusado`: o servidor recusou este endereço de vez (5xx ao
 *   `RCPT TO`, ou o endereço não é válido): falha já;
 * - `destinatario_temporario`: 4xx ao `RCPT TO`: repete, e à 6.ª falha;
 * - `servidor`: tudo o resto (sem ligação, autenticação recusada, o
 *   remetente recusado, o DNS por fazer, o tempo esgotado): é do servidor ou
 *   da configuração, não da notificação — não conta como tentativa e a volta
 *   pára, para não gastar a fila inteira num erro que se corrige uma vez.
 * O `codigo` vai para a base: só letras, números, `_` e `.`, nunca a mensagem
 * do servidor.
 */
export type CulpaDoErro =
  "destinatario_recusado" | "destinatario_temporario" | "servidor";

export class ErroCorreio extends Error {
  constructor(
    readonly codigo: string,
    readonly culpa: CulpaDoErro,
  ) {
    super(`correio: ${codigo}`);
    this.name = "ErroCorreio";
  }
}

export interface ConfigSmtp {
  anfitriao: string;
  porta: number;
  utilizador: string;
  palavraPasse: string;
  remetente: string;
  /** Só os testes, contra um servidor falso sem TLS, o desligam. */
  exigirTls?: boolean;
}

const VARIAVEIS = [
  "SMTP_ANFITRIAO",
  "SMTP_PORTA",
  "SMTP_UTILIZADOR",
  "SMTP_PALAVRA_PASSE",
  "SMTP_REMETENTE",
] as const;

/**
 * Lê a configuração do ambiente (docs/34 §5). Nenhuma variável: sem correio,
 * sem problema. Algumas, ou a porta errada: sem correio, e o `problema` diz
 * que variáveis (nunca os valores), para o registo — a API arranca na mesma
 * (revisão do #373, P2-5).
 */
export function configSmtp(env: Record<string, string | undefined>): {
  config?: ConfigSmtp;
  problema?: string;
} {
  const v = (k: (typeof VARIAVEIS)[number]) =>
    k === "SMTP_PALAVRA_PASSE" ? (env[k] ?? "") : (env[k]?.trim() ?? "");
  const faltam = VARIAVEIS.filter((k) => v(k) === "");
  if (faltam.length === VARIAVEIS.length) return {};
  if (faltam.length > 0) return { problema: `faltam ${faltam.join(", ")}` };
  const porta = Number(v("SMTP_PORTA"));
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    return { problema: "SMTP_PORTA não é um número de 1 a 65535 (465 ou 587)" };
  }
  return {
    config: {
      anfitriao: v("SMTP_ANFITRIAO"),
      porta,
      utilizador: v("SMTP_UTILIZADOR"),
      palavraPasse: v("SMTP_PALAVRA_PASSE"),
      remetente: v("SMTP_REMETENTE"),
    },
  };
}

/** O código e a culpa, a partir do erro do nodemailer. */
export function classificar(erro: unknown): ErroCorreio {
  const e = erro as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  const resposta = typeof e.responseCode === "number" ? e.responseCode : null;
  const codigo =
    resposta !== null
      ? `smtp_${String(resposta)}`
      : typeof e.code === "string" && /^[A-Z]{3,20}$/.test(e.code)
        ? e.code.toLowerCase()
        : "desconhecido";
  if (e.command === "RCPT TO" && resposta !== null) {
    return new ErroCorreio(
      codigo,
      resposta >= 500 ? "destinatario_recusado" : "destinatario_temporario",
    );
  }
  // O nodemailer recusa um endereço inválido antes de o enviar.
  if (e.command === "API" && e.code === "EENVELOPE") {
    return new ErroCorreio("endereco_invalido", "destinatario_recusado");
  }
  return new ErroCorreio(codigo, "servidor");
}

/**
 * Um endereço simples (revisão do #373, P2-3): o e-mail das contas não está
 * confirmado (CE) e a regra da base deixa passar `,`, `<` e `"`; um destes
 * viraria uma lista de destinatários.
 */
const ENDERECO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Um envio pendurado não pára a fila (revisão do #373, P3-2). */
const TEMPO_TOTAL_MS = 60_000;

export function correioSmtp(c: ConfigSmtp): Correio {
  const exigirTls = c.exigirTls ?? true;
  const transporte = createTransport({
    host: c.anfitriao,
    port: c.porta,
    // 465: TLS desde o início; 587: STARTTLS, exigido.
    secure: c.porta === 465,
    requireTLS: exigirTls && c.porta !== 465,
    ignoreTLS: !exigirTls,
    auth: { user: c.utilizador, pass: c.palavraPasse },
    // Uma ligação que serve a volta toda, não um login por e-mail (P3-1).
    pool: true,
    maxConnections: 1,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async enviar(m) {
      if (!ENDERECO.test(m.para)) {
        throw new ErroCorreio("endereco_invalido", "destinatario_recusado");
      }
      let relogio: NodeJS.Timeout | undefined;
      try {
        const r = await Promise.race([
          transporte.sendMail({
            from: c.remetente,
            to: m.para,
            subject: m.assunto,
            text: m.texto,
          }),
          new Promise<never>((_, nao) => {
            relogio = setTimeout(() => {
              nao(new ErroCorreio("tempo_esgotado", "servidor"));
            }, TEMPO_TOTAL_MS);
          }),
        ]);
        // Aceite só se o servidor aceitou exactamente este destinatário.
        if (r.rejected.length > 0 || r.accepted.length !== 1) {
          throw new ErroCorreio(
            "destinatario_recusado",
            "destinatario_recusado",
          );
        }
        return { id: r.messageId };
      } catch (erro) {
        throw erro instanceof ErroCorreio ? erro : classificar(erro);
      } finally {
        clearTimeout(relogio);
      }
    },
  };
}

/** Para os testes: guarda o que sai e pode falhar à vontade. */
export class CorreioDeEnsaio implements Correio {
  readonly enviados: (Mensagem & { id: string })[] = [];
  /** Os próximos erros a dar, um por envio. */
  readonly falhas: ErroCorreio[] = [];

  enviar(m: Mensagem): Promise<{ id: string }> {
    const falha = this.falhas.shift();
    if (falha !== undefined) return Promise.reject(falha);
    const id = `<ensaio-${String(this.enviados.length + 1)}@eurolify.test>`;
    this.enviados.push({ ...m, id });
    return Promise.resolve({ id });
  }
}
