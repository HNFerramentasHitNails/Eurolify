import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

// Um autenticador WebAuthn em software, só para os testes (docs/21 §9,
// P-T14): faz o que o telemóvel faz — cria uma chave P-256 (ES256), devolve
// o registo («none», sem atestação) e assina os desafios. Os bytes seguem a
// especificação WebAuthn nível 3 (§6.1 authenticatorData, §6.5.1 dados da
// credencial) e o CBOR do RFC 8949, só o que é preciso aqui.

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

function cabeca(tipo: number, valor: number): Buffer {
  if (valor < 24) return Buffer.from([(tipo << 5) | valor]);
  if (valor < 0x100) return Buffer.from([(tipo << 5) | 24, valor]);
  if (valor < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (tipo << 5) | 25;
    b.writeUInt16BE(valor, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (tipo << 5) | 26;
  b.writeUInt32BE(valor, 1);
  return b;
}

export function cbor(valor: Cbor): Buffer {
  if (typeof valor === "number") {
    return valor >= 0 ? cabeca(0, valor) : cabeca(1, -1 - valor);
  }
  if (typeof valor === "string") {
    const b = Buffer.from(valor, "utf8");
    return Buffer.concat([cabeca(3, b.length), b]);
  }
  if (valor instanceof Uint8Array) {
    return Buffer.concat([cabeca(2, valor.length), Buffer.from(valor)]);
  }
  const partes = [cabeca(5, valor.size)];
  for (const [k, v] of valor) partes.push(cbor(k), cbor(v));
  return Buffer.concat(partes);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest();

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export interface OpcoesDeAssinatura {
  /** Origem que o navegador põe no clientDataJSON. */
  origem: string;
  /** rpID cujo resumo vai nos dados do autenticador. */
  rpId: string;
  /** Sem verificação do utilizador (PIN, biometria): flag UV a 0. */
  semVerificacao?: boolean;
  /** Contador a usar; por omissão, o seguinte. */
  contador?: number;
}

export class AutenticadorDeTeste {
  readonly credencialId = randomBytes(32);
  private readonly privada: KeyObject;
  private readonly cose: Buffer;
  contador = 0;

  constructor(
    /** Um autenticador que conta as utilizações (ou fica em 0, como os sincronizados). */
    private readonly contaUsos = true,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    this.privada = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.cose = cbor(
      new Map<number, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x ?? "", "base64url")],
        [-3, Buffer.from(jwk.y ?? "", "base64url")],
      ]),
    );
  }

  get id(): string {
    return b64(this.credencialId);
  }

  private clientData(
    tipo: "webauthn.create" | "webauthn.get",
    desafio: string,
    origem: string,
  ) {
    return Buffer.from(
      JSON.stringify({
        type: tipo,
        challenge: desafio,
        origin: origem,
        crossOrigin: false,
      }),
      "utf8",
    );
  }

  private dadosDoAutenticador(
    rpId: string,
    flags: number,
    contador: number,
    comCredencial: boolean,
  ) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(contador, 0);
    const partes = [sha256(rpId), Buffer.from([flags]), c];
    if (comCredencial) {
      const tamanho = Buffer.alloc(2);
      tamanho.writeUInt16BE(this.credencialId.length, 0);
      partes.push(Buffer.alloc(16), tamanho, this.credencialId, this.cose);
    }
    return Buffer.concat(partes);
  }

  /** O registo de uma passkey nova, como o navegador o devolve. */
  registar(desafio: string, opcoes: OpcoesDeAssinatura) {
    const flags = UP | AT | (opcoes.semVerificacao === true ? 0 : UV);
    const authData = this.dadosDoAutenticador(
      opcoes.rpId,
      flags,
      this.contador,
      true,
    );
    const atestacao = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64(
          this.clientData("webauthn.create", desafio, opcoes.origem),
        ),
        attestationObject: b64(atestacao),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** A assinatura de um desafio de entrada. */
  assinar(desafio: string, opcoes: OpcoesDeAssinatura) {
    if (opcoes.contador !== undefined) this.contador = opcoes.contador;
    else if (this.contaUsos) this.contador += 1;
    const flags = UP | (opcoes.semVerificacao === true ? 0 : UV);
    const authData = this.dadosDoAutenticador(
      opcoes.rpId,
      flags,
      this.contador,
      false,
    );
    const clientData = this.clientData("webauthn.get", desafio, opcoes.origem);
    const assinatura = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientData)]),
      this.privada,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(assinatura),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
