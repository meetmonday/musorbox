ALTER TABLE `ap_reactions` ADD `activity_id` text;--> statement-breakpoint
CREATE INDEX `ap_reactions_activity_idx` ON `ap_reactions` (`activity_id`);