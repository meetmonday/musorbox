PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`parent_id` integer,
	`author_id` integer,
	`remote_actor_id` integer,
	`body` text NOT NULL,
	`ap_url` text,
	`votes_up` integer DEFAULT 0 NOT NULL,
	`votes_down` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`remote_actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_comments`("id", "topic_id", "parent_id", "author_id", "remote_actor_id", "body", "ap_url", "votes_up", "votes_down", "created_at") SELECT `id`, `topic_id`, `parent_id`, `author_id`, NULL, `body`, `ap_url`, `votes_up`, `votes_down`, `created_at` FROM `comments`;--> statement-breakpoint
DROP TABLE `comments`;--> statement-breakpoint
ALTER TABLE `__new_comments` RENAME TO `comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Migrate comments authored by auto-mirrored remote users (fed_*) to the new
-- remote_actor_id reference, then drop the ghost/mirror accounts.
UPDATE `comments` SET
	`remote_actor_id` = (SELECT `a`.`id` FROM `ap_actors` AS `a` WHERE `a`.`local_user_id` = `comments`.`author_id` LIMIT 1)
WHERE `author_id` IN (SELECT `id` FROM `users` WHERE `username` LIKE 'fed\_%' ESCAPE '\')
	AND (SELECT `id` FROM `ap_actors` AS `a` WHERE `a`.`local_user_id` = `comments`.`author_id` LIMIT 1) IS NOT NULL;--> statement-breakpoint
UPDATE `comments` SET
	`author_id` = NULL
WHERE `author_id` IN (SELECT `id` FROM `users` WHERE `username` LIKE 'fed\_%' ESCAPE '\')
	AND `remote_actor_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `users`
WHERE `username` LIKE 'fed\_%' ESCAPE '\'
	AND `id` NOT IN (SELECT DISTINCT `author_id` FROM `comments` WHERE `author_id` IS NOT NULL);--> statement-breakpoint
CREATE INDEX `comments_topic_idx` ON `comments` (`topic_id`);--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `comments_author_idx` ON `comments` (`author_id`);--> statement-breakpoint
CREATE INDEX `comments_remote_actor_idx` ON `comments` (`remote_actor_id`);--> statement-breakpoint
CREATE INDEX `comments_ap_url_idx` ON `comments` (`ap_url`);