import type { MessageBot } from "./service";

const GROUP_CHAT_ID_BASE = 1_000_000_000_000;

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group";
  username?: string;
  first_name?: string;
  title?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  from: TelegramUser;
  chat: TelegramChat;
  text?: string;
  entities?: Array<Record<string, unknown>>;
  media_group_id?: string;
  caption?: string;
  caption_entities?: Array<Record<string, unknown>>;
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size: number;
  }>;
};

export function telegramUser(user: {
  id: number;
  username: string;
  fullName: string | null;
  isBot?: boolean;
}): TelegramUser {
  return {
    id: user.id,
    is_bot: user.isBot ?? false,
    first_name: user.fullName || user.username,
    username: user.username,
  };
}

export function telegramBotUser(bot: MessageBot): TelegramUser {
  return telegramUser({ id: bot.userId, username: bot.username, fullName: bot.fullName, isBot: true });
}

export function telegramPrivateChat(user: {
  id: number;
  username: string;
  fullName: string | null;
}): TelegramChat {
  return {
    id: user.id,
    type: "private",
    username: user.username,
    first_name: user.fullName || user.username,
  };
}

export function telegramGroupChatId(groupId: number): number {
  return -(GROUP_CHAT_ID_BASE + groupId);
}

export function musorgramGroupId(chatId: number): number | null {
  if (!Number.isSafeInteger(chatId) || chatId >= -GROUP_CHAT_ID_BASE) return null;
  const groupId = Math.abs(chatId) - GROUP_CHAT_ID_BASE;
  return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
}

export function telegramGroupChat(group: { id: number; title: string }): TelegramChat {
  return { id: telegramGroupChatId(group.id), type: "group", title: group.title };
}

export function commandEntities(text: string): Array<Record<string, unknown>> | undefined {
  const command = /^\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?/.exec(text)?.[0];
  if (!command) return undefined;
  return [{ type: "bot_command", offset: 0, length: command.length }];
}

export function unixTime(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
