CREATE TABLE `tg_comments` (
	`comment_id` integer PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`tg_user_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tg_comments_chat_msg_idx` ON `tg_comments` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `tg_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tg_threads` (
	`topic_id` integer PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`message_thread_id` integer NOT NULL,
	`thread_name` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tg_threads_chat_thread_idx` ON `tg_threads` (`chat_id`,`message_thread_id`);--> statement-breakpoint
CREATE TABLE `tg_users` (
	`tg_user_id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`username` text,
	`first_name` text,
	`last_name` text,
	`linked_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tg_users_user_idx` ON `tg_users` (`user_id`);