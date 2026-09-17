CREATE TABLE `mod_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`moderator_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`moderator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mod_log_created_idx` ON `mod_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`actor_id` integer,
	`remote_actor_id` integer,
	`type` text NOT NULL,
	`topic_id` integer,
	`comment_id` integer,
	`message` text,
	`event_key` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`remote_actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_idx` ON `notifications` (`user_id`,`event_key`);--> statement-breakpoint
ALTER TABLE `comments` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `topics` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `banned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `users` ADD `banned_at` integer;