CREATE TABLE `ap_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`actor_id` integer,
	`object` text,
	`target_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ap_actors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`remote_id` text NOT NULL,
	`preferred_username` text NOT NULL,
	`host` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`inbox_url` text,
	`shared_inbox_url` text,
	`public_key_pem` text NOT NULL,
	`local_user_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`local_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ap_actors_remote_id_idx` ON `ap_actors` (`remote_id`);--> statement-breakpoint
CREATE INDEX `ap_actors_host_idx` ON `ap_actors` (`host`);--> statement-breakpoint
CREATE INDEX `ap_actors_local_user_idx` ON `ap_actors` (`local_user_id`);--> statement-breakpoint
CREATE TABLE `ap_followers` (
	`local_user_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	PRIMARY KEY(`local_user_id`, `actor_id`),
	FOREIGN KEY (`local_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ap_followers_actor_idx` ON `ap_followers` (`actor_id`);--> statement-breakpoint
CREATE TABLE `ap_keys` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`private_key_pem` text NOT NULL,
	`public_key_pem` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
