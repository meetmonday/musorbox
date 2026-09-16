import { getDrizzle } from "../src/core/db";
import { tags, topicTags, categories } from "../src/core/schema";
import { seedCategories, seedTags } from "../src/core/seed";

const db = getDrizzle();

console.log("[seed:structure] очищаю categories/tags/topic_tags...");
await db.delete(topicTags);
await db.delete(tags);
await db.delete(categories);

const catById = await seedCategories();
const tagById = await seedTags();

const catCount = Object.keys(catById).length;
const tagCount = Object.keys(tagById).length;
console.log(`[seed:structure] готово: разделов=${catCount}, тегов=${tagCount}`);
process.exit(0);