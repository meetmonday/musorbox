const translitMap: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function slugify(text: string): string {
  let result = text.toLowerCase().trim();
  result = result.replace(/[а-яё]/g, (ch) => translitMap[ch] ?? ch);
  result = result
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || "topic";
}

const monthsGenitive = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export function formatDate(date: Date): string {
  const d = date.getDate();
  const m = monthsGenitive[date.getMonth()];
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${d} ${m} ${y} - ${hh}:${mm}`;
}

export function formatDateDots(date: Date): string {
  const d = date.getDate();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${d}.${m}.${y} — ${hh}:${mm}`;
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function replyCountText(n: number): string {
  if (n === 0) return "пока нет ответов";
  return `${n} ${pluralize(n, "ответ", "ответа", "ответов")}`;
}

export function voteBarWidths(up: number, down: number, total: number = 120): { upPx: number; downPx: number } {
  const sum = up + down;
  if (sum === 0) return { upPx: 0, downPx: total };
  return {
    upPx: Math.round((up / sum) * total),
    downPx: total - Math.round((up / sum) * total),
  };
}

export function excerpt(html: string, maxLength: number = 300): string {
  const text = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "…";
}

const allowedBodyTags = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "div",
  "table",
  "tbody",
  "thead",
  "tr",
  "td",
  "th",
  "cut",
  "span",
  "cite",
  "font",
]);

const allowedBodyAttrs = new Set([
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "hspace",
  "vspace",
  "align",
  "target",
  "rel",
  "class",
  "tvideotype",
  "tvideoid",
  "style",
]);

const unsafeUrl = /^\s*(javascript|vbscript):/i;
const unsafeStyle = /url\s*\(|expression|javascript|@import/i;

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function sanitizeHtml(input: string): string {
  let html = String(input ?? "");
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<\?[\s\S]*?\?>/g, "");
  html = html.replace(/<![a-z][^>]*>/gi, "");

  html = html.replace(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?(\/?)>/g, (match, nameRaw, attrsRaw, selfClose) => {
    const name = nameRaw.toLowerCase();
    if (!allowedBodyTags.has(name)) return "";
    const close = selfClose ? " /" : "";
    if (!attrsRaw) return `<${name}${close}>`;
    const attrs: string[] = [];
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrsRaw)) !== null) {
      const attrName = (m[1] ?? "").toLowerCase();
      if (attrName.startsWith("on")) continue;
      const rawValue = m[2] ? (m[3] ?? "").replace(/^["']|["']$/g, "") : "";
      if (!allowedBodyAttrs.has(attrName)) continue;
      let value = rawValue.trim();
      if (attrName === "style") {
        if (unsafeStyle.test(value)) continue;
        if (value) attrs.push(`style="${escapeAttrValue(value)}"`);
        continue;
      }
      if (attrName === "href" || attrName === "src") {
        if (unsafeUrl.test(value)) continue;
        if (/^\s*data:/i.test(value) && !/^\s*data:image\/(png|jpe?g|gif|webp)/i.test(value)) continue;
      }
      if (!value) {
        if (attrName === "align") continue;
        attrs.push(attrName);
        continue;
      }
      attrs.push(`${attrName}="${escapeAttrValue(value)}"`);
    }
    if (!attrs.length) return `<${name}${close}>`;
    return `<${name} ${attrs.join(" ")}${close}>`;
  });

  html = html.replace(/<(script|style|iframe|object|embed|form|input|textarea)[^>]*>[\s\S]*?<\/\1>/gi, "");
  return html;
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function htmlExcerpt(html: string, maxLength: number): string {
  const safe = sanitizeHtml(html);
  const blockTags = new Set(["div", "p", "blockquote", "center", "td", "tr", "table", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const voidTags = new Set(["img", "br", "hr"]);
  const chunks: string[] = [];
  const stack: { name: string; textBefore: number; chunkIndex: number }[] = [];
  let textLen = 0;
  let truncated = false;
  for (const token of safe.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token[0] === "<") {
      const m = /^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i.exec(token);
      if (!m) continue;
      const closing = !!m[1];
      const name = (m[2] ?? "").toLowerCase();
      if (closing) {
        const idx = stack.findLastIndex((e) => e.name === name);
        if (idx >= 0) {
          const entry = stack[idx]!;
          const isEmpty = textLen === entry.textBefore;
          stack.splice(idx);
          if (!isEmpty) chunks.push(token);
          else chunks[entry.chunkIndex] = "";
        } else {
          chunks.push(token);
        }
      } else if (voidTags.has(name)) {
        if (name === "br" || name === "hr") chunks.push(token);
      } else {
        chunks.push(token);
        if (blockTags.has(name)) stack.push({ name, textBefore: textLen, chunkIndex: chunks.length - 1 });
      }
      continue;
    }
    const remaining = maxLength - textLen;
    if (token.length <= remaining) {
      chunks.push(token);
      textLen += token.length;
    } else {
      if (remaining > 0) chunks.push(token.slice(0, remaining));
      truncated = true;
      break;
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) chunks.push(`</${stack[i]!.name}>`);
  const out = chunks.join("");
  return truncated ? out + "…" : out;
}

export function firstImageSrc(html: string): string | null {
  const m = /<img[^>]*\ssrc="([^"]+)"/i.exec(html);
  return m && m[1] ? m[1] : null;
}