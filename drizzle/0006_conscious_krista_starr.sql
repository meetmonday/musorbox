CREATE TABLE `ap_mentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer NOT NULL,
	`target_local_user_id` integer NOT NULL,
	`object_url` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_local_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ap_mentions_actor_target_object_idx` ON `ap_mentions` (`actor_id`,`target_local_user_id`,`object_url`);--> statement-breakpoint
CREATE INDEX `ap_mentions_target_user_idx` ON `ap_mentions` (`target_local_user_id`);--> statement-breakpoint
CREATE TABLE `ap_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer NOT NULL,
	`type` text NOT NULL,
	`object_url` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ap_reactions_actor_type_object_idx` ON `ap_reactions` (`actor_id`,`type`,`object_url`);--> statement-breakpoint
CREATE INDEX `ap_reactions_object_idx` ON `ap_reactions` (`object_url`);--> statement-breakpoint
ALTER TABLE `ap_actors` ADD `deleted_at` integer;