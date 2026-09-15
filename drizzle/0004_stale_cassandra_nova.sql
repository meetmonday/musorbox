CREATE TABLE `ap_following` (
	`local_user_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	PRIMARY KEY(`local_user_id`, `actor_id`),
	FOREIGN KEY (`local_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `ap_actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ap_following_actor_idx` ON `ap_following` (`actor_id`);