import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { config } from "../core/config";
import { getDrizzle } from "../core/db";
import {
  messageGroupMembers,
  messageGroupMessages,
  messageImages,
  privateMessages,
} from "../core/schema";

export const MAX_MESSAGE_IMAGES = 10;
export const MAX_MESSAGE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_MESSAGE_IMAGES_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const THUMBNAIL_EDGE = 640;

const imageFormats = {
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  png: { mimeType: "image/png", extension: "png" },
  webp: { mimeType: "image/webp", extension: "webp" },
  gif: { mimeType: "image/gif", extension: "gif" },
} as const;

type SupportedMimeType = typeof imageFormats[keyof typeof imageFormats]["mimeType"];

export class MessageImageError extends Error {
  constructor(public readonly status: 400 | 413 | 415, message: string) {
    super(message);
  }
}

export type PreparedMessageImage = {
  storageKey: string;
  thumbnailKey: string;
  width: number;
  height: number;
  mimeType: SupportedMimeType;
  sizeBytes: number;
};

export type ApiMessageImage = {
  id: number;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
};

type MessageImageRow = typeof messageImages.$inferSelect;

export function apiMessageImage(row: MessageImageRow): ApiMessageImage {
  return {
    id: row.id,
    url: `/api/messages/media/${row.id}`,
    thumbnailUrl: `/api/messages/media/${row.id}?size=thumb`,
    width: row.width,
    height: row.height,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
  };
}

export async function prepareMessageImages(files: File[]): Promise<PreparedMessageImage[]> {
  if (files.length < 1 || files.length > MAX_MESSAGE_IMAGES) {
    throw new MessageImageError(400, `Прикрепите от 1 до ${MAX_MESSAGE_IMAGES} изображений.`);
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (files.some((file) => file.size < 1 || file.size > MAX_MESSAGE_IMAGE_BYTES)) {
    throw new MessageImageError(413, "Размер одного изображения не должен превышать 20 МиБ.");
  }
  if (totalBytes > MAX_MESSAGE_IMAGES_TOTAL_BYTES) {
    throw new MessageImageError(413, "Общий размер изображений не должен превышать 50 МиБ.");
  }

  mkdirSync(config.messageMediaRoot, { recursive: true });
  const prepared: PreparedMessageImage[] = [];
  try {
    for (const file of files) prepared.push(await prepareOne(file));
    return prepared;
  } catch (error) {
    cleanupMessageImages(prepared);
    if (error instanceof MessageImageError) throw error;
    throw new MessageImageError(415, "Файл не является поддерживаемым изображением.");
  }
}

async function prepareOne(file: File): Promise<PreparedMessageImage> {
  const declaredMimeType = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type.toLowerCase();
  if (!Object.values(imageFormats).some((format) => format.mimeType === declaredMimeType)) {
    throw new MessageImageError(415, "Поддерживаются только JPEG, PNG, WebP и GIF.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MESSAGE_IMAGE_BYTES) {
    throw new MessageImageError(413, "Размер одного изображения не должен превышать 20 МиБ.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { animated: false, limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new MessageImageError(415, "Не удалось прочитать изображение.");
  }
  const format = metadata.format && imageFormats[metadata.format as keyof typeof imageFormats];
  if (!format || format.mimeType !== declaredMimeType) {
    throw new MessageImageError(415, "Тип файла не соответствует содержимому изображения.");
  }
  if (!metadata.width || !metadata.height) {
    throw new MessageImageError(415, "У изображения отсутствуют корректные размеры.");
  }
  const rotated = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new MessageImageError(413, "Разрешение изображения слишком велико.");
  }

  const key = randomBytes(24).toString("hex");
  const storageKey = `${key}.${format.extension}`;
  const thumbnailKey = `${key}.thumb.webp`;
  const originalPath = mediaPath(storageKey);
  const thumbnailPath = mediaPath(thumbnailKey);
  try {
    const thumbnail = await sharp(bytes, { animated: false, limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    await Bun.write(originalPath, bytes);
    await Bun.write(thumbnailPath, thumbnail);
  } catch {
    rmSync(originalPath, { force: true });
    rmSync(thumbnailPath, { force: true });
    throw new MessageImageError(415, "Не удалось обработать изображение.");
  }
  return {
    storageKey,
    thumbnailKey,
    width,
    height,
    mimeType: format.mimeType,
    sizeBytes: bytes.byteLength,
  };
}

export function cleanupMessageImages(
  images: Array<Pick<PreparedMessageImage, "storageKey" | "thumbnailKey">>,
): void {
  for (const image of images) {
    try {
      rmSync(mediaPath(image.storageKey), { force: true });
      rmSync(mediaPath(image.thumbnailKey), { force: true });
    } catch {
      // Ошибка очистки не должна скрывать исходную ошибку запроса.
    }
  }
}

export async function privateMessageImagesById(messageIds: number[]): Promise<Map<number, ApiMessageImage[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await getDrizzle()
    .select()
    .from(messageImages)
    .where(inArray(messageImages.privateMessageId, messageIds))
    .orderBy(messageImages.privateMessageId, asc(messageImages.position));
  return groupImages(rows, "privateMessageId");
}

export async function groupMessageImagesById(messageIds: number[]): Promise<Map<number, ApiMessageImage[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await getDrizzle()
    .select()
    .from(messageImages)
    .where(inArray(messageImages.groupMessageId, messageIds))
    .orderBy(messageImages.groupMessageId, asc(messageImages.position));
  return groupImages(rows, "groupMessageId");
}

function groupImages(
  rows: MessageImageRow[],
  owner: "privateMessageId" | "groupMessageId",
): Map<number, ApiMessageImage[]> {
  const result = new Map<number, ApiMessageImage[]>();
  for (const row of rows) {
    const messageId = row[owner];
    if (messageId === null) continue;
    const images = result.get(messageId) ?? [];
    images.push(apiMessageImage(row));
    result.set(messageId, images);
  }
  return result;
}

export async function openMessageImage(
  imageId: number,
  userId: number,
  thumbnail: boolean,
): Promise<{ file: ReturnType<typeof Bun.file>; mimeType: string } | null> {
  const image = await getDrizzle().select().from(messageImages).where(eq(messageImages.id, imageId)).get();
  if (!image) return null;

  const allowed = image.privateMessageId !== null
    ? await getDrizzle()
      .select({ id: privateMessages.id })
      .from(privateMessages)
      .where(and(
        eq(privateMessages.id, image.privateMessageId),
        or(eq(privateMessages.senderId, userId), eq(privateMessages.recipientId, userId)),
      ))
      .get()
    : await getDrizzle()
      .select({ id: messageGroupMessages.id })
      .from(messageGroupMessages)
      .innerJoin(messageGroupMembers, eq(messageGroupMembers.groupId, messageGroupMessages.groupId))
      .where(and(
        eq(messageGroupMessages.id, image.groupMessageId!),
        eq(messageGroupMembers.userId, userId),
      ))
      .get();
  if (!allowed) return null;

  const file = Bun.file(mediaPath(thumbnail ? image.thumbnailKey : image.storageKey));
  if (!await file.exists()) return null;
  return { file, mimeType: thumbnail ? "image/webp" : image.mimeType };
}

function mediaPath(key: string): string {
  if (!/^[a-f0-9]{48}(?:\.thumb)?\.(?:jpg|png|webp|gif)$/.test(key)) {
    throw new Error("Некорректный ключ изображения сообщения");
  }
  return join(config.messageMediaRoot, key);
}
