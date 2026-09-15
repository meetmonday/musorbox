import { config } from "../core/config";
import type { TopicListItem, TopicDetail } from "../topics/service";
import type { TopicComment } from "../comments/service";

export const AS_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
] as const;

type Rec = Record<string, unknown>;

export type ActorUser = {
  username: string;
  fullName: string | null;
  role: string;
  avatarUrl: string | null;
  country: string | null;
  city: string | null;
  createdAt: Date;
};

export function buildActor(
  user: ActorUser,
  publicKeyPem: string,
  publicKeyId?: string,
  opts: { alsoKnownAs?: string[] } = {},
): Rec {
  const actorUrl = `${config.baseUrl}/users/${user.username}`;
  const icon = user.avatarUrl
    ? { type: "Image", url: user.avatarUrl.startsWith("http") ? user.avatarUrl : `${config.baseUrl}${user.avatarUrl}` }
    : undefined;
  const aliases = (opts.alsoKnownAs ?? []).filter((a) => typeof a === "string" && a !== actorUrl);
  return {
    "@context": [...AS_CONTEXT],
    type: "Person",
    id: actorUrl,
    url: actorUrl,
    preferredUsername: user.username,
    name: user.fullName ?? user.username,
    summary: `${user.role === "admin" ? "Admin" : user.role === "editor" ? "Editor" : "Author"} at ${config.siteName}`,
    icon,
    ...(aliases.length ? { alsoKnownAs: aliases } : {}),
    discoverable: true,
    attachment: [
      ...(user.country ? [{ type: "Property", name: "Country", value: user.country }] : []),
      ...(user.city ? [{ type: "Property", name: "City", value: user.city }] : []),
    ],
    inbox: `${actorUrl}/inbox`,
    outbox: `${actorUrl}/outbox`,
    following: `${actorUrl}/following`,
    followers: `${actorUrl}/followers`,
    publicKey: {
      id: publicKeyId ?? `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem,
    },
    published: user.createdAt.toISOString(),
  };
}

export function buildTopicNote(topic: TopicDetail): Rec {
  const url = `${config.baseUrl}/topics/${topic.id}/${topic.slug}`;
  return {
    "@context": [...AS_CONTEXT],
    type: "Note",
    id: url,
    url,
    attributedTo: `${config.baseUrl}/users/${topic.authorUsername}`,
    content: topic.body,
    published: topic.createdAt.toISOString(),
    updated: topic.updatedAt?.toISOString(),
    tag: topic.tags.map((t) => ({ type: "Hashtag", href: `${config.baseUrl}/tag/${t.slug}`, name: `#${t.name}` })),
    attachment: [],
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [`${config.baseUrl}/users/${topic.authorUsername}/followers`],
    replies: {
      type: "Collection",
      totalItems: topic.commentCount,
      first: `${url}/replies`,
    },
  };
}

export function buildCommentNote(comment: TopicComment, topic: TopicDetail): Rec {
  const baseUrl = `${config.baseUrl}/topics/${topic.id}/${topic.slug}`;
  const noteId = `${baseUrl}#comment-${comment.id}`;
  return {
    "@context": [...AS_CONTEXT],
    type: "Note",
    id: noteId,
    url: noteId,
    attributedTo: `${config.baseUrl}/users/${comment.authorUsername}`,
    content: comment.body,
    published: comment.createdAt.toISOString(),
    inReplyTo: comment.parentId
      ? `${baseUrl}#comment-${comment.parentId}`
      : `${config.baseUrl}/topics/${topic.id}/${topic.slug}`,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [`${config.baseUrl}/users/${topic.authorUsername}/followers`],
    replies: {
      type: "Collection",
      totalItems: 0,
    },
  };
}

export function createActivity(note: Rec): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "Create",
    id: `${note.id}#create`,
    actor: note.attributedTo,
    published: note.published,
    object: note,
    to: note.to,
    cc: note.cc,
  };
}

export function updateActivity(note: Rec): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "Update",
    id: `${note.id}#update`,
    actor: note.attributedTo,
    published: new Date().toISOString(),
    object: note,
    to: note.to,
    cc: note.cc,
  };
}

export function deleteActivity(objectUrl: string, actorId: string): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "Delete",
    id: `${objectUrl}#delete`,
    actor: actorId,
    object: objectUrl,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };
}

export function followActivity(actorId: string, targetId: string, idOverride?: string): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "Follow",
    id: idOverride ?? `${actorId}#follows/${encodeURIComponent(targetId)}`,
    actor: actorId,
    object: targetId,
  };
}

export function acceptActivity(activity: Rec, acceptorId: string): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "Accept",
    id: `${acceptorId}#accept/${activity.id}`,
    actor: acceptorId,
    object: activity,
  };
}

export function buildOrderedCollection(totalItems: number, firstUrl: string | null): Rec {
  const col: Rec = {
    "@context": [...AS_CONTEXT],
    type: "OrderedCollection",
    totalItems,
  };
  if (firstUrl) col.first = firstUrl;
  return col;
}

export function buildOrderedCollectionPage(
  items: unknown[],
  prevUrl: string | null,
  nextUrl: string | null,
  collectionId: string,
): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "OrderedCollectionPage",
    id: collectionId,
    partOf: collectionId,
    orderedItems: items,
    prev: prevUrl,
    next: nextUrl,
  };
}

export function buildCollection(items: unknown[], totalItems: number): Rec {
  return {
    "@context": [...AS_CONTEXT],
    type: "Collection",
    totalItems,
    items,
  };
}
