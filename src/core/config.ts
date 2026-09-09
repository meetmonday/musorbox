export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./trashbox.db",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  sessionTtlDays: 7,
  pageSize: Number(process.env.PAGE_SIZE ?? 20),
  mainPageSize: Number(process.env.MAIN_PAGE_SIZE ?? 10),
  siteName: "Trashbox.ru",
  siteTagline: "лучший мобильный портал",
  copyrightStart: 2008,
  copyrightOwner: "Бобылёв.ру",
};