import { createTransport } from "nodemailer";

// O correio das notificações (docs/33, N1 e N8; docs/06, DW): o envio por
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
 * Um envio que não passou. `temporario`: tenta-se outra vez (sem ligação, 4xx
 * do SMTP, autenticação recusada, que se corrige na configuração);
 * definitivo: 5xx do SMTP ou o endereço recusado (N6). O `codigo` vai para a
 * base: só letras, números, `_` e `.`, nunca a mensagem do servidor.
 */
export class ErroCorreio extends Error {
  constructor(
    readonly codigo: string,
    readonly temporario: boolean,
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
}

/** Lê a configuração do ambiente; sem as cinco variáveis, não há correio. */
export function configSmtp(
  env: Record<string, string | undefined>,
): ConfigSmtp | undefined {
  const v = (k: string) => env[k]?.trim() ?? "";
  const anfitriao = v("SMTP_ANFITRIAO");
  const porta = Number(v("SMTP_PORTA"));
  const utilizador = v("SMTP_UTILIZADOR");
  const palavraPasse = env["SMTP_PALAVRA_PASSE"] ?? "";
  const remetente = v("SMTP_REMETENTE");
  if (
    anfitriao === "" ||
    utilizador === "" ||
    palavraPasse === "" ||
    remetente === ""
  ) {
    return undefined;
  }
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error("SMTP_PORTA: um número de 1 a 65535 (465 ou 587)");
  }
  return { anfitriao, porta, utilizador, palavraPasse, remetente };
}

const TEMPORARIOS = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "EAUTH",
  "ETLS",
  "EPROTOCOL",
]);

/** O código e se é temporário, a partir do erro do nodemailer. */
export function classificar(erro: unknown): ErroCorreio {
  const e = erro as { code?: unknown; responseCode?: unknown };
  const resposta = typeof e.responseCode === "number" ? e.responseCode : null;
  if (resposta !== null) {
    return new ErroCorreio(`smtp_${String(resposta)}`, resposta < 500);
  }
  const codigo = typeof e.code === "string" ? e.code : "";
  if (/^[A-Z]{3,20}$/.test(codigo)) {
    return new ErroCorreio(codigo.toLowerCase(), TEMPORARIOS.has(codigo));
  }
  return new ErroCorreio("desconhecido", true);
}

export function correioSmtp(c: ConfigSmtp): Correio {
  const transporte = createTransport({
    host: c.anfitriao,
    port: c.porta,
    // 465: TLS desde o início; 587: STARTTLS, exigido.
    secure: c.porta === 465,
    requireTLS: c.porta !== 465,
    auth: { user: c.utilizador, pass: c.palavraPasse },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async enviar(m) {
      try {
        const r = await transporte.sendMail({
          from: c.remetente,
          to: m.para,
          subject: m.assunto,
          text: m.texto,
        });
        // Aceite só se o servidor aceitou este destinatário.
        if (r.rejected.length > 0) {
          throw new ErroCorreio("destinatario_recusado", false);
        }
        return { id: r.messageId };
      } catch (erro) {
        throw erro instanceof ErroCorreio ? erro : classificar(erro);
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
