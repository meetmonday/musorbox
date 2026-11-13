ALTER TABLE `message_groups` ADD `invite_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `message_groups_invite_token_idx` ON `message_groups` (`invite_token`);