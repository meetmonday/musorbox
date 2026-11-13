CREATE TABLE `message_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_low_id` integer NOT NULL,
	`user_high_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_low_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_high_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_conversations_order_check" CHECK("message_conversations"."user_low_id" < "message_conversations"."user_high_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_conversations_pair_idx` ON `message_conversations` (`user_low_id`,`user_high_id`);--> statement-breakpoint
CREATE INDEX `message_conversations_low_updated_idx` ON `message_conversations` (`user_low_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `message_conversations_high_updated_idx` ON `message_conversations` (`user_high_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `private_messages` (
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
	CONSTRAINT "private_messages_users_check" CHECK("private_messages"."sender_id" <> "private_messages"."recipient_id"),
	CONSTRAINT "private_messages_body_check" CHECK(length("private_messages"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE INDEX `private_messages_conversation_idx` ON `private_messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `private_messages_recipient_read_idx` ON `private_messages` (`recipient_id`,`read_at`,`id`);--> statement-breakpoint
CREATE INDEX `private_messages_sender_created_idx` ON `private_messages` (`sender_id`,`created_at`);