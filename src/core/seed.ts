import { getDrizzle } from "./db";
import { users, categories, topics, tags, topicTags, firms, comments, sessions, votes } from "./schema";
import { slugify } from "./utils";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";

const db = getDrizzle();

async function seed() {
  console.log("[seed] clearing old data...");
  await db.delete(topicTags);
  await db.delete(comments);
  await db.delete(votes);
  await db.delete(topics);
  await db.delete(tags);
  await db.delete(sessions);
  await db.delete(users);
  await db.delete(firms);
  await db.delete(categories);

  console.log("[seed] users...");
  const userSeed: (typeof users.$inferInsert)[] = [
    {
      username: "admin",
      passwordHash: await hash("secret", 10),
      fullName: "Администратор",
      role: "editor",
      country: "Россия",
      ratingOptout: true,
    },
    {
      username: "demo",
      passwordHash: await hash("demo123", 10),
      role: "author",
      country: "Россия",
      ratingOptout: true,
    },
    {
      username: "Helper",
      passwordHash: await hash("secret", 10),
      role: "author",
      fullName: "Примерный автор",
      country: "Россия",
    },
    {
      username: "Reader",
      passwordHash: await hash("secret", 10),
      role: "user",
    },
    {
      username: "Liker",
      passwordHash: await hash("secret", 10),
      role: "user",
    },
    {
      username: "Newbie",
      passwordHash: await hash("secret", 10),
      role: "user",
    },
    {
      username: "Moder",
      passwordHash: await hash("secret", 10),
      role: "user",
    },
  ];
  const nowU = Date.now();
  await db.insert(users).values(
    userSeed.map((u, i) => ({
      ...u,
      created_at: new Date(nowU - (i + 9) * 30 * 24 * 3600_000),
      last_seen_at: new Date(nowU - i * 5 * 24 * 3600_000 - 60 * 60_000),
    })),
  );
  const seededUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users);
  const userById = Object.fromEntries(seededUsers.map((u) => [u.username, u.id]));
  void userById;

  console.log("[seed] categories...");
  await db.insert(categories).values([
    { id: 1, parentId: null, name: "Главная", slug: "index", type: "text", sortOrder: 0 },
    { id: 2, parentId: 1, name: "Новости", slug: "b_news", type: "news", sortOrder: 1 },
    { id: 3, parentId: 1, name: "Статьи", slug: "b_text", type: "text", sortOrder: 2 },
    { id: 4, parentId: 1, name: "Обзоры", slug: "reviews", type: "reviews", sortOrder: 3 },
    { id: 5, parentId: 1, name: "Программы", slug: "progs", type: "progs", sortOrder: 4 },
    { id: 6, parentId: 1, name: "Игры", slug: "games", type: "games", sortOrder: 5 },
    { id: 7, parentId: 1, name: "Темы", slug: "themes", type: "themes", sortOrder: 6 },
    { id: 8, parentId: 1, name: "Форум", slug: "b_questions", type: "forum", sortOrder: 7 },
  ]);
  const seededCategories = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  const catById = Object.fromEntries(seededCategories.map((c) => [c.slug, c.id]));

  console.log("[seed] firms...");
  await db.insert(firms).values([
    { id: 5, name: "HTC" },
    { id: 6, name: "Samsung" },
    { id: 29, name: "Apple" },
    { id: 10, name: "Nokia" },
    { id: 55, name: "LG" },
    { id: 48, name: "Sony" },
    { id: 71, name: "Google" },
  ]);

  console.log("[seed] tags...");
  await db.insert(tags).values([
    { name: "Android", slug: "os_android", group: "os", weight: 6 },
    { name: "Android 3.0", slug: "os_Android_3", group: "os", weight: 0 },
    { name: "Java", slug: "os_java", group: "os", weight: 1 },
    { name: "Symbian 9.1, 9.2, 9.3", slug: "os_symbian9", group: "os", weight: 1 },
    { name: "Windows Mobile 5, 6, 6.1, 6.5", slug: "os_wm", group: "os", weight: 1 },
    { name: "Windows Phone 8", slug: "os_wp8", group: "os", weight: 0 },
    { name: "iPhone", slug: "os_ios_phone", group: "os", weight: 0 },
    { name: "iPad", slug: "os_ios_ipad", group: "os", weight: 0 },
    { name: "Для компьютера", slug: "os_comp", group: "os", weight: 0 },
    { name: "Другая", slug: "os_other", group: "os", weight: 0 },
    { name: "Железо", slug: "quest_hardware", group: "quest", weight: 4 },
    { name: "Игры", slug: "quest_games", group: "quest", weight: 4 },
    { name: "Настройка", slug: "quest_settings", group: "quest", weight: 4 },
    { name: "Общение", slug: "quest_talk", group: "quest", weight: 2 },
    { name: "Покупка", slug: "quest_buy", group: "quest", weight: 4 },
    { name: "Программы", slug: "quest_programms", group: "quest", weight: 6 },
    { name: "Прошивка", slug: "quest_firmware", group: "quest", weight: 4 },
    { name: "Темы", slug: "quest_themes", group: "quest", weight: 1 },
    { name: "О сайте", slug: "quest_about", group: "quest", weight: 3 },
    { name: "Конвертирование", slug: "quest_convert", group: "quest", weight: 0 },
  ]);
  const seededTags = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
  const tagById = Object.fromEntries(seededTags.map((t) => [t.slug, t.id]));

  console.log("[seed] topics...");
  const topicSeed = [
    {
      title: "Добро пожаловать на MusorBox",
      body: "Это демонстрационный портал, собранный на Bun, Hono и Drizzle. Здесь можно проверить ленту новостей, форум, комментарии, голосования и профили пользователей.",
      category: "b_news",
      author: "demo",
      votesUp: 5,
      votesDown: 1,
      commentsSeed: [
        { author: "Helper", body: "Отличная работа, лента очень удобная." },
        { author: "Liker", body: "Нравится ретро-дизайн в духе начала 2010-х." },
      ],
    },
    {
      title: "Запуск демонстрационного портала MusorBox",
      body: "MusorBox — учебный проект, повторяющий оформление мобильных порталов начала 2010-х. Разделы «Новости», «Статьи» и «Обзоры» наполнены демонстрационными материалами.",
      category: "b_news",
      author: "admin",
      votesUp: 4,
      votesDown: 0,
      commentsSeed: [
        { author: "Reader", body: "Интересно, а форум тоже полностью рабочий?" },
        { author: "Helper", body: "Да, добавьте топик и убедитесь сами." },
      ],
    },
    {
      title: "Как продлить срок службы аккумулятора",
      body: "Держите уровень заряда в диапазоне 20–80%, избегайте перегрева и раз в пару месяцев проводите полный цикл разряда. А как вы продлеваете жизнь аккумулятору?",
      category: "b_questions",
      author: "demo",
      votesUp: 3,
      votesDown: 0,
      tags: ["os_android", "quest_settings"],
      commentsSeed: [
        { author: "Liker", body: "Очень помогает отключение фоновых приложений." },
        { author: "Newbie", body: "Спасибо, попробую держать заряд в этом диапазоне." },
      ],
    },
    {
      title: "Чем защитить смартфон от вирусов",
      body: "Устанавливайте приложения только из официального каталога и регулярно обновляйте систему. Нужен ли в этом случае отдельный антивирус?",
      category: "b_questions",
      author: "demo",
      votesUp: 2,
      votesDown: 0,
      tags: ["os_android", "quest_programms"],
      commentsSeed: [{ author: "Helper", body: "Базовой защиты достаточно, если не ставить неизвестный софт." }],
    },
    {
      title: "Как выбрать чехол: силикон или пластик",
      body: "Силикон лучше гасит удары при падении, пластик тоньше и дольше держит форму. Что выберете вы?",
      category: "b_questions",
      author: "demo",
      votesUp: 2,
      votesDown: 0,
      tags: ["quest_buy", "quest_hardware"],
      commentsSeed: [
        { author: "Reader", body: "Силикон однозначно — уже дважды ронял аппарат." },
        { author: "Liker", body: "А мне по душе прозрачный пластиковый." },
      ],
    },
    {
      title: "Не работает Wi-Fi после обновления",
      body: "После обновления прошивки планшет перестал видеть домашнюю сеть. Сброс сетевых настроек не помог. Что ещё можно попробовать?",
      category: "b_questions",
      author: "demo",
      votesUp: 1,
      votesDown: 0,
      tags: ["os_android", "quest_settings"],
      commentsSeed: [
        { author: "Helper", body: "Забудьте сеть и подключитесь заново, затем перезагрузите роутер." },
      ],
    },
    {
      title: "Обзор планшета NeoTab A100",
      body: "Демонстрационный обзор бюджетного планшета с 7-дюймовым экраном и 1 ГБ оперативной памяти. Плюсы: невысокая цена и небольшой вес. Минусы: скромная автономность.",
      category: "reviews",
      author: "Helper",
      votesUp: 7,
      votesDown: 2,
      commentsSeed: [{ author: "Reader", body: "Хороший пример оформления обзора, спасибо." }],
    },
    {
      title: "Обзор камерофона с оптическим зумом",
      body: "Демонстрационный материал: сравниваем съёмку днём и в сумерках, оцениваем работу стабилизации и качество зума.",
      category: "reviews",
      author: "demo",
      votesUp: 3,
      votesDown: 0,
    },
    {
      title: "Впечатления от флагманского смартфона",
      body: "Демо-обзор топового устройства: качество экрана, скорость камеры и время работы без подзарядки.",
      category: "reviews",
      author: "demo",
      votesUp: 4,
      votesDown: 1,
    },
    {
      title: "Как продлить жизнь смартфону: десять советов",
      body: "Защитное стекло, чехол, заряд 20–80%, без перегрева на солнце и своевременные обновления системы.",
      category: "b_text",
      author: "admin",
      votesUp: 5,
      votesDown: 0,
      commentsSeed: [{ author: "Moder", body: "Полезная подборка, особенно про перегрев." }],
    },
    {
      title: "Выбираем карту памяти: на что смотреть",
      body: "Скорость чтения, класс записи и объём. Разбираем базовые характеристики и типичные ошибки при покупке.",
      category: "b_text",
      author: "Helper",
      votesUp: 2,
      votesDown: 0,
      commentsSeed: [{ author: "Newbie", body: "Теперь понятно, почему карты так отличаются в цене." }],
    },
    {
      title: "Лучшие бесплатные головоломки недели",
      body: "Подборка несложных головоломок, которые скрасят вечер в дороге или в очереди.",
      category: "games",
      author: "Helper",
      votesUp: 2,
      votesDown: 0,
      commentsSeed: [{ author: "Liker", body: "Классическая 2048 — на все времена." }],
    },
    {
      title: "Топ аркадных гонок для слабых устройств",
      body: "Несколько гонок, которые плавно работают даже на бюджетных устройствах с тусклым железом.",
      category: "games",
      author: "demo",
      votesUp: 1,
      votesDown: 0,
    },
    {
      title: "Что такое разгон и не опасно ли это",
      body: "Разгон повышает производительность, но увеличивает нагрев и расход батареи. Стоит ли овчинка выделки?",
      category: "b_questions",
      author: "demo",
      votesUp: 3,
      votesDown: 0,
      tags: ["quest_hardware", "quest_talk"],
      commentsSeed: [{ author: "Helper", body: "Без острой необходимости лучше не трогать." }],
    },
    {
      title: "Помогите выбрать игровой смартфон по бюджету",
      body: "Нужен аппарат в среднем ценовом сегменте с нормальной игровой производительностью. Что посоветуете?",
      category: "b_questions",
      author: "demo",
      votesUp: 2,
      votesDown: 0,
      tags: ["quest_buy", "quest_games"],
      commentsSeed: [{ author: "Liker", body: "Обратите внимание на прошлогодние флагманы, они сильно дешевле." }],
    },
  ];

  const nowT = Date.now();
  const topicsInsertData = topicSeed.map((t, i) => {
    const ageHours = (topicSeed.length - 1 - i) * 2.2;
    const createdAt = new Date(nowT - ageHours * 3600_000);
    return {
      title: t.title,
      slug: slugify(t.title),
      body: t.body,
      categoryId: catById[t.category]!,
      authorId: userById[t.author]! ?? userById["demo"]!,
      leadImage: null,
      votesUp: t.votesUp,
      votesDown: t.votesDown,
      createdAt,
    };
  });
  await db.insert(topics).values(topicsInsertData);

  const topicRows = await db
    .select({ id: topics.id, title: topics.title, createdAt: topics.createdAt })
    .from(topics);

  const topicByTitle = Object.fromEntries(topicRows.map((t) => [t.title, t.id]));
  const topicDateByTitle = Object.fromEntries(topicRows.map((t) => [t.title, t.createdAt]));

  const topicTagValues: { topicId: number; tagId: number }[] = [];
  for (const t of topicSeed) {
    if (!t.tags) continue;
    const topicId = topicByTitle[t.title]!;
    for (const slug of t.tags) {
      const tagId = tagById[slug]!;
      topicTagValues.push({ topicId, tagId });
      void topicId;
    }
  }
  if (topicTagValues.length) {
    await db.insert(topicTags).values(topicTagValues);
  }

  const commentValues: (typeof comments.$inferInsert)[] = [];
  for (const t of topicSeed) {
    const topicId = topicByTitle[t.title]!;
    let count = 0;
    for (const [j, cm] of (t.commentsSeed ?? []).entries()) {
      const topicDate = (topicDateByTitle[t.title] ?? new Date()) as Date;
      commentValues.push({
        topicId,
        parentId: null,
        authorId: userById[cm.author] ?? userById["demo"]!,
        body: cm.body,
        votesUp: [0, 2, 1, 3, 1, 0, 2, 1, 4, 0][j % 10],
        votesDown: j % 3 === 0 ? 1 : 0,
        createdAt: new Date(topicDate.getTime() + (j + 1) * 37 * 60_000),
      });
      count++;
    }
    if (count > 0) {
      await db.update(topics).set({ commentCount: count }).where(eq(topics.id, topicId));
    }
  }
  if (commentValues.length) {
    await db.insert(comments).values(commentValues);
  }

  const userCount = seededUsers.length;
  console.log(`[seed] done: ${userCount} users, ${categorySeedCount} categories, ${topicRows.length} topics, ${commentValues.length} comments`);
}

const categorySeedCount = 8;
seed().then(() => {
  console.log("[seed] complete");
  process.exit(0);
}).catch((e) => {
  console.error("[seed] failed", e);
  process.exit(1);
});