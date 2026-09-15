import { topicNoteById, commentNoteById, getUserRowById, getKeyPairForUser, buildActorForUser, getRemoteActorByLocalUserId, resolveLocalObject, resolveRemoteAcct, fetchRemoteActor } from "./service";
import { deliverToUserFollowers, sendActivityToInbox } from "./deliver";
import { createActivity, deleteActivity, updateActivity, mentionTag } from "./jsonld";
import { config } from "../core/config";
import { getDrizzle } from "../core/db";
import { comments, topics, apActors } from "../core/schema";
import { and, eq, isNull } from "drizzle-orm";

async function actorUrlForUserId(userId: number): Promise<string> {
  const user = await getUserRowById(userId);
  return user ? `${config.baseUrl}/users/${user.username}` : config.baseUrl;
}

export async function notifyTopicCreated(topicId: number, authorUserId: number): Promise<void> {
  const note = await topicNoteById(topicId);
  if (!note) return;
  await enrichWithMentions(note, authorUserId);
  const activity = createActivity(note);
  deliverToUserFollowers(activity, authorUserId);
  await deliverToThreadParticipants(activity, topicId, authorUserId);
}

export async function notifyCommentCreated(commentId: number, authorUserId: number): Promise<void> {
  const note = await commentNoteById(commentId);
  if (!note) return;
  await enrichWithMentions(note, authorUserId);

  const replyTo = note.inReplyTo;
  let ref: ReturnType<typeof resolveLocalObject> = null;
  if (typeof replyTo === "string") ref = resolveLocalObject(replyTo);
  if (ref) {
    const parentAuthorIri = await replyTargetIri(ref);
    if (parentAuthorIri) {
      const cc = Array.isArray(note.cc) ? (note.cc as unknown[]) : [];
      note.cc = [...cc, parentAuthorIri];
    }
    const activity = createActivity(note);
    deliverToUserFollowers(activity, authorUserId);
    await deliverToThreadParticipants(activity, ref.topicId, authorUserId);
    return;
  }

  const activity = createActivity(note);
  deliverToUserFollowers(activity, authorUserId);
}

const mentionRe = /@([A-Za-z0-9_.\-]+)@([A-Za-z0-9_.\-:]+)/g;

/**
 * Find @user@host handles in the note body, resolve each to a remote actor and
 * deliver the Create straight to that actor's inbox (Mastodon/Pleroma send
 * replies to mentioned accounts even when they are not followers). The resolved
 * Mention tags are added to the note so anywhere else that reads it (followers,
 * relays) sees the same addressing.
 */
async function enrichWithMentions(note: Record<string, unknown>, actorUserId: number): Promise<void> {
  const body = note.content;
  if (typeof body !== "string") return;
  const text = body.replace(/<[^>]*>/g, "");
  const outbound: { actorId: string; inbox: string; name: string }[] = [];
  for (const m of text.matchAll(mentionRe)) {
    const name = m[1]!.toLowerCase();
    const host = m[2]!.toLowerCase();
    if (host === new URL(config.baseUrl).host.toLowerCase()) continue; // local, already addressed
    const acct = `acct:${name}@${host}`;
    try {
      const actorIri = await resolveRemoteAcct(acct);
      if (!actorIri) continue;
      const actor = await fetchRemoteActor(actorIri);
      if (!actor || actor.deletedAt) continue;
      const inbox = actor.sharedInboxUrl ?? actor.inboxUrl;
      if (!inbox) continue;
      outbound.push({ actorId: actor.remoteId, inbox, name: `@${name}@${host}` });
    } catch {
      /* best effort */
    }
  }
  if (!outbound.length) return;

  const tags = Array.isArray(note.tag) ? (note.tag as unknown[]) : [];
  note.tag = [...tags, ...outbound.map((m) => mentionTag(m.actorId, m.name))];
  const cc = Array.isArray(note.cc) ? (note.cc as unknown[]) : [];
  note.cc = [...cc, ...outbound.map((m) => m.actorId)];

  const activity = createActivity(note);
  for (const target of outbound) {
    void sendActivityToInbox(target.inbox, activity, actorUserId);
  }
}

/**
 * Delivery targets for a topic thread: the inboxes (shared inbox preferred) of
 * every remote actor who has authored a comment in that topic. This keeps a
 * hosted thread in sync with ALL its remote participants, not just those who
 * follow us or are explicitly mentioned — a reply from a local user inside the
 * thread therefore reaches every remote user who ever posted there.
 */
async function collectThreadParticipantInboxes(topicId: number): Promise<string[]> {
  const db = getDrizzle();
  const rows = await db
    .select({
      inboxUrl: apActors.inboxUrl,
      sharedInboxUrl: apActors.sharedInboxUrl,
    })
    .from(comments)
    .innerJoin(apActors, eq(apActors.localUserId, comments.authorId))
    .where(and(eq(comments.topicId, topicId), isNull(apActors.deletedAt)));
  const seen = new Set<string>();
  const inboxes: string[] = [];
  for (const row of rows) {
    const inbox = row.sharedInboxUrl ?? row.inboxUrl;
    if (!inbox || inbox.startsWith(config.baseUrl)) continue;
    if (seen.has(inbox)) continue;
    seen.add(inbox);
    inboxes.push(inbox);
  }
  return inboxes;
}

async function deliverToThreadParticipants(
  activity: Record<string, unknown>,
  topicId: number,
  commentAuthorUserId: number,
): Promise<void> {
  const inboxes = await collectThreadParticipantInboxes(topicId);
  for (const inbox of inboxes) {
    await sendActivityToInbox(inbox, activity, commentAuthorUserId);
  }
}

/** IRI of the remote author of the comment being replied to, for proper addressing. */
async function replyTargetIri(ref: { kind: "topic" | "comment"; topicId: number; commentId?: number }): Promise<string | null> {
  if (ref.kind !== "comment" || !ref.commentId) return null;
  const db = getDrizzle();
  const parent = await db.select({ authorId: comments.authorId }).from(comments).where(eq(comments.id, ref.commentId)).limit(1);
  if (!parent[0]) return null;
  const remote = await getRemoteActorByLocalUserId(parent[0].authorId);
  return remote?.remoteId ?? null;
}

export async function notifyTopicDeleted(topicId: number, authorUserId: number, objectUrl?: string): Promise<void> {
  const user = await getUserRowById(authorUserId);
  const actor = user ? `${config.baseUrl}/users/${user.username}` : config.baseUrl;
  const url = objectUrl ?? `${config.baseUrl}/topics/${topicId}`;
  deliverToUserFollowers(deleteActivity(url, actor), authorUserId);
}

export async function notifyCommentDeleted(commentId: number, topicId: number, authorUserId: number): Promise<void> {
  const user = await getUserRowById(authorUserId);
  const actor = user ? `${config.baseUrl}/users/${user.username}` : config.baseUrl;
  const db = getDrizzle();
  const slugRow = await db.select({ slug: topics.slug }).from(topics).where(eq(topics.id, topicId)).limit(1);
  const slug = slugRow[0]?.slug;
  const objectUrl = slug ? `${config.baseUrl}/topics/${topicId}/${slug}/comments/${commentId}` : `${config.baseUrl}/topics/${topicId}/${commentId}`;
  deliverToUserFollowers(deleteActivity(objectUrl, actor), authorUserId);
}

/** Broadcast an actor Update after a profile edit, so remote followers refresh cached metadata. */
export async function notifyProfileUpdated(userId: number): Promise<void> {
  const user = await getUserRowById(userId);
  if (!user) return;
  const actor = await buildActorForUser(user.username);
  if (!actor) return;
  deliverToUserFollowers(updateActivity(actor), userId);
}

/** Refresh the actor document (ensures an AP key exists for the user). */
export async function ensureActorKey(userId: number): Promise<void> {
  await getKeyPairForUser(userId);
}