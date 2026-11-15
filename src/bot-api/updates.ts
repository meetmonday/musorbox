import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { messageBotUpdates } from "../core/schema";

type TelegramUpdate = { update_id: number } & Record<string, unknown>;
type Waiter = () => void;

const waiters = new Map<number, Set<Waiter>>();

function wakeBot(botUserId: number): void {
  const listeners = waiters.get(botUserId);
  if (!listeners) return;
  waiters.delete(botUserId);
  for (const wake of listeners) wake();
}

export function enqueueBotUpdate(botUserId: number, payload: Record<string, unknown>): number {
  const row = getDrizzle().insert(messageBotUpdates).values({
    botUserId,
    payload: JSON.stringify(payload),
  }).returning({ id: messageBotUpdates.id }).get();
  if (!row) throw new Error("Не удалось поставить событие бота в очередь.");
  wakeBot(botUserId);
  return row.id;
}

function readUpdates(botUserId: number, offset: number): TelegramUpdate[] {
  if (offset > 0) {
    getDrizzle().delete(messageBotUpdates).where(and(
      eq(messageBotUpdates.botUserId, botUserId),
      lt(messageBotUpdates.id, offset),
    )).run();
  }
  const filter = offset > 0
    ? and(eq(messageBotUpdates.botUserId, botUserId), gte(messageBotUpdates.id, offset))
    : eq(messageBotUpdates.botUserId, botUserId);
  return getDrizzle()
    .select({ id: messageBotUpdates.id, payload: messageBotUpdates.payload })
    .from(messageBotUpdates)
    .where(filter)
    .orderBy(asc(messageBotUpdates.id))
    .limit(100)
    .all()
    .flatMap((row) => {
      try {
        const payload = JSON.parse(row.payload) as unknown;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
        return [{ update_id: row.id, ...payload as Record<string, unknown> }];
      } catch (error) {
        console.error(`[bot-api] Повреждён update ${row.id} для botUserId=${botUserId}:`, error);
        return [];
      }
    });
}

export async function getBotUpdates(
  botUserId: number,
  offset: number,
  timeoutSeconds: number,
  signal: AbortSignal,
): Promise<TelegramUpdate[]> {
  const existing = readUpdates(botUserId, offset);
  if (existing.length || timeoutSeconds <= 0 || signal.aborted) return existing;

  let finishWait: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    let listeners = waiters.get(botUserId);
    if (!listeners) {
      listeners = new Set();
      waiters.set(botUserId, listeners);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      listeners!.delete(finish);
      if (listeners!.size === 0) waiters.delete(botUserId);
      resolve();
    };
    finishWait = finish;
    listeners.add(finish);
    timer = setTimeout(finish, timeoutSeconds * 1000);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });

  // Не пропускаем update, вставленный между первым SELECT и регистрацией waiter.
  const afterSubscribe = readUpdates(botUserId, offset);
  if (afterSubscribe.length) {
    finishWait?.();
    return afterSubscribe;
  }
  await wait;
  if (signal.aborted) return [];
  return readUpdates(botUserId, offset);
}
