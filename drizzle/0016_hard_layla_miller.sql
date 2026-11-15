CREATE TABLE `message_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`private_message_id` integer,
	`group_message_id` integer,
	`position` integer NOT NULL,
	`storage_key` text NOT NULL,
	`thumbnail_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`private_message_id`) REFERENCES `private_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_message_id`) REFERENCES `message_group_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_images_owner_check" CHECK(("message_images"."private_message_id" is not null and "message_images"."group_message_id" is null) or ("message_images"."private_message_id" is null and "message_images"."group_message_id" is not null)),
	CONSTRAINT "message_images_position_check" CHECK("message_images"."position" between 0 and 9),
	CONSTRAINT "message_images_dimensions_check" CHECK("message_images"."width" > 0 and "message_images"."height" > 0),
	CONSTRAINT "message_images_size_check" CHECK("message_images"."size_bytes" > 0 and "message_images"."size_bytes" <= 20971520)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_images_storage_key_unique` ON `message_images` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_images_thumbnail_key_unique` ON `message_images` (`thumbnail_key`);--> statement-breakpoint
CREATE INDEX `message_images_private_idx` ON `message_images` (`private_message_id`,`position`);--> statement-breakpoint
CREATE INDEX `message_images_group_idx` ON `message_images` (`group_message_id`,`position`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_group_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`sender_id` integer,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `message_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "message_group_messages_body_check" CHECK(length("__new_message_group_messages"."body") between 0 and 4000)
);
--> statement-breakpoint
INSERT INTO `__new_message_group_messages`("id", "group_id", "sender_id", "body", "created_at") SELECT "id", "group_id", "sender_id", "body", "created_at" FROM `message_group_messages`;--> statement-breakpoint
DROP TABLE `message_group_messages`;--> statement-breakpoint
ALTER TABLE `__new_message_group_messages` RENAME TO `message_group_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `message_group_messages_group_idx` ON `message_group_messages` (`group_id`,`id`);--> statement-breakpoint
CREATE INDEX `message_group_messages_sender_created_idx` ON `message_group_messages` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_private_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`sender_id` integer NOT NULL,
	`recipient_id` integer NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `message_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "private_messages_users_check" CHECK("__new_private_messages"."sender_id" <> "__new_private_messages"."recipient_id"),
	CONSTRAINT "private_messages_body_check" CHECK(length("__new_private_messages"."body") between 0 and 4000)
);
--> statement-breakpoint
INSERT INTO `__new_private_messages`("id", "conversation_id", "sender_id", "recipient_id", "body", "read_at", "created_at") SELECT "id", "conversation_id", "sender_id", "recipient_id", "body", "read_at", "created_at" FROM `private_messages`;--> statement-breakpoint
DROP TABLE `private_messages`;--> statement-breakpoint
ALTER TABLE `__new_private_messages` RENAME TO `private_messages`;--> statement-breakpoint
CREATE INDEX `private_messages_conversation_idx` ON `private_messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `private_messages_recipient_read_idx` ON `private_messages` (`recipient_id`,`read_at`,`id`);--> statement-breakpoint
CREATE INDEX `private_messages_sender_created_idx` ON `private_messages` (`sender_id`,`created_at`);