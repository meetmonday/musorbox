export type MessageRealtimeEvent = {
  type: "message" | "read" | "delete" | "edit";
  peerId?: number;
  groupId?: number;
  messageId?: number;
};

type Listener = (event: MessageRealtimeEvent) => void;

const MAX_CONNECTIONS_PER_USER = 10;
const listeners = new Map<number, Set<Listener>>();

/**
 * Событие — только сигнал перечитать данные из БД. Текст сообщения через
 * процессную шину не передаётся, поэтому проверка доступа остаётся в маршруте.
 */
export function publishMessageEvent(userId: number, event: MessageRealtimeEvent): void {
  const userListeners = listeners.get(userId);
  if (!userListeners) return;
  for (const listener of userListeners) listener(event);
}

export function canOpenMessageStream(userId: number): boolean {
  return (listeners.get(userId)?.size ?? 0) < MAX_CONNECTIONS_PER_USER;
}

export function subscribeToMessageEvents(userId: number, listener: Listener): () => void {
  let userListeners = listeners.get(userId);
  if (!userListeners) {
    userListeners = new Set();
    listeners.set(userId, userListeners);
  }
  if (userListeners.size >= MAX_CONNECTIONS_PER_USER) return () => {};
  userListeners.add(listener);
  return () => {
    const current = listeners.get(userId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(userId);
  };
}
