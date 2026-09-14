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
  /**
   * Hostnames (lowercased) that may be fetched over plain http for remote actors.
   * Defaults to the loopback hosts so local dev federation works out of the box.
   * Set `AP_ALLOW_INSECURE_HOSTS` to override; an explicitly-set empty string
   * disables plain-http fetches entirely (https-only), which is the recommended
   * production setting.
   */
  allowInsecureFetchHosts: (() => {
    const raw = process.env.AP_ALLOW_INSECURE_HOSTS;
    if (raw === undefined) return ["localhost", "127.0.0.1", "::1"];
    return raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  })(),
};