import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

const rsaParams = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: { name: "SHA-256" },
} as const;

export type KeyPair = { privateKeyPem: string; publicKeyPem: string };

export async function generateRsaKeyPair(): Promise<KeyPair> {
  const keys = await subtle.generateKey(rsaParams, true, ["sign", "verify"]);
  const [privateDer, publicDer] = await Promise.all([
    subtle.exportKey("pkcs8", keys.privateKey!),
    subtle.exportKey("spki", keys.publicKey!),
  ]);
  return {
    privateKeyPem: pemFromDer(privateDer as ArrayBuffer, "PRIVATE KEY"),
    publicKeyPem: pemFromDer(publicDer as ArrayBuffer, "PUBLIC KEY"),
  };
}

function pemFromDer(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der).toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function derFromPem(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bytes = Buffer.from(body, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function signPkcs8(data: string, privateKeyPem: string): Promise<string> {
  const key = await subtle.importKey(
    "pkcs8",
    derFromPem(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString("base64");
}

export async function verifySpki(data: string, signatureB64: string, publicKeyPem: string): Promise<boolean> {
  try {
    const key = await subtle.importKey(
      "spki",
      derFromPem(publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      Uint8Array.from(Buffer.from(signatureB64, "base64")),
      new TextEncoder().encode(data),
    );
    return ok;
  } catch {
    return false;
  }
}

export async function sha256Base64(input: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Buffer.from(digest).toString("base64");
}

export type SignatureParams = {
  keyId: string;
  algorithm?: string;
  headers: string[];
  signature: string;
};

/**
 * Parse an RFC 9421 (draft-cavage) HTTP Signature `Signature:` header value.
 */
export function parseSignature(value: string | null | undefined): SignatureParams | null {
  if (!value) return null;
  const params: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,;]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    const val = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (name) params[name] = val;
  }
  if (!params.keyid || !params.signature) return null;
  const walk = (params.headers ?? "(request-target) host date").trim();
  const headers = walk.split(/\s+/).map((h) => h.toLowerCase());
  return {
    keyId: params.keyid,
    algorithm: params.algorithm,
    headers,
    signature: params.signature,
  };
}

export function extractSignature(sigHeader: string | undefined | null, authHeader: string | undefined | null): string | null {
  if (sigHeader) return sigHeader;
  if (authHeader && authHeader.trim().toLowerCase().startsWith("signature ")) {
    return authHeader.trim().slice("signature ".length).trim();
  }
  return null;
}

/**
 * Build the string that is signed, per the listed headers.
 */
export function buildSigningString(
  method: string,
  path: string,
  headers: string[],
  getHeader: (name: string) => string | undefined,
): string {
  const lines: string[] = [];
  for (const h of headers) {
    if (h === "(request-target)") {
      lines.push(`(request-target): ${method.toLowerCase()} ${path}`);
    } else {
      lines.push(`${h}: ${getHeader(h) ?? ""}`);
    }
  }
  return lines.join("\n");
}

const clockSkewMs = 10 * 60 * 1000;

function dateWithinSkew(dateHeader: string): boolean {
  const t = Date.parse(dateHeader);
  if (Number.isNaN(t)) return false;
  return Math.abs(Date.now() - t) <= clockSkewMs;
}

export type VerifyInput = {
  method: string;
  path: string;
  body: string;
  actorPublicKeyPem: string;
  sigHeader: string | null;
  authHeader: string | null;
  getHeader: (name: string) => string | undefined;
};

export async function verifyHttpSignature(input: VerifyInput): Promise<boolean> {
  const raw = extractSignature(input.sigHeader, input.authHeader);
  if (!raw) return false;
  const sp = parseSignature(raw);
  if (!sp) return false;

  for (const h of sp.headers) {
    if (h === "date" && input.getHeader("date")) {
      if (!dateWithinSkew(input.getHeader("date")!)) return false;
    }
  }

  const digestHeader = input.getHeader("digest");
  if (digestHeader && sp.headers.includes("digest")) {
    const expected = `SHA-256=${await sha256Base64(input.body)}`;
    const normalized = digestHeader.split(",").find((d) => d.trim().startsWith("SHA-256="))?.trim();
    if (!normalized || normalized !== expected) return false;
  }

  const signingString = buildSigningString(input.method, input.path, sp.headers, input.getHeader);
  return verifySpki(signingString, sp.signature, input.actorPublicKeyPem);
}

export type SigningInput = {
  method: string;
  url: string;
  body: string;
  privateKeyPem: string;
  keyId: string;
  extraHeaders?: string[];
};

/**
 * Sign an outgoing request and return the headers to attach.
 */
export async function signRequest(input: SigningInput): Promise<{ headers: Record<string, string>; signature: string }> {
  const { method, url } = input;
  const u = new URL(url);
  const date = new Date().toUTCString();
  const digest = `SHA-256=${await sha256Base64(input.body)}`;
  const path = u.pathname + u.search;
  const host = u.host;

  const baseHeaders: Record<string, string> = {
    "(request-target)": `${method.toLowerCase()} ${path}`,
    host,
    date,
    digest,
    "content-type": "application/activity+json",
  };
  const names = ["(request-target)", "host", "date", "digest", "content-type"];
  for (const extra of input.extraHeaders ?? []) {
    const n = extra.toLowerCase();
    if (!names.includes(n)) names.push(n);
  }

  const signingString = names.map((n) => `${n}: ${baseHeaders[n] ?? ""}`).join("\n");
  const signature = await signPkcs8(signingString, input.privateKeyPem);

  const sigHeader =
    `keyId="${input.keyId}",` +
    `algorithm="rsa-sha256",` +
    `headers="${names.join(" ")}",` +
    `signature="${signature}"`;

  return {
    headers: {
      Signature: sigHeader,
      Date: date,
      Digest: digest,
      "Content-Type": "application/activity+json",
    },
    signature: sigHeader,
  };
}