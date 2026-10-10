import { parse, type Node as HtmlNode, type HTMLElement as HtmlElement, type TextNode } from "node-html-parser";
import { blocks, type RichBlockNode, type StructuredRichInline, type StructuredRichBlockInput } from "@gramio/format/rich";
import type { TgMessage, TgMessageEntity } from "./client";
import { config } from "../core/config";

/**
 * Двустороннее преобразование форматирования между сайтом и Telegram.
 *
 * Исходящее направление: HTML топика/комментария (пропущенный через sanitizeHtml)
 * превращается в структурные блоки «богатого» сообщения (`InputRichBlock[]`).
 * Telegram разбирает их локально, поэтому невалидная разметка не роняет отправку.
 *
 * Входящее направление: `message.rich_message.blocks` либо `text` + `entities`
 * превращаются в HTML, который так же понимает сайт.
 */

/* ── Лимиты «богатого» сообщения ── */

const MAX_BLOCKS = 60;
const MAX_MEDIA = 10;
const MAX_TABLE_ROWS = 20;
const MAX_TABLE_CELLS = 8;
const MAX_BLOCK_TEXT = 3500;

type ResolveUrl = (src: string) => string;

const identityUrl: ResolveUrl = (src) => src;

/** Контекст одного преобразования: абсолютные адреса и бюджет вложений. */
type Ctx = { resolveUrl: ResolveUrl; mediaLeft: number };

/* ── Обход HTML ── */

/** Теги, которые не должны попасть в текст ни при каком исходе. */
const SKIP_TAGS = new Set(["script", "style"]);

const INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "code",
  "a",
  "span",
  "font",
  "cite",
  "cut",
  "mark",
  "sub",
  "sup",
  "small",
  "br",
]);

/**
 * Текстовое содержимость узла с раскрытием сущностей. В node-html-parser
 * `element.text` отдаёт сырой внутренний HTML, поэтому собираем текст сами.
 */
function nodeText(node: HtmlNode): string {
  if (node.nodeType === 3) return (node as TextNode).text;
  if (node.nodeType !== 1) return "";
  const el = node as HtmlElement;
  const tag = el.rawTagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  return el.childNodes.map(nodeText).join("");
}

function isElement(node: HtmlNode): node is HtmlElement {
  return node.nodeType === 1;
}

function tagOf(node: HtmlNode): string {
  return isElement(node) ? node.rawTagName.toLowerCase() : "";
}

function clip(text: string): string {
  const clean = text.replace(/\r/g, "").trim();
  return clean.length > MAX_BLOCK_TEXT ? `${clean.slice(0, MAX_BLOCK_TEXT)}…` : clean;
}

/* ── HTML → структурные блоки ── */

function pushText(runs: StructuredRichInline[], text: string): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (typeof last === "string") runs[runs.length - 1] = last + text;
  else runs.push(text);
}

function inlineRuns(nodes: HtmlNode[], ctx: Ctx): StructuredRichInline[] {
  const runs: StructuredRichInline[] = [];
  for (const node of nodes) collectInline(node, runs, ctx);
  return runs;
}

function collectInline(node: HtmlNode, runs: StructuredRichInline[], ctx: Ctx): void {
  if (!isElement(node)) {
    if (node.nodeType === 3) pushText(runs, (node as TextNode).text);
    return;
  }
  const el = node;
  switch (el.rawTagName.toLowerCase()) {
    case "br":
      runs.push("\n");
      return;
    case "b":
    case "strong":
      runs.push(blocks.bold(inlineChildren(el, ctx)));
      return;
    case "i":
    case "em":
      runs.push(blocks.italic(inlineChildren(el, ctx)));
      return;
    case "u":
      runs.push(blocks.underline(inlineChildren(el, ctx)));
      return;
    case "s":
    case "strike":
    case "del":
      runs.push(blocks.strikethrough(inlineChildren(el, ctx)));
      return;
    case "code":
      runs.push(blocks.code(clip(nodeText(el))));
      return;
    case "a": {
      const href = (el.attributes.href ?? "").trim();
      const label = inlineChildren(el, ctx);
      if (href && /^https?:\/\/|^tg:/i.test(href)) runs.push(blocks.url(label || href, href));
      else if (typeof label === "string") pushText(runs, label);
      else runs.push(label);
      return;
    }
    case "img": {
      const src = ctx.resolveUrl((el.attributes.src ?? "").trim());
      const alt = (el.attributes.alt ?? "").trim();
      if (/^https?:\/\//i.test(src)) runs.push(blocks.url(alt || "картинка", src));
      else if (alt) pushText(runs, alt);
      return;
    }
    case "span":
    case "font":
    case "cite":
    case "cut":
    case "mark":
    case "sub":
    case "sup":
    case "small":
      for (const child of el.childNodes) collectInline(child, runs, ctx);
      return;
    default:
      if (SKIP_TAGS.has(el.rawTagName.toLowerCase())) return;
      pushText(runs, nodeText(el));
  }
}

function inlineChildren(el: HtmlElement, ctx: Ctx): StructuredRichInline {
  const runs = inlineRuns(el.childNodes, ctx);
  if (runs.length === 0) return "";
  if (runs.length === 1 && typeof runs[0] === "string") return runs[0]!;
  return runs.filter((run) => run !== "");
}

/** Абзацы: переводы строк внутри превращаем в отдельные блоки. */
function paragraphs(runs: StructuredRichInline[]): RichBlockNode[] {
  const out: RichBlockNode[] = [];
  let current: StructuredRichInline[] = [];
  const flush = () => {
    if (current.length) out.push(blocks.paragraph(current));
    current = [];
  };
  for (const run of runs) {
    if (typeof run === "string" && run.includes("\n")) {
      const parts = run.split("\n");
      pushText(current, parts[0]!);
      flush();
      for (let i = 1; i < parts.length - 1; i++) {
        if (parts[i]!.trim()) out.push(blocks.paragraph([parts[i]!]));
      }
      pushText(current, parts[parts.length - 1]!);
      continue;
    }
    current.push(run);
  }
  flush();
  return out;
}

function textBlocks(text: string): RichBlockNode[] {
  if (!text.trim()) return [];
  return paragraphs([text]);
}

/** Фото-блок из `<img>`; при нехватке бюджета или непубичном адресе — ничего. */
function photoBlock(el: HtmlElement, ctx: Ctx): RichBlockNode[] {
  const src = ctx.resolveUrl((el.attributes.src ?? "").trim());
  if (!/^https?:\/\//i.test(src) || ctx.mediaLeft <= 0) return [];
  ctx.mediaLeft -= 1;
  return [blocks.photo(src)];
}

/**
 * Текст и картинки вперемешку: фото не живёт внутри абзаца, поэтому накопленный
 * текст закрывается, а изображение становится отдельным блоком.
 */
function flowsFromNodes(nodes: HtmlNode[], ctx: Ctx): RichBlockNode[] {
  const out: RichBlockNode[] = [];
  let runs: StructuredRichInline[] = [];
  const flush = () => {
    for (const block of paragraphs(runs)) out.push(block);
    runs = [];
  };
  for (const node of nodes) {
    if (isElement(node) && node.rawTagName.toLowerCase() === "img") {
      flush();
      out.push(...photoBlock(node, ctx));
      continue;
    }
    collectInline(node, runs, ctx);
  }
  flush();
  return out;
}

/** Содержимое элемента списка: сначала строка, затем вложенные блоки. */
function listItemBlocks(el: HtmlElement, ctx: Ctx): StructuredRichBlockInput[] {
  const runs: StructuredRichInline[] = [];
  const nestedNodes: HtmlNode[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      collectInline(child, runs, ctx);
      continue;
    }
    if (!isElement(child)) continue;
    if (INLINE_TAGS.has(child.rawTagName.toLowerCase())) collectInline(child, runs, ctx);
    else nestedNodes.push(child);
  }
  const out: StructuredRichBlockInput[] = [];
  if (runs.length) out.push(blocks.paragraph(runs));
  out.push(...blocksFrom(nestedNodes, ctx));
  if (out.length === 0) out.push(blocks.paragraph([clip(nodeText(el))]));
  return out;
}

function listBlocks(el: HtmlElement, ordered: boolean, ctx: Ctx): RichBlockNode[] {
  const items: StructuredRichBlockInput[][] = [];
  for (const child of el.childNodes) {
    if (!isElement(child) || child.rawTagName.toLowerCase() !== "li") continue;
    items.push(listItemBlocks(child, ctx));
  }
  if (items.length === 0) return [];
  return [ordered ? blocks.orderedList(items) : blocks.list(items)];
}

function tableBlocks(el: HtmlElement, ctx: Ctx): RichBlockNode[] {
  const rows: StructuredRichInline[][] = [];
  const collectRow = (tr: HtmlElement) => {
    const cells = tr.childNodes.filter((n) => isElement(n) && n.rawTagName.toLowerCase() !== "br") as HtmlElement[];
    if (cells.length === 0) return;
    rows.push(cells.slice(0, MAX_TABLE_CELLS).map((cell) => clip(cellText(cell, ctx))));
  };
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    const tag = child.rawTagName.toLowerCase();
    if (tag === "tr") collectRow(child);
    else if (tag === "thead" || tag === "tbody") {
      for (const row of child.childNodes) {
        if (isElement(row) && row.rawTagName.toLowerCase() === "tr") collectRow(row);
      }
    }
    if (rows.length >= MAX_TABLE_ROWS) break;
  }
  if (rows.length === 0) return [];
  return [blocks.table(rows, { bordered: true, compact: true })];
}

/** Ячейка таблицы: только строчное содержимое. */
function cellText(el: HtmlElement, ctx: Ctx): string {
  return inlineRuns(el.childNodes, ctx).map((run) => (typeof run === "string" ? run : plainOf(run))).join("");
}

function plainOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainOf).join("");
  if (value && typeof value === "object") {
    const node = value as { text?: unknown };
    if (node.text !== undefined) return plainOf(node.text);
  }
  return "";
}

/** Строчный узел: текст или тег из INLINE_TAGS. */
function isInlineNode(node: HtmlNode): boolean {
  if (node.nodeType === 3) return true;
  if (!isElement(node)) return false;
  return INLINE_TAGS.has(node.rawTagName.toLowerCase());
}

/**
 * Блочная сборка: подряд идущие строчные узлы (и текст между блоками) сначала
 * копятся, а затем превращаются в абзацы — иначе «текст <b>жирный</b> текст»
 * рассыпался бы на три отдельных сообщения-абзаца.
 */
function blocksFrom(nodes: HtmlNode[], ctx: Ctx): RichBlockNode[] {
  const out: RichBlockNode[] = [];
  let pending: HtmlNode[] = [];
  const add = (block: RichBlockNode) => {
    if (out.length < MAX_BLOCKS) out.push(block);
  };
  const flush = () => {
    if (pending.length === 0) return;
    for (const block of paragraphs(inlineRuns(pending, ctx))) add(block);
    pending = [];
  };

  for (const node of nodes) {
    if (isInlineNode(node)) {
      pending.push(node);
      continue;
    }
    flush();
    for (const block of blockFromNode(node, ctx)) add(block);
  }
  flush();
  return out;
}

function blockFromNode(node: HtmlNode, ctx: Ctx): RichBlockNode[] {
  if (!isElement(node)) {
    if (node.nodeType === 3) return textBlocks((node as TextNode).text);
    return [];
  }
  const el = node;
  const tag = el.rawTagName.toLowerCase();
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
    // Уровни Telegram: 1 — самый крупный, 6 — самый мелкий.
    return [blocks.heading(Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, inlineChildren(el, ctx))];
  }
  switch (tag) {
    case "p":
    case "div":
      return flowsFromNodes(el.childNodes, ctx);
    case "pre":
      return [preBlock(el)];
    case "blockquote":
      return [blocks.blockquote(blocksFrom(el.childNodes, ctx))];
    case "ul":
      return listBlocks(el, false, ctx);
    case "ol":
      return listBlocks(el, true, ctx);
    case "table":
      return tableBlocks(el, ctx);
    case "hr":
      return [blocks.divider()];
    case "details": {
      const summary = el.childNodes.find((n: HtmlNode) => isElement(n) && n.rawTagName.toLowerCase() === "summary");
      return [
        blocks.details(
          summary ? clip(nodeText(summary)) : "Подробнее",
          blocksFrom(el.childNodes.filter((n) => n !== summary), ctx),
          { open: true },
        ),
      ];
    }
    case "img":
      return photoBlock(el, ctx);
    case "br":
      return [];
    default:
      // Строчные теги на верхнем уровне (от редактора) становятся абзацем.
      return paragraphs(inlineRuns([el], ctx));
  }
}

/** `pre`/`code` из редактора: язык берём из class="language-…". */
function preBlock(el: HtmlElement): RichBlockNode {
  // node-html-parser отдаёт содержимое <pre> одним текстовым узлом, а вложенный
  // <code> внутри него — как обычный текст, поэтому разбираем разметку руками.
  const raw = nodeText(el);
  const codeOpen = /<code\b[^>]*>/i.exec(raw)?.[0] ?? "";
  const languageMatch = /language-([a-z0-9+#-]{1,20})/i.exec(codeOpen);
  const inner = raw.replace(/^\s*<code\b[^>]*>/i, "").replace(/<\/code>\s*$/i, "").trim();
  const code = inner || raw.trim();
  return languageMatch ? blocks.pre(clip(code), languageMatch[1]!) : blocks.pre(clip(code));
}

/**
 * HTML сайта → блоки «богатого» сообщения Telegram.
 * Относительные адреса изображений превращаются в абсолютные: Telegram
 * скачивает медиа сам, локальный путь ему недоступен.
 */
export function htmlToRichBlocks(html: string, resolveUrl: ResolveUrl = identityUrl): RichBlockNode[] {
  const source = String(html ?? "").trim();
  if (!source) return [];
  const ctx: Ctx = { resolveUrl, mediaLeft: MAX_MEDIA };
  // parse() всегда возвращает синтетический корень: его дети — узлы источника.
  const root = parse(source);
  let blockList = blocksFrom(root.childNodes, ctx);
  if (blockList.length === 0) blockList = textBlocks(plainText(source));
  if (blockList.length === 0) blockList = [blocks.paragraph([plainText(source).slice(0, 200) || "…"])];
  return blockList.slice(0, MAX_BLOCKS);
}

/** Простой текст из HTML — когда блочная разметка не собирается. */
export function plainText(html: string): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|pre|blockquote|details)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── Структурные блоки → простой текст (запасной вариант отправки) ── */

function blockToPlain(block: unknown): string {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;
  switch (b.type) {
    case "list":
    case "orderedList":
      return ((b.items as unknown[]) ?? [])
        .map((item, i) => `${b.type === "list" ? "•" : `${i + 1}.`} ${blockToPlain(item)}`)
        .join("\n");
    case "table":
      return ((b.cells as unknown[][]) ?? [])
        .map((row) => (Array.isArray(row) ? row.map((cell) => plainOf((cell as { text?: unknown })?.text ?? cell)).join(" | ") : "").trim())
        .filter(Boolean)
        .join("\n");
    case "blockquote":
    case "expandable_blockquote":
    case "pullquote":
      return plainOf(b.text) || ((b.blocks as unknown[]) ?? []).map(blockToPlain).join("\n");
    case "details":
      return `${plainOf(b.summary)}\n${((b.blocks as unknown[]) ?? []).map(blockToPlain).join("\n")}`.trim();
    case "divider":
      return "———";
    case "photo":
    case "video":
    case "animation":
    case "document":
    case "audio":
    case "voice_note":
      return "[вложение]";
    case "buttons":
      return ((b.buttons as unknown[]) ?? [])
        .map((button) => plainOf((button as { text?: unknown })?.text ?? ""))
        .filter(Boolean)
        .join(" · ");
    default:
      return plainOf(b.text) || ((b.blocks as unknown[]) ?? []).map(blockToPlain).join("\n");
  }
}

export function richBlocksToPlainText(blockList: unknown[]): string {
  const parts = blockList.map(blockToPlain).map((text) => text.trim()).filter(Boolean);
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").slice(0, 4000);
}

/** Блоки в том виде, в каком их принимает Bot API. */
export function toInputRichBlocks(blockList: RichBlockNode[]): unknown[] {
  return blockList.map((block) => block.toInputRichBlock());
}

/**
 * Фото-блоки из готовых абсолютных адресов — для анонса темы, где картинки
 * собраны заранее. Форма блока строго такая, как её ждёт Bot API:
 * `{type:"photo", photo:{type:"photo", media:<адрес>}}` — иначе Telegram
 * отвечает `can't parse InputRichBlock: Can't find field "photo"`.
 */
export function photoBlocks(urls: string[]): unknown[] {
  return urls.slice(0, MAX_MEDIA).map((url) => blocks.photo(url).toInputRichBlock());
}

/* ── Входящие сообщения Telegram → HTML сайта ── */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Текст сообщения + entities → HTML. Telegram отдаёт невложенные (но возможно
 * перекрывающиеся) диапазоны, поэтому теги закрываем через стек: разметка
 * остаётся сбалансированной, что важно перед санитайзингом сайта.
 */
export function entitiesToHtml(text: string, entities: TgMessageEntity[]): string {
  const clean = String(text ?? "");
  const valid = (entities ?? [])
    .filter((e) => e.offset >= 0 && e.length > 0 && e.offset + e.length <= clean.length)
    .sort((a, b) => a.offset - b.offset || b.length - a.length);
  if (valid.length === 0) return escapeHtml(clean);

  const opens = new Map<number, TgMessageEntity[]>();
  const closes = new Map<number, TgMessageEntity[]>();
  for (const entity of valid) {
    push(opens, entity.offset, entity);
    push(closes, entity.offset + entity.length, entity);
  }

  let out = "";
  let cursor = 0;
  const stack: { entity: TgMessageEntity; tag: { open: string; close: string } }[] = [];
  const positions = [...new Set([...opens.keys(), ...closes.keys()])].sort((a, b) => a - b);
  for (const pos of positions) {
    if (cursor < pos) out += escapeHtml(clean.slice(cursor, pos));
    cursor = pos;
    for (const entity of closes.get(pos) ?? []) {
      const index = stack.findIndex((entry) => entry.entity === entity);
      if (index < 0) continue;
      // Сначала закрываем вложенные, затем сам диапазон — иначе теги перекроются.
      for (let i = stack.length - 1; i > index; i--) out += stack[i]!.tag.close;
      out += stack[index]!.tag.close;
      stack.length = index;
    }
    for (const entity of opens.get(pos) ?? []) {
      const tag = entityTag(entity, clean.slice(entity.offset, entity.offset + entity.length));
      if (!tag) continue;
      out += tag.open;
      stack.push({ entity, tag });
    }
  }
  if (cursor < clean.length) out += escapeHtml(clean.slice(cursor));
  return out;
}

function push(map: Map<number, TgMessageEntity[]>, key: number, entity: TgMessageEntity): void {
  const list = map.get(key);
  if (list) list.push(entity);
  else map.set(key, [entity]);
}

function entityTag(entity: TgMessageEntity, slice: string): { open: string; close: string } | null {
  switch (entity.type) {
    case "bold":
      return { open: "<b>", close: "</b>" };
    case "italic":
      return { open: "<i>", close: "</i>" };
    case "underline":
      return { open: "<u>", close: "</u>" };
    case "strikethrough":
      return { open: "<s>", close: "</s>" };
    case "spoiler":
      return { open: '<span class="tg-spoiler">', close: "</span>" };
    case "code":
      return { open: "<code>", close: "</code>" };
    case "pre": {
      const lang = /^[a-z0-9+#-]{1,20}$/i.test(entity.language ?? "") ? entity.language! : "";
      return { open: `<pre><code${lang ? ` class="language-${lang}"` : ""}>`, close: "</code></pre>" };
    }
    case "blockquote":
    case "expandable_blockquote":
      return { open: "<blockquote>", close: "</blockquote>" };
    case "text_link":
      return entity.url ? { open: `<a href="${escapeAttr(entity.url)}">`, close: "</a>" } : null;
    case "url":
      return { open: `<a href="${escapeAttr(slice)}">`, close: "</a>" };
    case "mention":
      return { open: `<a href="https://t.me/${slice.replace(/^@/, "")}">`, close: "</a>" };
    case "text_mention":
      return entity.user ? { open: `<a href="tg://user?id=${entity.user.id}">`, close: "</a>" } : null;
    case "email":
      return { open: `<a href="mailto:${escapeAttr(slice)}">`, close: "</a>" };
    case "phone":
      return { open: `<a href="tel:${slice.replace(/[^\d+]/g, "")}">`, close: "</a>" };
    default:
      // hashtag, cashtag, bot_command, date_time и прочее остаются обычным текстом.
      return null;
  }
}

function headingLevel(size: unknown): "h3" | "h4" | "h5" | "h6" {
  const level = Number(size);
  if (!Number.isFinite(level) || level <= 2) return "h3";
  if (level >= 6) return "h6";
  return `h${level}` as "h4" | "h5";
}

function richTextToHtml(value: unknown): string {
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(richTextToHtml).join("");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  const inner = richTextToHtml(node.text);
  switch (node.type) {
    case "bold":
      return `<b>${inner}</b>`;
    case "italic":
      return `<i>${inner}</i>`;
    case "underline":
      return `<u>${inner}</u>`;
    case "strikethrough":
      return `<s>${inner}</s>`;
    case "spoiler":
      return `<span class="tg-spoiler">${inner}</span>`;
    case "code":
      return `<code>${inner}</code>`;
    case "url":
      return `<a href="${escapeAttr(String(node.url ?? ""))}">${inner}</a>`;
    case "email":
      return `<a href="mailto:${escapeAttr(String(node.email_address ?? ""))}">${inner}</a>`;
    case "phone_number":
      return `<a href="tel:${escapeAttr(String(node.phone_number ?? ""))}">${inner}</a>`;
    case "mention": {
      const username = String(node.username ?? "").replace(/^@/, "");
      return username ? `<a href="https://t.me/${username}">${inner}</a>` : inner;
    }
    default:
      return inner;
  }
}

function blocksToHtml(blockList: unknown[]): string {
  const parts: string[] = [];
  for (const block of blockList) {
    const html = blockToHtml(block);
    if (html) parts.push(html);
  }
  return parts.join("\n");
}

function blockToHtml(block: unknown): string {
  if (typeof block === "string") return `<p>${escapeHtml(block)}</p>`;
  if (typeof block === "number") return String(block);
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;
  switch (b.type) {
    case "paragraph":
      return `<p>${richTextToHtml(b.text)}</p>`;
    case "heading":
      return `<${headingLevel(b.size)}>${richTextToHtml(b.text)}</${headingLevel(b.size)}>`;
    case "pre": {
      const lang = /^[a-z0-9+#-]{1,20}$/i.test(String(b.language ?? "")) ? String(b.language) : "";
      return `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(plainOf(b.text))}</code></pre>`;
    }
    case "list":
      return `<ul>${((b.items as unknown[]) ?? []).map((item) => `<li>${listItemToHtml(item)}</li>`).join("")}</ul>`;
    case "orderedList":
      return `<ol>${((b.items as unknown[]) ?? []).map((item) => `<li>${listItemToHtml(item)}</li>`).join("")}</ol>`;
    case "blockquote":
    case "expandable_blockquote":
    case "pullquote": {
      const body = b.blocks ? blocksToHtml(b.blocks as unknown[]) : richTextToHtml(b.text);
      const credit = b.credit ? `<cite>${richTextToHtml(b.credit)}</cite>` : "";
      return `<blockquote>${body}${credit}</blockquote>`;
    }
    case "details": {
      const open = b.open === false ? "" : " open";
      return `<details${open}><summary>${richTextToHtml(b.summary)}</summary>${blocksToHtml((b.blocks as unknown[]) ?? [])}</details>`;
    }
    case "table":
      return tableToHtml(b);
    case "divider":
      return "<hr/>";
    case "footer":
      return `<p class="dark">${richTextToHtml(b.text)}</p>`;
    case "mathematical_expression":
      return `<code>${escapeHtml(plainOf(b.text))}</code>`;
    case "photo":
    case "video":
    case "animation":
    case "document":
    case "audio":
    case "voice_note":
      return `<p>«вложение: ${mediaLabel(String(b.type))}»</p>`;
    case "map":
      return "<p>«место на карте»</p>";
    default:
      return b.blocks ? blocksToHtml(b.blocks as unknown[]) : richTextToHtml(b.text);
  }
}

function mediaLabel(type: string): string {
  switch (type) {
    case "photo":
      return "фото";
    case "video":
      return "видео";
    case "animation":
      return "гифка";
    case "audio":
      return "аудио";
    case "document":
      return "файл";
    case "voice_note":
      return "голосовое";
    default:
      return "вложение";
  }
}

function listItemToHtml(item: unknown): string {
  if (item && typeof item === "object" && Array.isArray((item as { blocks?: unknown }).blocks)) {
    // Элемент списка в HTML не должен содержать блочные теги.
    return blocksToHtml((item as { blocks: unknown[] }).blocks).replace(/<\/?p>/g, "").trim();
  }
  if (typeof item === "string") return escapeHtml(item);
  return richTextToHtml(item);
}

function tableToHtml(b: Record<string, unknown>): string {
  const rows = Array.isArray(b.cells) ? (b.cells as unknown[][]) : [];
  if (rows.length === 0) return "";
  const body = rows
    .map((row) => {
      const cells = Array.isArray(row) ? row : [];
      const html = cells
        .map((cell) => {
          const value = cell && typeof cell === "object" ? (cell as Record<string, unknown>) : {};
          const tag = value.is_header === true ? "th" : "td";
          return `<${tag}>${richTextToHtml(value.text ?? cell)}</${tag}>`;
        })
        .join("");
      return `<tr>${html}</tr>`;
    })
    .join("");
  return `<table>${body}</table>`;
}

/** Содержимое входящего сообщения (богатое, текст или подпись) → HTML. */
export function telegramMessageToHtml(message: TgMessage): string {
  const rich = message.rich_message as { blocks?: unknown } | undefined;
  if (rich && Array.isArray(rich.blocks) && rich.blocks.length > 0) {
    const html = blocksToHtml(rich.blocks as unknown[]);
    if (html.trim()) return html;
  }
  const text = message.text ?? message.caption ?? "";
  if (!text.trim()) return "";
  const entities = (message.text ? message.entities : message.caption_entities) ?? [];
  return entitiesToHtml(text, entities);
}

/** Относительный адрес сайта → абсолютный: Telegram скачивает медиа сам. */
export function siteUrlResolver(): ResolveUrl {
  const base = config.baseUrl.replace(/\/+$/, "");
  return (src: string) => (/^https?:\/\//i.test(src) ? src : `${base}${src.startsWith("/") ? "" : "/"}${src}`);
}

export type { RichBlockNode };
