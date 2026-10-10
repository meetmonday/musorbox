import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import type { TgMessage, TgPhotoSize, TgDocument, UploadedFile } from "./client";
import { config } from "../core/config";
import { fileUrl, getFile } from "./client";

/**
 * Изображения между сайтом и Telegram идут в обе стороны.
 *
 * Наружу (сайт → чат): относительные адреса картинок превращаются в абсолютные
 * (`siteUrlResolver` в format.ts), и Telegram сам скачивает их как `photo`.
 *
 * Внутрь (чат → сайт): файл из Telegram скачиваем, ужимаем и складываем в
 * `public/uploads`, после чего вставляем в тело комментария как `<img>`.
 */

const MAX_MEDIA_PER_MESSAGE = 10;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Предел заливки фото боту: берём с запасом от лимита Telegram. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Суммарный размер одного multipart-запроса (в Telegram до 50 МБ на сообщение). */
const MAX_UPLOAD_TOTAL_BYTES = 45 * 1024 * 1024;
const MAX_WIDTH = 800;

type MediaCandidate = { file_id: string; mime: string };

/** Файлы-картинки из сообщения: фото и присланные документом изображения. */
export function imageCandidates(message: TgMessage): MediaCandidate[] {
  const out: MediaCandidate[] = [];
  const photo = message.photo as TgPhotoSize[] | undefined;
  if (Array.isArray(photo) && photo.length > 0) {
    // Последний элемент массива — самый большой размер.
    const largest = photo[photo.length - 1]!;
    out.push({ file_id: largest.file_id, mime: "image/jpeg" });
  }
  const document = message.document as TgDocument | undefined;
  if (document && /^image\//i.test(document.mime_type ?? "")) {
    out.push({ file_id: document.file_id, mime: document.mime_type ?? "image/jpeg" });
  }
  return out.slice(0, MAX_MEDIA_PER_MESSAGE);
}

/**
 * Скачивает картинки сообщения и возвращает адреса на сайте.
 * Ошибка по одному файлу не отменяет остальные: лучше комментарий без картинки,
 * чем совсем без комментария.
 */
export async function materializeTelegramImages(token: string, message: TgMessage): Promise<string[]> {
  const candidates = imageCandidates(message);
  if (candidates.length === 0) return [];
  const urls: string[] = [];
  for (const candidate of candidates) {
    try {
      const url = await saveOne(token, candidate.file_id, candidate.mime);
      if (url) urls.push(url);
    } catch (error) {
      console.error(`[tg] не удалось сохранить картинку ${candidate.file_id}:`, (error as Error)?.message ?? error);
    }
  }
  return urls;
}

async function saveOne(token: string, fileId: string, mime: string): Promise<string | null> {
  const file = await getFile(token, fileId);
  if (!file.file_path) return null;
  if (file.file_size !== undefined && file.file_size > MAX_FILE_BYTES) return null;
  const res = await fetch(fileUrl(token, file.file_path), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) return null;

  const name = `tg_${Date.now()}_${randomBytes(6).toString("hex")}`;
  mkdirSync("public/uploads", { recursive: true });
  // GIF не разбираем — анимация важнее веса файла.
  if (/^image\/gif$/i.test(mime)) {
    await Bun.write(`public/uploads/${name}.gif`, bytes);
    return `/uploads/${name}.gif`;
  }
  const image = await sharp(bytes, { animated: false })
    .rotate()
    .resize(MAX_WIDTH, null, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  await Bun.write(`public/uploads/${name}.webp`, image);
  return `/uploads/${name}.webp`;
}

/** Картинки, которые комментарий уже приобрёл (используются при правке). */
export function extractStoredImages(html: string): string[] {
  const urls: string[] = [];
  for (const match of String(html ?? "").matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)) {
    const src = match[1];
    if (src && /^\/uploads\/tg_/i.test(src)) urls.push(src);
  }
  return urls.slice(0, MAX_MEDIA_PER_MESSAGE);
}

/**
 * HTML вставки картинок. Разделитель между текстом и картинками добавляет
 * вызывающий код: сообщение может состоять из одних только картинок.
 */
export function imagesHtml(urls: string[]): string {
  return urls.map((url) => `<img src="${url}" alt="" loading="lazy"/>`).join("\n");
}

/**
 * Готовим картинки к прямой заливке боту.
 *
 * Telegram часто не может скачать файл с нашего сайта («failed to get HTTP URL
 * content»), поэтому байты отдаём сами: свои файлы читаем с диска, внешние
 * адреса — качаем и пересылаем. Блоки правим на копии, чтобы при отказе можно
 * было повторить отправку с исходными адресами.
 */
export async function attachBlockImages(blocks: unknown[]): Promise<{ blocks: unknown[]; media: UploadedFile[] }> {
  if (collectPhotoBlocks(blocks).length === 0) return { blocks, media: [] };
  const copy = structuredClone(blocks);
  const targets = collectPhotoBlocks(copy);
  const media: UploadedFile[] = [];
  let totalBytes = 0;
  for (const [index, target] of targets.entries()) {
    // Один запрос к Bot API не должен стать гигабайтным: остальные картинки
    // уйдут адресами, а если Telegram их не возьмёт — сработает откат.
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) break;
    const file = await readImageForUpload(target.url, index);
    if (!file) continue;
    totalBytes += file.bytes.byteLength;
    (target.block.photo as Record<string, unknown>).media = `attach://${file.name}`;
    media.push(file);
  }
  return { blocks: copy, media };
}

/** Фото-блоки с адресом в разметке сообщения (включая вложенные списки и цитаты). */
function collectPhotoBlocks(blocks: unknown[]): Array<{ block: Record<string, unknown>; url: string }> {
  const found: Array<{ block: Record<string, unknown>; url: string }> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "photo") {
      const media = (record.photo as { media?: unknown } | undefined)?.media;
      if (typeof media === "string" && /^https?:\/\//i.test(media)) found.push({ block: record, url: media });
    }
    for (const key of ["blocks", "items", "cells", "buttons"]) walk(record[key]);
  };
  walk(blocks);
  return found;
}

/** Картинка как файл для multipart: свой путь — с диска, чужой — по сети. */
async function readImageForUpload(url: string, index: number): Promise<UploadedFile | null> {
  const name = `tgimage${index + 1}`;
  const local = localImagePath(url);
  if (local) {
    const file = Bun.file(local);
    if (!(await file.exists())) return null;
    if (file.size > MAX_UPLOAD_BYTES) return null;
    return {
      name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: local.slice(local.lastIndexOf("/") + 1),
    };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    if (!/^image\//i.test(res.headers.get("content-type") ?? "")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return null;
    return { name, bytes, filename: remoteFilename(url) };
  } catch {
    return null;
  }
}

/** Адрес своего файла в `public/`; всё остальное считаем внешним. */
function localImagePath(url: string): string | null {
  let path: string;
  if (url.startsWith("/")) {
    path = url;
  } else {
    try {
      const parsed = new URL(url);
      const base = new URL(config.baseUrl);
      if (parsed.origin !== base.origin) return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  if (!/^\/(uploads|images|img)\//.test(path) || path.includes("..")) return null;
  return `public${path}`;
}

function remoteFilename(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return /\.(png|jpe?g|gif|webp|avif)$/i.test(name) ? name : "image.jpg";
  } catch {
    return "image.jpg";
  }
}
