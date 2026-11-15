export type BotInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type BotInlineKeyboardMarkup = {
  inline_keyboard: BotInlineKeyboardButton[][];
};

function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("reply_markup должен быть корректным JSON");
  }
}

export function normalizeBotReplyMarkup(value: unknown): BotInlineKeyboardMarkup | null {
  const parsed = decoded(value);
  if (parsed === undefined || parsed === null) return null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("reply_markup должен быть объектом");
  }
  const keyboard = (parsed as Record<string, unknown>).inline_keyboard;
  if (!Array.isArray(keyboard) || keyboard.length > 20) {
    throw new Error("inline_keyboard должен содержать не более 20 строк");
  }
  const rows = keyboard.map((rawRow) => {
    if (!Array.isArray(rawRow) || rawRow.length === 0 || rawRow.length > 8) {
      throw new Error("Строка inline_keyboard должна содержать от 1 до 8 кнопок");
    }
    return rawRow.map((rawButton): BotInlineKeyboardButton => {
      if (!rawButton || typeof rawButton !== "object" || Array.isArray(rawButton)) {
        throw new Error("Кнопка inline_keyboard должна быть объектом");
      }
      const button = rawButton as Record<string, unknown>;
      if (typeof button.text !== "string" || !button.text.trim() || Array.from(button.text).length > 100) {
        throw new Error("У кнопки inline_keyboard должен быть текст не длиннее 100 символов");
      }
      const callbackData = button.callback_data;
      const url = button.url;
      const hasCallback = typeof callbackData === "string";
      const hasUrl = typeof url === "string";
      if (hasCallback === hasUrl) {
        throw new Error("Кнопка должна содержать ровно одно из полей callback_data или url");
      }
      if (hasCallback) {
        const byteLength = new TextEncoder().encode(callbackData).length;
        if (byteLength < 1 || byteLength > 64) {
          throw new Error("callback_data должен занимать от 1 до 64 байт");
        }
        return { text: button.text, callback_data: callbackData };
      }
      const buttonUrl = typeof url === "string" ? url : "";
      if (!/^https?:\/\//i.test(buttonUrl)) throw new Error("URL кнопки должен использовать HTTP или HTTPS");
      return { text: button.text, url: buttonUrl };
    });
  });
  return rows.length ? { inline_keyboard: rows } : null;
}

export function storedBotReplyMarkup(value: string | null): BotInlineKeyboardMarkup | null {
  if (!value) return null;
  try {
    return normalizeBotReplyMarkup(value);
  } catch (error) {
    console.error("[bot-api] Повреждён reply_markup сообщения:", error);
    return null;
  }
}

export function serializedBotReplyMarkup(markup: BotInlineKeyboardMarkup | null): string | null {
  return markup ? JSON.stringify(markup) : null;
}
