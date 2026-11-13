CREATE TABLE `message_group_members` (
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_message_id` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `message_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_group_members_user_idx` ON `message_group_members` (`user_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `message_group_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`sender_id` integer,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `message_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "message_group_messages_body_check" CHECK(length("message_group_messages"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE INDEX `message_group_messages_group_idx` ON `message_group_messages` (`group_id`,`id`);--> statement-breakpoint
CREATE INDEX `message_group_messages_sender_created_idx` ON `message_group_messages` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `message_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`owner_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_groups_title_check" CHECK(length("message_groups"."title") between 2 and 80)
);
--> statement-breakpoint
CREATE INDEX `message_groups_owner_idx` ON `message_groups` (`owner_id`);--> statement-breakpoint
CREATE INDEX `message_groups_updated_idx` ON `message_groups` (`updated_at`);