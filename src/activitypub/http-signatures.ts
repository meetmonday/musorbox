import { webcrypto, createPublicKey, verify as nodeVerify } from "node:crypto";

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

/**
 * Verify an HTTP signature whose public key may be RSA (RSASSA-PKCS1-v1_5 +
 * SHA-256, the ActivityPub default) or Ed25519 (used by Misskey, newer Pleroma,
 * and GoToSocial). Ed25519 is not supported by WebCrypto, so it is verified via
 * node:crypto's `verify(null, ...)` on the Ed25519 SPKI key.
 */
export async function verifySignature(data: string, signatureB64: string, publicKeyPem: string): Promise<boolean> {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType === "ed25519") {
      const sig = Buffer.from(signatureB64, "base64");
      if (sig.length !== 64) return false;
      return nodeVerify(null, Buffer.from(data), key, sig);
    }
  } catch {
    /* fall through to RSA verification below */
  }
  return verifySpki(data, signatureB64, publicKeyPem);
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
  sigInputHeader?: string | null;
};

async function digestMatchesBody(digestHeader: string, body: string): Promise<boolean> {
  const expected = await sha256Base64(body);
  for (const part of digestHeader.split(",")) {
    const p = part.trim();
    if (/^sha-256=/i.test(p)) {
      return p.slice("sha-256=".length) === expected;
    }
  }
  return false;
}

export async function verifyHttpSignature(input: VerifyInput): Promise<{ ok: boolean; reason: string }> {
  const legacy = await verifyLegacySignature(input);
  if (legacy.ok) return legacy;
  const rfc9421 = await verifyRfc9421Signature(input);
  if (rfc9421.ok) return rfc9421;
  const bothMissing = legacy.reason === "no-signature" && rfc9421.reason === "rfc9421-no-signature-input";
  return { ok: false, reason: bothMissing ? "no-signature" : `${legacy.reason} | ${rfc9421.reason}` };
}

async function verifyLegacySignature(input: VerifyInput): Promise<{ ok: boolean; reason: string }> {
  const raw = extractSignature(input.sigHeader, input.authHeader);
  if (!raw) return { ok: false, reason: "no-signature" };
  const sp = parseSignature(raw);
  if (!sp) return { ok: false, reason: "legacy-parse-failed" };

  // The signature must bind both the request target and a timestamp; otherwise
  // a captured signature can be replayed against a different path/date and the
  // body is not freshness- or integrity-bound.
  if (!sp.headers.includes("(request-target)")) return { ok: false, reason: "legacy-missing-request-target" };
  if (!sp.headers.includes("date")) return { ok: false, reason: "legacy-missing-date" };
  for (const h of sp.headers) {
    if (h === "date" && input.getHeader("date")) {
      if (!dateWithinSkew(input.getHeader("date")!)) return { ok: false, reason: "legacy-date-skew" };
    }
  }

  const digestHeader = input.getHeader("digest");
  if (digestHeader) {
    if (!sp.headers.includes("digest")) return { ok: false, reason: "legacy-missing-digest-header" };
    if (!(await digestMatchesBody(digestHeader, input.body))) return { ok: false, reason: "legacy-digest-mismatch" };
  }

  const signingString = buildSigningString(input.method, input.path, sp.headers, input.getHeader);
  if (!(await verifySignature(signingString, sp.signature, input.actorPublicKeyPem))) {
    return { ok: false, reason: "legacy-crypto" };
  }
  return { ok: true, reason: "legacy-ok" };
}

/* ── RFC 9421 (HTTP Message Signatures) ── */

type Rfc9421Sig = {
  name: string;
  components: string[];
  keyId: string | null;
  alg: string | null;
  created: number | null;
  expires: number | null;
};

/**
 * Parse an RFC 9421 `Signature-Input` header, e.g.
 *   sig1=("@method" "@path" "@authority" "content-type" "digest");created=1700000000;keyid="...#main-key";alg="rsa-v1_5-sha256"
 */
export function parseSignatureInput(value: string | null | undefined): Rfc9421Sig | null {
  if (!value) return null;
  const m = /^([A-Za-z0-9_-]+)\s*=\s*\(([\s\S]*?)\)(.*)$/.exec(value.trim());
  if (!m) return null;
  const components = (m[2] ?? "")
    .split(/\s+/)
    .map((c) => c.replace(/^"|"$/g, ""))
    .filter(Boolean);
  const params: Record<string, string | number> = {};
  const re = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g;
  let pm: RegExpExecArray | null;
  while ((pm = re.exec(m[3] ?? "")) !== null) {
    const k = (pm[1] ?? "").toLowerCase();
    const v = pm[2] ?? pm[3] ?? pm[4];
    if (k && v !== undefined && v !== null) params[k] = v;
  }
  const created = typeof params.created === "number" ? params.created : params.created === undefined ? null : Number(params.created);
  const expires = typeof params.expires === "number" ? params.expires : params.expires === undefined ? null : Number(params.expires);
  return {
    name: m[1]!,
    components,
    keyId: typeof params.keyid === "string" ? params.keyid : null,
    alg: typeof params.alg === "string" ? params.alg : null,
    created: Number.isFinite(created) ? created : null,
    expires: Number.isFinite(expires) ? expires : null,
  };
}

/** Pull `name=:base64:` out of an RFC 9421 `Signature` header. */
export function parseSignatureField(value: string | null | undefined, name: string): string | null {
  if (!value) return null;
  const m = new RegExp(`${name}\\s*=\\s*:([^:]*):`).exec(value);
  return m?.[1] ?? null;
}

function buildRfc9421String(
  method: string,
  url: URL,
  components: string[],
  created: number | null,
  expires: number | null,
  getHeader: (name: string) => string | undefined,
): string {
  const lines: string[] = [];
  for (const rawname of components) {
    const name = rawname.toLowerCase();
    let value: string | null = null;
    switch (name) {
      case "@method":
        value = method.toUpperCase();
        break;
      case "@path":
        value = url.pathname;
        break;
      case "@query":
        value = url.search.replace(/^\?/, "");
        break;
      case "@authority":
        value = url.host;
        break;
      case "@scheme":
        value = url.protocol.replace(/:$/, "");
        break;
      case "@target-uri":
        value = url.toString();
        break;
      case "@created":
        value = created === null ? null : String(created);
        break;
      case "@expires":
        value = expires === null ? null : String(expires);
        break;
      default: {
        const h = name.startsWith("@") ? name.slice(1) : name;
        value = getHeader(h) ?? getHeader(name) ?? "";
        break;
      }
    }
    if (value === null) continue;
    lines.push(`${name}: ${value}`);
  }
  return lines.join("\n");
}

async function verifyRfc9421Signature(input: VerifyInput): Promise<{ ok: boolean; reason: string }> {
  const sigInputHeader = input.sigInputHeader ?? input.getHeader("signature-input");
  const si = parseSignatureInput(sigInputHeader);
  if (!si) return { ok: false, reason: "rfc9421-no-signature-input" };
  const signature = parseSignatureField(input.sigHeader, si.name);
  if (!signature) return { ok: false, reason: "rfc9421-no-signature-field" };

  if (si.created !== null && Math.abs(Date.now() / 1000 - si.created) > clockSkewMs / 1000) {
    return { ok: false, reason: "rfc9421-created-skew" };
  }
  const digestHeader = input.getHeader("digest");
  if (digestHeader && si.components.includes("digest")) {
    if (!(await digestMatchesBody(digestHeader, input.body))) return { ok: false, reason: "rfc9421-digest-mismatch" };
  }
  if (si.components.includes("date") && input.getHeader("date") && !dateWithinSkew(input.getHeader("date")!)) {
    return { ok: false, reason: "rfc9421-date-skew" };
  }

  let url: URL;
  try {
    const scheme = (input.getHeader("x-forwarded-proto") ?? "https").split(",")[0]?.trim() || "https";
    const hostHeader = input.getHeader("host") ?? "localhost";
    url = new URL(`${scheme}://${hostHeader}${input.path}`);
  } catch {
    return { ok: false, reason: "rfc9421-bad-url" };
  }
  const signingString = buildRfc9421String(input.method, url, si.components, si.created, si.expires, input.getHeader);
  if (!(await verifySignature(signingString, signature, input.actorPublicKeyPem))) {
    return { ok: false, reason: "rfc9421-crypto" };
  }
  return { ok: true, reason: "rfc9421-ok" };
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

/**
 * Sign an outbound resource fetch (GET). Some hosts (mastodon.social, and any
 * with `authorized_fetch` / secure mode) reject unauthenticated profile and
 * object fetches with `401 Request not signed`, so we sign the GET exactly like
 * Mastodon signs its own outbound requests. The `keyId` must be a publicly
 * resolvable actor key so the remote can fetch and verify it.
 */
export async function signUrlFetch(input: {
  method: string;
  url: string;
  privateKeyPem: string;
  keyId: string;
}): Promise<{ headers: Record<string, string> }> {
  const u = new URL(input.url);
  const date = new Date().toUTCString();
  const path = u.pathname + u.search;
  const host = u.host;
  const method = input.method.toLowerCase();
  const names = ["(request-target)", "host", "date", "accept"];
  const values: Record<string, string> = {
    "(request-target)": `${method} ${path}`,
    host,
    date,
    accept: "application/activity+json",
  };
  const signingString = names.map((n) => `${n}: ${values[n]}`).join("\n");
  const signature = await signPkcs8(signingString, input.privateKeyPem);
  const sigHeader = `keyId="${input.keyId}",algorithm="rsa-sha256",headers="${names.join(" ")}",signature="${signature}"`;
  const accept = values.accept ?? "application/activity+json";
  return {
    headers: { Signature: sigHeader, Date: date, Accept: accept },
  };
}