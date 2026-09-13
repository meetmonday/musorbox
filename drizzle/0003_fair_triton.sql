ALTER TABLE `comments` ADD `ap_url` text;--> statement-breakpoint
CREATE INDEX `comments_ap_url_idx` ON `comments` (`ap_url`);