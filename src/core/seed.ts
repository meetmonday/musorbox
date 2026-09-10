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
  await db.insert(users).values([
    {
      username: "Bobs",
      passwordHash: await hash("secret", 10),
      fullName: "Александр Бобылёв",
      role: "editor",
      avatarUrl: "/avatars/152564_ca6ee9_avatar_PKH1.png",
      country: "Украина",
      city: "Днепропетровск",
      vkUrl: "http://vk.com/alex.bobs",
      twitterUrl: "http://twitter.com/bobylov/",
      skype: "alex.bobs",
      devices: "ASUS TF701T, Samsung S4 Mini, Nokia N9",
      ratingOptout: true,
    },
    {
      username: "Vincent_Vega",
      passwordHash: await hash("secret", 10),
      role: "author",
      avatarUrl: "/avatars/44889_6cf6b5_avatar_siAb.png",
      fullName: "Vincent Vega",
      country: "Россия",
    },
    {
      username: "JAC",
      passwordHash: await hash("secret", 10),
      role: "user",
      avatarUrl: "/avatars/46452_4e4eb2_avatar.png_min_Hroe.png",
    },
    {
      username: "demo",
      passwordHash: await hash("demo123", 10),
      role: "user",
    },
    {
      username: "xX_Jhonny_Xx",
      passwordHash: await hash("secret", 10),
      role: "user",
      avatarUrl: "/avatars/162782_3f2050_avatar.png_min_Hroe.png",
    },
    {
      username: "iNeed_a_phone",
      passwordHash: await hash("secret", 10),
      role: "user",
      avatarUrl: "/avatars/199420_082db8_avatar.png_min_PKH1.png",
    },
    {
      username: "Android_Fan666",
      passwordHash: await hash("secret", 10),
      role: "user",
      avatarUrl: "/avatars/5054_6327bf_avatar.png_min_siAb.png",
    },
  ]);
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
    { name: "Трешбокс", slug: "quest_trashbox", group: "quest", weight: 3 },
    { name: "Конвертирование", slug: "quest_convert", group: "quest", weight: 0 },
  ]);
  const seededTags = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
  const tagById = Object.fromEntries(seededTags.map((t) => [t.slug, t.id]));

  console.log("[seed] topics...");
  const topicSeed = [
    {
      title: "Samsung рассылает приглашения на свою конференцию Unpacked",
      body: "Samsung начала рассылать приглашения на свою конференцию Unpacked, которая состоится в рамках выставки IFA 2013. Мероприятие назначено на 4 сентября. На приглашении изображена ручка, рисующая слово Note, что намекает на анонс планшетофона Galaxy Note III.",
      category: "b_news",
      author: "Vincent_Vega",
      leadImage: "/images/unpacked_event_full.png",
      votesUp: 3,
      votesDown: 1,
      commentsSeed: [
        { author: "Bobs", body: "судя по всему, будут новые note 3 и Note 2 10.1, при этом на десятидюймовой версии будет FullHD" },
      ],
    },
    {
      title: "Как получить рут на нексусе",
      body: "Как получить рут на планшете Нексус 7(2012)",
      category: "b_questions",
      author: "demo",
      votesUp: 2,
      votesDown: 0,
      tags: ["os_android", "quest_hardware", "quest_settings", "quest_firmware"],
      commentsSeed: [
        { author: "JAC", body: "Nexus Root Toolkit" },
        { author: "Bobs", body: "Рут — это не страшно, если знать что делаешь." },
      ],
    },
    {
      title: "Помогите выбрать ОС и смартфон",
      body: "Стоит задача выбрать смартфон и операционную систему. Что посоветуете?",
      category: "b_questions",
      author: "demo",
      votesUp: 5,
      votesDown: 0,
      tags: ["os_android", "quest_buy", "quest_hardware"],
    },
    {
      title: "Обзор планшета Lenovo IdeaTab A1000",
      body: "Сегодня мы рассмотрим бюджетный планшет Lenovo IdeaTab A1000. Устройство получило 7-дюймовый экран с разрешением 1024x600, двухъядерный процессор MediaTek 8317 и 1 ГБ оперативной памяти.",
      category: "reviews",
      author: "Vincent_Vega",
      votesUp: 7,
      votesDown: 2,
    },
    {
      title: "NVIDIA связывает провал Microsoft Surface со своим падением выручки",
      body: "Компания NVIDIA объяснила падение выручки неудачными продажами планшета Microsoft Surface RT, который работает на базе процессора Tegra.",
      category: "b_news",
      author: "Vincent_Vega",
      votesUp: 4,
      votesDown: 0,
    },
    {
      title: "Как поставить Windows Phone на Nokia Lumia",
      body: "Пытаюсь перепрошить Lumia 920 на актуальную прошивку. Кто-нибудь сталкивался?",
      category: "b_questions",
      author: "demo",
      votesUp: 1,
      votesDown: 0,
      tags: ["os_wp8", "quest_firmware"],
      commentsSeed: [{ author: "Bobs", body: "Через Nokia Software Recovery Tool, всё штатно." }],
    },
    {
      title: "Что лучше: iPhone 5 или Samsung Galaxy S4",
      body: "Не могу определиться между iPhone 5 и Galaxy S4. Что брать?",
      category: "b_questions",
      author: "JAC",
      votesUp: 8,
      votesDown: 3,
      tags: ["os_ios_phone", "os_android", "quest_buy"],
      commentsSeed: [
        { author: "demo", body: "S4, естественно. Экран и батарея у него заметно лучше." },
        { author: "Bobs", body: "Зависит от экосистемы. Если уже есть iCloud и Mac — берите iPhone." },
      ],
    },
    {
      title: "Не работает Wi-Fi после прошивки",
      body: "После прошивки на планшете отвалился Wi-Fi. Что делать?",
      category: "b_questions",
      author: "demo",
      votesUp: 0,
      votesDown: 0,
      tags: ["os_android", "quest_firmware"],
    },
    {
      title: "Посоветуйте игры под Android",
      body: "Нужны хорошие игры для Nexus 7. Интересуют гонки и головоломки.",
      category: "b_questions",
      author: "demo",
      votesUp: 3,
      votesDown: 0,
      tags: ["os_android", "quest_games"],
      commentsSeed: [{ author: "JAC", body: "Real Racing 3 и 2048 — то что надо." }],
    },
    {
      title: "Как убрать вирус с телефона",
      body: "Подхватил рекламный вирус, баннеры поверх всех приложений. Как лечится?",
      category: "b_questions",
      author: "demo",
      votesUp: 2,
      votesDown: 0,
      tags: ["os_android", "quest_programms"],
      commentsSeed: [{ author: "Bobs", body: "Dr.Web Light + сброс до заводских настроек." }],
    },
    {
      title: "Темы для Symbian Belle",
      body: "Где можно скачать нормальные темы для Symbian Belle?",
      category: "b_questions",
      author: "demo",
      votesUp: 1,
      votesDown: 0,
      tags: ["os_symbian9", "quest_themes"],
    },
    {
      title: "Установка скинов для Windows Mobile",
      body: "Подскажите, как ставить темы на WM 6.5?", 
      category: "b_questions",
      author: "demo",
      votesUp: 0,
      votesDown: 0,
      tags: ["os_wm", "quest_themes"],
    },
    {
      title: "Растаможка смартфона из США",
      body: "Кто-нибудь заказывал смартфон из США? Не дорого выходит с доставкой?",
      category: "b_questions",
      author: "demo",
      votesUp: 2,
      votesDown: 0,
      tags: ["os_other", "quest_buy"],
    },
    {
      title: "Чем можно конвертировать видео для планшета",
      body: "Нужен конвертер видео под железо планшета, чтобы игралось без тормозов.",
      category: "b_questions",
      author: "demo",
      votesUp: 1,
      votesDown: 0,
      tags: ["os_android", "quest_convert"],
    },
    {
      title: "Флейм про Apple и Android",
      body: "Так всё-таки, что круче: труъ-интеграция Apple или открытость Android?",
      category: "b_questions",
      author: "JAC",
      votesUp: 6,
      votesDown: 5,
      tags: ["os_ios_phone", "os_android", "quest_talk"],
      commentsSeed: [{ author: "demo", body: "Начинается... Опять сорок навсегда." }],
    },
    {
      title: "HTC One мини в России: стоит ли брать",
      body: "Вышла официальная версия HTC One mini на нашем рынке. Стоит ли брать, или лучше подождать снижения цены?",
      category: "b_news",
      author: "Vincent_Vega",
      votesUp: 3,
      votesDown: 0,
    },
    {
      title: "Обзор Nokia Lumia 1020",
      body: "Знакомимся с камерофоном Nokia Lumia 1020. 41-мегапиксельный модуль PureView, оптическая стабилизация и Windows Phone 8 в одном корпусе.",
      category: "reviews",
      author: "Bobs",
      votesUp: 9,
      votesDown: 0,
    },
    {
      title: "Как обойтись без статистики в Android",
      body: "Список полезных программ для экономии трафика и мониторинга расхода батареи.",
      category: "b_text",
      author: "Bobs",
      votesUp: 5,
      votesDown: 1,
    },
    {
      title: "Лучшие бесплатные игры недели",
      body: "Подборка бесплатных игр для мобильных устройств за прошедшую неделю.",
      category: "games",
      author: "JAC",
      votesUp: 2,
      votesDown: 0,
    },
    {
      title: "Скачал тему для Android — теперь не запускается лаунчер",
      body: "После установки темы лаунчер отваливается. Как откатить?",
      category: "b_questions",
      author: "demo",
      votesUp: 0,
      votesDown: 0,
      tags: ["os_android", "quest_themes"],
    },
    {
      title: "Аномальное потребление батареи на S4",
      body: "Galaxy S4 разряжается за 6 часов в режиме ожидания. Что может жрать?",
      category: "b_questions",
      author: "demo",
      votesUp: 1,
      votesDown: 0,
      tags: ["os_android", "quest_settings"],
      commentsSeed: [{ author: "xX_Jhonny_Xx", body: "Проверь Google Play Services через BatteryStats." }],
    },
  ];

  const topicsInsertData = topicSeed.map((t) => ({
    title: t.title,
    slug: slugify(t.title),
    body: t.body,
    categoryId: catById[t.category]!,
    authorId: userById[t.author]! ?? userById["demo"]!,
    leadImage: t.leadImage,
    votesUp: t.votesUp,
    votesDown: t.votesDown,
  }));
  await db.insert(topics).values(topicsInsertData);

  const topicRows = await db
    .select({ id: topics.id, title: topics.title })
    .from(topics);

  const topicByTitle = Object.fromEntries(topicRows.map((t) => [t.title, t.id]));

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
    for (const cm of t.commentsSeed ?? []) {
      commentValues.push({
        topicId,
        parentId: null,
        authorId: userById[cm.author] ?? userById["demo"]!,
        body: cm.body,
        votesUp: 0,
        votesDown: 0,
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