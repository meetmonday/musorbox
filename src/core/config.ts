export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./musorbox.db",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  sessionTtlDays: 7,
  pageSize: Number(process.env.PAGE_SIZE ?? 20),
  mainPageSize: Number(process.env.MAIN_PAGE_SIZE ?? 10),
  siteName: "MusorBox",
  siteTagline: "мобильный портал",
  copyrightStart: 2025,
  copyrightOwner: "MusorBox",
  contactEmail: "hello@musorbox.example",
  baseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${Number(process.env.PORT ?? 3000)}`).replace(/\/+$/, ""),
};