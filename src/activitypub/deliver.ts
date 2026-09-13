import { config } from "../core/config";
import { getKeyPairForUser, deliveryTargetsForUser, getUserRowById } from "./service";
import { signRequest } from "./http-signatures";
import { getDrizzle } from "../core/db";
import { users } from "../core/schema";
import { eq } from "drizzle-orm";

const inflight = new Set<string>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getUserRowByIdFallback(userId: number) {
  const db = getDrizzle();
  const rows = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Deliver an activity to every follower delivery target of the given local user.
 * Delivery is signed with the user's ActivityPub key. Runs in the background.
 */
export function deliverToUserFollowers(activity: Record<string, unknown>, userId: number): void {
  void (async () => {
    try {
      const targets = await deliveryTargetsForUser(userId);
      if (targets.length === 0) return;
      let username: string | null = null;
      const byId = await getUserRowById(userId);
      if (byId) username = byId.username;
      if (!username) {
        const fb = await getUserRowByIdFallback(userId);
        username = fb?.username ?? null;
      }
      if (!username) return;
      const { privateKeyPem } = await getKeyPairForUser(userId);
      const keyId = `${config.baseUrl}/users/${username}#main-key`;
      for (const inbox of targets) {
        void deliverOne(inbox, activity, keyId, privateKeyPem);
      }
    } catch (err) {
      console.error("[ap] deliver enqueue failed", (err as Error)?.message);
    }
  })();
}

async function deliverOne(
  inbox: string,
  activity: Record<string, unknown>,
  keyId: string,
  privateKeyPem: string,
): Promise<void> {
  const activityId = String(activity.id ?? "activity");
  const key = `${inbox}|${activityId}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await postSigned(inbox, activity, keyId, privateKeyPem);
        return;
      } catch (err) {
        if (attempt >= 5) {
          console.error(`[ap] delivery to ${inbox} failed: ${(err as Error)?.message}`);
        } else {
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
    }
  } finally {
    inflight.delete(key);
  }
}

async function postSigned(
  inbox: string,
  activity: Record<string, unknown>,
  keyId: string,
  privateKeyPem: string,
): Promise<void> {
  const body = JSON.stringify(activity);
  const { headers } = await signRequest({ method: "POST", url: inbox, body, privateKeyPem, keyId });
  const res = await fetch(inbox, {
    method: "POST",
    headers: { ...headers, Accept: "application/activity+json" },
    body,
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
}

export async function sendActivityToInbox(
  inbox: string,
  activity: Record<string, unknown>,
  userId: number,
): Promise<boolean> {
  try {
    const byId = await getUserRowById(userId);
    const username = byId?.username;
    if (!username) return false;
    const { privateKeyPem } = await getKeyPairForUser(userId);
    const keyId = `${config.baseUrl}/users/${username}#main-key`;
    const body = JSON.stringify(activity);
    const { headers } = await signRequest({ method: "POST", url: inbox, body, privateKeyPem, keyId });
    const res = await fetch(inbox, {
      method: "POST",
      headers: { ...headers, Accept: "application/activity+json" },
      body,
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`[ap] send to ${inbox} failed: ${res.status} ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[ap] send to ${inbox} error: ${(err as Error)?.message}`);
    return false;
  }
}