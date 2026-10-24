import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  canUseProfileBg,
  isProfileBgId,
  profileBgChoicesFor,
  profileBgUrl,
  type ProfileBgId,
} from "@/lib/profileBg";
import { netVisibleLength } from "@/lib/netEmoji";
import { detectNetMime, extOf, isStillImage, removeNetFile, saveNetFile, NET_MAX_BYTES, type NetMime } from "@/lib/netMedia";
import type { NetChatLine, NetPageData, NetPerson, NetThemeCard } from "@/lib/netTypes";
import type { Role } from "@prisma/client";

export const NET_THEME_LIMIT = 10;
export const NET_TITLE_MAX = 30;
export const NET_STATUS_MAX = 20;
export const NET_NEWS_DAYS = 7;
const NET_HERE_MS = 15 * 1000;
const NEWS_ROLES: Role[] = ["ADMIN", "HR", "DEPUTY", "SUPER_ADMIN"];

export function canPostNetNews(role: Role): boolean {
  return NEWS_ROLES.includes(role);
}

async function viewer() {
  const session = await getSession();
  if (!session?.user?.steamId || !session.user.profileComplete) return null;
  return prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      id: true,
      nick: true,
      role: true,
      steamId: true,
      unlockedProfileBgs: true,
    },
  });
}

async function markNetHere(userId: string) {
  const now = new Date();
  await prisma.netProfile.upsert({
    where: { userId },
    create: { userId, netSeenAt: now },
    update: { netSeenAt: now },
  });
}

async function netHere(): Promise<NetPerson[]> {
  const rows = await prisma.netProfile.findMany({
    where: {
      netSeenAt: { gte: new Date(Date.now() - NET_HERE_MS) },
      user: { profileComplete: true, nick: { not: null } },
    },
    orderBy: { netSeenAt: "desc" },
    take: 40,
    select: { avatarUrl: true, user: { select: { nick: true } } },
  });
  return rows.map((row) => person(row.user.nick, row.avatarUrl)).filter((x): x is NetPerson => Boolean(x));
}

function person(nick: string | null, avatarUrl: string | null): NetPerson | null {
  if (!nick) return null;
  return { nick, avatarUrl };
}

function themeCard(
  row: {
    id: string;
    title: string;
    body: string;
    imageUrls: string[];
    createdAt: Date;
    user: { nick: string | null };
    userId: string;
    votes: { userId: string; value: number }[];
    comments: { id: string; body: string; createdAt: Date; user: { nick: string | null } }[];
  },
  viewerId: string | null
): NetThemeCard | null {
  if (!row.user.nick) return null;
  let likes = 0;
  let dislikes = 0;
  let myVote: -1 | 0 | 1 = 0;
  for (const v of row.votes) {
    if (v.value > 0) likes += 1;
    else if (v.value < 0) dislikes += 1;
    if (viewerId && v.userId === viewerId) myVote = v.value > 0 ? 1 : -1;
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrls: row.imageUrls,
    authorNick: row.user.nick,
    likes,
    dislikes,
    myVote,
    mine: Boolean(viewerId && row.userId === viewerId),
    createdAt: row.createdAt.toISOString(),
    comments: row.comments
      .filter((c) => c.user.nick)
      .map((c) => ({
        id: c.id,
        nick: c.user.nick as string,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
  };
}

export async function loadNetPage(rawNick: string): Promise<NetPageData | { error: string; status: number }> {
  const me = await viewer();
  if (!me?.nick) return { error: "Нужен вход", status: 401 };

  const nick = rawNick.trim();
  const owner = await prisma.user.findFirst({
    where: { nick: { equals: nick, mode: "insensitive" }, profileComplete: true },
    select: {
      id: true,
      nick: true,
      steamId: true,
      unlockedProfileBgs: true,
      netProfile: true,
    },
  });
  if (!owner?.nick) return { error: "Игрок не найден", status: 404 };

  const weekAgo = new Date(Date.now() - NET_NEWS_DAYS * 24 * 60 * 60 * 1000);
  await prisma.netNews.deleteMany({ where: { createdAt: { lt: weekAgo } } }).catch(() => undefined);
  await markNetHere(me.id);

  const [themes, popularRaw, posts, news, followers, following, onlineUsers, sub] = await Promise.all([
    prisma.netTheme.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "desc" },
      take: NET_THEME_LIMIT,
      include: {
        user: { select: { nick: true } },
        votes: { select: { userId: true, value: true } },
        comments: {
          orderBy: { createdAt: "asc" as const },
          take: 80,
          include: { user: { select: { nick: true } } },
        },
      },
    }),
    prisma.netTheme.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        user: { select: { nick: true } },
        votes: { select: { userId: true, value: true } },
        comments: {
          orderBy: { createdAt: "asc" as const },
          take: 80,
          include: { user: { select: { nick: true } } },
        },
      },
    }),
    prisma.netPost.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        votes: { select: { userId: true, value: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          take: 50,
          include: { user: { select: { nick: true } } },
        },
      },
    }),
    prisma.netNews.findMany({
      where: { createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { author: { select: { nick: true } } },
    }),
    prisma.netFollow.findMany({
      where: { followingId: owner.id },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { follower: { select: { nick: true, netProfile: { select: { avatarUrl: true } } } } },
    }),
    prisma.netFollow.findMany({
      where: { followerId: me.id },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { following: { select: { nick: true, netProfile: { select: { avatarUrl: true } } } } },
    }),
    netHere(),
    prisma.netFollow.findUnique({
      where: { followerId_followingId: { followerId: me.id, followingId: owner.id } },
      select: { followerId: true },
    }),
  ]);

  const themeCards = themes.map((t) => themeCard(t, me.id)).filter((x): x is NetThemeCard => Boolean(x));
  const popular = popularRaw
    .map((t) => themeCard(t, me.id))
    .filter((x): x is NetThemeCard => Boolean(x))
    .sort((a, b) => b.likes + b.dislikes - (a.likes + a.dislikes) || b.likes - a.likes)
    .slice(0, 5);

  const bgChoices = profileBgChoicesFor({
    steamId: owner.steamId,
    unlocks: owner.unlockedProfileBgs,
  }).map((c) => ({ id: c.id, file: c.file, label: c.label }));

  const bgId = owner.netProfile?.bgId && isProfileBgId(owner.netProfile.bgId) ? owner.netProfile.bgId : null;

  return {
    nick: owner.nick,
    isOwn: me.id === owner.id,
    canNews: canPostNetNews(me.role),
    avatarUrl: owner.netProfile?.avatarUrl ?? null,
    status: owner.netProfile?.status ?? "",
    bgUrl: profileBgUrl(bgId),
    bgId,
    bgChoices: me.id === owner.id ? bgChoices : [],
    subscribed: Boolean(sub),
    followers: followers.map((f) => person(f.follower.nick, f.follower.netProfile?.avatarUrl ?? null)).filter((x): x is NetPerson => Boolean(x)),
    following: following.map((f) => person(f.following.nick, f.following.netProfile?.avatarUrl ?? null)).filter((x): x is NetPerson => Boolean(x)),
    themes: themeCards,
    themeLimit: NET_THEME_LIMIT,
    popular,
    posts: posts.map((p) => ({
      id: p.id,
      body: p.body,
      imageUrl: p.imageUrl,
      gifUrl: p.gifUrl,
      videoUrl: p.videoUrl,
      likes: p.votes.filter((v) => v.value > 0).length,
      dislikes: p.votes.filter((v) => v.value < 0).length,
      myVote: (p.votes.find((v) => v.userId === me.id)?.value === -1 ? -1 : p.votes.some((v) => v.userId === me.id && v.value > 0) ? 1 : 0) as -1 | 0 | 1,
      createdAt: p.createdAt.toISOString(),
      comments: p.comments
        .filter((c) => c.user.nick)
        .map((c) => ({
          id: c.id,
          nick: c.user.nick as string,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
    })),
    news: news
      .filter((n) => n.author.nick)
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        authorNick: n.author.nick as string,
        createdAt: n.createdAt.toISOString(),
      })),
    online: onlineUsers,
  };
}

async function own() {
  const me = await viewer();
  if (!me?.nick) return { error: "Нужен вход" as const };
  return { me };
}

export async function setNetStatus(text: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  const status = text.replace(/\s+/g, " ").trim();
  if (netVisibleLength(status) > NET_STATUS_MAX) {
    return { error: `Статус до ${NET_STATUS_MAX} знаков` };
  }
  await prisma.netProfile.upsert({
    where: { userId: gate.me.id },
    create: { userId: gate.me.id, status },
    update: { status },
  });
  return { ok: true as const };
}

export async function setNetBg(bgId: string | null) {
  const gate = await own();
  if ("error" in gate) return gate;
  const id = bgId && isProfileBgId(bgId) ? (bgId as ProfileBgId) : null;
  if (
    !canUseProfileBg(id, {
      steamId: gate.me.steamId,
      unlocks: gate.me.unlockedProfileBgs,
    })
  ) {
    return { error: "Этот фон ещё не открыт" };
  }
  await prisma.netProfile.upsert({
    where: { userId: gate.me.id },
    create: { userId: gate.me.id, bgId: id },
    update: { bgId: id },
  });
  return { ok: true as const };
}

export async function saveNetAvatar(buf: Buffer) {
  const gate = await own();
  if ("error" in gate) return gate;
  if (buf.length <= 0 || buf.length > NET_MAX_BYTES) return { error: "Файл до 50 МБ" };
  const mime = detectNetMime(buf);
  if (!mime || !isStillImage(mime)) return { error: "Нужен png, jpeg или webp" };
  const prev = await prisma.netProfile.findUnique({
    where: { userId: gate.me.id },
    select: { avatarUrl: true },
  });
  const file = `av-${gate.me.id}.${extOf(mime)}`;
  await removeNetFile(prev?.avatarUrl);
  const avatarUrl = await saveNetFile(file, buf);
  await prisma.netProfile.upsert({
    where: { userId: gate.me.id },
    create: { userId: gate.me.id, avatarUrl },
    update: { avatarUrl },
  });
  return { ok: true as const, avatarUrl };
}

export async function createNetTheme(titleRaw: string, bodyRaw: string, images: Buffer[]) {
  const gate = await own();
  if ("error" in gate) return gate;
  const title = titleRaw.replace(/\s+/g, " ").trim();
  const body = bodyRaw.trim();
  if (!title) return { error: "Нужно название темы" };
  if ([...title].length > NET_TITLE_MAX) return { error: `Название до ${NET_TITLE_MAX} знаков` };
  if (!body && images.length === 0) return { error: "Напиши текст или приложи картинку" };
  if (images.length > 3) return { error: "До трёх картинок" };
  const count = await prisma.netTheme.count({ where: { userId: gate.me.id } });
  if (count >= NET_THEME_LIMIT) return { error: `Лимит ${NET_THEME_LIMIT} тем` };

  const ready: { buf: Buffer; mime: NetMime }[] = [];
  for (const buf of images) {
    if (buf.length > NET_MAX_BYTES) return { error: "Картинка до 50 МБ" };
    const mime = detectNetMime(buf);
    if (!mime || !isStillImage(mime)) return { error: "Картинки: png, jpeg или webp" };
    ready.push({ buf, mime });
  }
  const urls: string[] = [];
  for (const item of ready) {
    urls.push(await saveNetFile(`th-${crypto.randomUUID()}.${extOf(item.mime)}`, item.buf));
  }
  await prisma.netTheme.create({
    data: { userId: gate.me.id, title, body, imageUrls: urls },
  });
  return { ok: true as const };
}

export async function deleteNetTheme(id: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  const row = await prisma.netTheme.findFirst({
    where: { id, userId: gate.me.id },
    select: { imageUrls: true },
  });
  if (!row) return { error: "Тема не найдена" };
  await prisma.netTheme.delete({ where: { id } });
  for (const url of row.imageUrls) await removeNetFile(url);
  return { ok: true as const };
}

export async function voteNetTheme(id: string, value: -1 | 0 | 1) {
  const gate = await own();
  if ("error" in gate) return gate;
  const theme = await prisma.netTheme.findUnique({ where: { id }, select: { id: true } });
  if (!theme) return { error: "Тема не найдена" };
  if (value === 0) {
    await prisma.netThemeVote.deleteMany({ where: { themeId: id, userId: gate.me.id } });
  } else {
    await prisma.netThemeVote.upsert({
      where: { themeId_userId: { themeId: id, userId: gate.me.id } },
      create: { themeId: id, userId: gate.me.id, value },
      update: { value },
    });
  }
  return { ok: true as const };
}

function mediaSlot(mime: NetMime): "imageUrl" | "gifUrl" | "videoUrl" {
  if (mime === "image/gif") return "gifUrl";
  if (mime === "video/mp4" || mime === "video/webm") return "videoUrl";
  return "imageUrl";
}

export async function createNetPost(bodyRaw: string, file: Buffer | null) {
  const gate = await own();
  if ("error" in gate) return gate;
  const body = bodyRaw.trim();
  if (!body && !file) return { error: "Пустой пост" };
  let imageUrl: string | null = null;
  let gifUrl: string | null = null;
  let videoUrl: string | null = null;
  if (file) {
    if (file.length > NET_MAX_BYTES) return { error: "Файл до 50 МБ" };
    const mime = detectNetMime(file);
    if (!mime) return { error: "Нужна картинка, gif, mp4 или webm" };
    const saved = await saveNetFile(`po-${crypto.randomUUID()}.${extOf(mime)}`, file);
    const slot = mediaSlot(mime);
    if (slot === "imageUrl") imageUrl = saved;
    else if (slot === "gifUrl") gifUrl = saved;
    else videoUrl = saved;
  }
  await prisma.netPost.create({
    data: { userId: gate.me.id, body, imageUrl, gifUrl, videoUrl },
  });
  return { ok: true as const };
}

export async function deleteNetPost(id: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  const row = await prisma.netPost.findFirst({
    where: { id, userId: gate.me.id },
    select: { imageUrl: true, gifUrl: true, videoUrl: true },
  });
  if (!row) return { error: "Пост не найден" };
  await prisma.netPost.delete({ where: { id } });
  await removeNetFile(row.imageUrl);
  await removeNetFile(row.gifUrl);
  await removeNetFile(row.videoUrl);
  return { ok: true as const };
}

export async function voteNetPost(id: string, value: -1 | 0 | 1) {
  const gate = await own();
  if ("error" in gate) return gate;
  const post = await prisma.netPost.findUnique({ where: { id }, select: { id: true } });
  if (!post) return { error: "Пост не найден" };
  if (value === 0) {
    await prisma.netPostVote.deleteMany({ where: { postId: id, userId: gate.me.id } });
  } else {
    await prisma.netPostVote.upsert({
      where: { postId_userId: { postId: id, userId: gate.me.id } },
      create: { postId: id, userId: gate.me.id, value },
      update: { value },
    });
  }
  return { ok: true as const };
}

function clipNote(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > 90 ? `${chars.slice(0, 89).join("")}…` : flat;
}

async function netNotice(input: {
  userId: string;
  dedupeKey: string;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}) {
  await prisma.userNotice
    .create({
      data: {
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        kind: "net",
        title: input.title,
        body: input.body,
        href: input.href,
        linkLabel: input.linkLabel,
      },
    })
    .catch(() => undefined);
}

export async function commentNetTheme(themeId: string, bodyRaw: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  const body = bodyRaw.trim();
  if (!body) return { error: "Пустой комментарий" };
  if (netVisibleLength(body) > 400) return { error: "Комментарий до 400 знаков" };
  const theme = await prisma.netTheme.findUnique({
    where: { id: themeId },
    select: { id: true, title: true, userId: true, user: { select: { nick: true } } },
  });
  if (!theme) return { error: "Тема не найдена" };
  const row = await prisma.netThemeComment.create({ data: { themeId, userId: gate.me.id, body } });
  if (theme.userId !== gate.me.id && theme.user.nick && gate.me.nick) {
    await netNotice({
      userId: theme.userId,
      dedupeKey: `net-theme-c:${row.id}`,
      title: "Комментарий к теме",
      body: `${gate.me.nick} к «${theme.title}»: ${clipNote(body)}`,
      href: `/profile/web/${encodeURIComponent(theme.user.nick)}`,
      linkLabel: "К теме",
    });
  }
  return { ok: true as const };
}

export async function commentNetPost(postId: string, bodyRaw: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  const body = bodyRaw.trim();
  if (!body) return { error: "Пустой комментарий" };
  if (netVisibleLength(body) > 400) return { error: "Комментарий до 400 знаков" };
  const post = await prisma.netPost.findUnique({
    where: { id: postId },
    select: { id: true, userId: true, user: { select: { nick: true } } },
  });
  if (!post) return { error: "Пост не найден" };
  const row = await prisma.netComment.create({ data: { postId, userId: gate.me.id, body } });
  if (post.userId !== gate.me.id && post.user.nick && gate.me.nick) {
    await netNotice({
      userId: post.userId,
      dedupeKey: `net-post-c:${row.id}`,
      title: "Комментарий к посту",
      body: `${gate.me.nick}: ${clipNote(body)}`,
      href: `/profile/web/${encodeURIComponent(post.user.nick)}`,
      linkLabel: "К посту",
    });
  }
  return { ok: true as const };
}

const CHAT_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export async function loadNetChat(): Promise<
  { messages: NetChatLine[]; online: NetPerson[] } | { error: string }
> {
  const gate = await own();
  if ("error" in gate) return gate;
  await markNetHere(gate.me.id);
  const [rows, online] = await Promise.all([
    prisma.netChatMessage.findMany({
      where: { createdAt: { gte: new Date(Date.now() - CHAT_KEEP_MS) } },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { user: { select: { nick: true } } },
    }),
    netHere(),
  ]);
  const messages = rows
    .reverse()
    .filter((row) => row.user.nick)
    .map((row) => ({
      id: row.id,
      nick: row.user.nick as string,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    }));
  return { messages, online };
}

export async function postNetChat(bodyRaw: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  const body = bodyRaw.replace(/\s+/g, " ").trim();
  if (!body) return { error: "Пустое сообщение" };
  if (netVisibleLength(body) > 200) return { error: "Сообщение до 200 знаков" };
  await prisma.netChatMessage.create({ data: { userId: gate.me.id, body } });
  await prisma.netChatMessage
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - CHAT_KEEP_MS) } } })
    .catch(() => undefined);
  return { ok: true as const };
}

export async function setNetFollow(targetNick: string, on: boolean) {
  const gate = await own();
  if ("error" in gate) return gate;
  const target = await prisma.user.findFirst({
    where: { nick: { equals: targetNick.trim(), mode: "insensitive" }, profileComplete: true },
    select: { id: true, nick: true },
  });
  if (!target?.nick) return { error: "Игрок не найден" };
  if (target.id === gate.me.id) return { error: "На себя не подписаться" };
  if (on) {
    const already = await prisma.netFollow.findUnique({
      where: { followerId_followingId: { followerId: gate.me.id, followingId: target.id } },
      select: { followerId: true },
    });
    if (!already) {
      await prisma.netFollow.create({ data: { followerId: gate.me.id, followingId: target.id } });
      if (gate.me.nick) {
        await netNotice({
          userId: target.id,
          dedupeKey: `net-follow:${gate.me.id}:${Date.now()}`,
          title: "Новая подписка",
          body: `${gate.me.nick} подписался на тебя`,
          href: `/profile/web/${encodeURIComponent(target.nick)}`,
          linkLabel: "Моя страница",
        });
      }
    }
  } else {
    await prisma.netFollow.deleteMany({
      where: { followerId: gate.me.id, followingId: target.id },
    });
  }
  return { ok: true as const };
}

export async function createNetNews(titleRaw: string, bodyRaw: string) {
  const gate = await own();
  if ("error" in gate) return gate;
  if (!canPostNetNews(gate.me.role)) return { error: "Новости пишут модераторы" };
  const title = titleRaw.replace(/\s+/g, " ").trim();
  const body = bodyRaw.trim();
  if (!title || !body) return { error: "Нужны заголовок и текст" };
  if ([...title].length > 80) return { error: "Заголовок до 80 знаков" };
  await prisma.netNews.create({ data: { authorId: gate.me.id, title, body } });
  return { ok: true as const };
}
