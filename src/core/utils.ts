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