import { lookup } from "node:dns/promises";
import { basename } from "node:path";
import { isIP } from "node:net";
import type { Context } from "hono";
import { config } from "../core/config";
import {
  MAX_MESSAGE_IMAGE_BYTES,
  MAX_MESSAGE_IMAGES,
  MAX_MESSAGE_IMAGES_TOTAL_BYTES,
} from "../messages/media";
import { BotMethodError } from "./methods";

const REMOTE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REMOTE_REDIRECTS = 4;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const supportedMimeTypes = new Set(Object.values(mimeByExtension));

export type TelegramMediaItem = {
  type: "photo";
  media: string;
  caption?: string;
  caption_entities?: Array<Record<string, unknown>>;
};

export type MediaGroupInput = {
  params: Record<string, unknown>;
  items: TelegramMediaItem[];
  files: File[];
  caption: string;
  captionEntities?: Array<Record<string, unknown>>;
  discardedCaptionCount: number;
};

function extensionMime(name: string): string | undefined {
  const path = name.toLowerCase().split(/[?#]/, 1)[0] ?? "";
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? mimeByExtension[path.slice(dot)] : undefined;
}

function normalizedFile(file: File): File {
  const declared = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type.toLowerCase();
  const mimeType = supportedMimeTypes.has(declared) ? declared : extensionMime(file.name);
  if (!mimeType) throw new BotMethodError(415, "Unsupported Media Type: only JPEG, PNG, WebP and GIF are supported");
  return declared === mimeType ? file : new File([file], file.name, { type: mimeType });
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function isPublicIp(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPublicIpv4(address);
  if (kind !== 6) return false;
  const value = address.toLowerCase();
  if (value === "::" || value === "::1" || value.startsWith("ff")) return false;
  if (value.startsWith("fc") || value.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(value)) return false;
  if (value.startsWith("2001:db8:") || value.startsWith("2001:0:") || value.startsWith("2002:")) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)?.[1];
  return mapped ? isPublicIpv4(mapped) : true;
}

async function assertPublicRemoteUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new BotMethodError(400, "Bad Request: media URL must use public HTTPS");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new BotMethodError(400, "Bad Request: private media hosts are not allowed");
  }
  const directIp = isIP(hostname);
  const addresses = directIp ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new BotMethodError(400, "Bad Request: private media hosts are not allowed");
  }
}

function responseMime(response: Response, url: URL): string {
  const declared = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (supportedMimeTypes.has(declared)) return declared;
  if (declared && declared !== "application/octet-stream") {
    throw new BotMethodError(415, "Unsupported Media Type: remote file is not an image");
  }
  const inferred = extensionMime(url.pathname);
  if (!inferred) throw new BotMethodError(415, "Unsupported Media Type: remote image type is unknown");
  return inferred;
}

async function responseFile(
  response: Response,
  url: URL,
  maxBytes: number,
): Promise<File> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BotMethodError(413, "Request Entity Too Large: media group exceeds the size limit");
  }
  if (!response.body) throw new BotMethodError(400, "Bad Request: remote media response has no body");
  const mimeType = responseMime(response, url);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BotMethodError(413, "Request Entity Too Large: media group exceeds the size limit");
    }
    chunks.push(part.value);
  }
  const filename = basename(url.pathname) || `photo.${mimeType.split("/")[1]}`;
  return new File(chunks, filename, { type: mimeType });
}

async function downloadRemotePhoto(rawUrl: string, maxBytes: number): Promise<File> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BotMethodError(400, "Bad Request: invalid media URL");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REMOTE_REDIRECTS; hop++) {
      await assertPublicRemoteUrl(url);
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "image/jpeg, image/png, image/webp, image/gif",
          "User-Agent": `MusorBoxBotMedia/1.0 (+${config.baseUrl})`,
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REMOTE_REDIRECTS) {
          throw new BotMethodError(400, "Bad Request: too many media redirects");
        }
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        throw new BotMethodError(400, `Bad Request: remote media host ${url.hostname} returned HTTP ${response.status}`);
      }
      return await responseFile(response, url, Math.min(maxBytes, MAX_MESSAGE_IMAGE_BYTES));
    }
    throw new BotMethodError(400, "Bad Request: too many media redirects");
  } catch (error) {
    if (error instanceof BotMethodError) throw error;
    if (controller.signal.aborted) throw new BotMethodError(400, "Bad Request: remote media download timed out");
    throw new BotMethodError(400, "Bad Request: failed to download remote media");
  } finally {
    clearTimeout(timeout);
  }
}

function mediaItems(value: unknown): TelegramMediaItem[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_MESSAGE_IMAGES) {
    throw new BotMethodError(400, `Bad Request: media must contain 2-${MAX_MESSAGE_IMAGES} items`);
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BotMethodError(400, `Bad Request: media[${index}] must be an object`);
    }
    const item = raw as Record<string, unknown>;
    if (item.type !== "photo" || typeof item.media !== "string") {
      throw new BotMethodError(415, "Unsupported Media Type: sendMediaGroup currently supports photos only");
    }
    if (item.caption !== undefined && typeof item.caption !== "string") {
      throw new BotMethodError(400, `Bad Request: media[${index}].caption must be a string`);
    }
    return {
      type: "photo",
      media: item.media,
      caption: item.caption as string | undefined,
      caption_entities: Array.isArray(item.caption_entities)
        ? item.caption_entities as Array<Record<string, unknown>>
        : undefined,
    };
  });
}

export async function parseMediaGroupRequest(c: Context): Promise<MediaGroupInput> {
  const contentType = c.req.header("Content-Type") ?? "";
  let params: Record<string, unknown>;
  const uploads = new Map<string, File>();

  if (/^application\/json(?:\s*;|$)/i.test(contentType)) {
    try {
      const value: unknown = await c.req.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      params = value as Record<string, unknown>;
    } catch {
      throw new BotMethodError(400, "Bad Request: invalid JSON body");
    }
  } else if (/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
    const contentLength = Number(c.req.header("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_MESSAGE_IMAGES_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new BotMethodError(413, "Request Entity Too Large: media group exceeds the size limit");
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new BotMethodError(400, "Bad Request: invalid multipart body");
    }
    params = {};
    for (const [name, value] of form.entries()) {
      if (typeof value !== "string") uploads.set(name, value as File);
      else params[name] = name === "media" ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          throw new BotMethodError(400, "Bad Request: media must be valid JSON");
        }
      })() : value;
    }
  } else {
    throw new BotMethodError(415, "Unsupported Media Type: expected JSON or multipart/form-data");
  }

  const items = mediaItems(params.media);
  const files: File[] = [];
  let totalBytes = 0;
  for (const item of items) {
    let file: File;
    if (item.media.startsWith("attach://")) {
      const name = item.media.slice("attach://".length);
      const uploaded = uploads.get(name);
      if (!uploaded) throw new BotMethodError(400, `Bad Request: attachment ${name} is missing`);
      file = normalizedFile(uploaded);
    } else if (/^https?:\/\//i.test(item.media)) {
      file = await downloadRemotePhoto(item.media, MAX_MESSAGE_IMAGES_TOTAL_BYTES - totalBytes);
    } else {
      throw new BotMethodError(400, "Bad Request: file_id reuse is not supported yet");
    }
    totalBytes += file.size;
    if (file.size < 1 || file.size > MAX_MESSAGE_IMAGE_BYTES || totalBytes > MAX_MESSAGE_IMAGES_TOTAL_BYTES) {
      throw new BotMethodError(413, "Request Entity Too Large: media group exceeds the size limit");
    }
    files.push(file);
  }

  const captioned = items.filter((item) => item.caption?.trim());
  const firstCaption = captioned[0];
  return {
    params,
    items,
    files,
    caption: firstCaption?.caption ?? "",
    captionEntities: firstCaption?.caption_entities,
    discardedCaptionCount: Math.max(0, captioned.length - 1),
  };
}
