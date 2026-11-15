import { createMessageBot, rotateMessageBotToken } from "../src/bot-api/service";

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const username = argument("username");
const fullName = argument("name");
const rotate = Bun.argv.includes("--rotate");

if (!username) {
  console.error(rotate
    ? "Использование: bun run bot:rotate --username trashkek_bot"
    : "Использование: bun run bot:create --username trashkek_bot --name 'Trashkek'");
  process.exit(1);
}

try {
  console.log(`[bot-api] ${rotate ? "Замена токена" : "Создание бота"} @${username}...`);
  const bot = rotate
    ? rotateMessageBotToken(username)
    : await createMessageBot(username, fullName);
  console.log(`[bot-api] Бот @${bot.username}: ${rotate ? "токен заменён" : "создан"} (userId=${bot.userId}).`);
  console.log("[bot-api] Сохраните токен сейчас: повторно он показан не будет.");
  console.log(`BOT_TOKEN=${bot.token}`);
  console.log("BOT_API_BASE_URL=http://localhost:3000/telegram-bot-api/bot");
  console.log(`[bot-api] Добавьте @${bot.username} в группу через форму «Добавить по логину».`);
} catch (error) {
  console.error(`[bot-api] Не удалось ${rotate ? "заменить токен" : "создать бота"}:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
