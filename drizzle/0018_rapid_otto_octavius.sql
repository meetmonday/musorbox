ALTER TABLE `message_bots` ADD `owner_user_id` integer REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `message_bots` ADD `disabled_at` integer;--> statement-breakpoint
CREATE INDEX `message_bots_owner_idx` ON `message_bots` (`owner_user_id`,`created_at`);
