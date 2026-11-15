CREATE TABLE `message_bot_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_user_id` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`bot_user_id`) REFERENCES `message_bots`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_bot_updates_bot_id_idx` ON `message_bot_updates` (`bot_user_id`,`id`);--> statement-breakpoint
CREATE TABLE `message_bots` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_bots_token_hash_idx` ON `message_bots` (`token_hash`);