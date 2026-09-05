-- A deployment holds this for the whole activate-and-deploy sequence.
--
-- The activation CAS only guards the moment the active pointer moves. It does
-- not span the deploy that follows, so a second request reading the freshly
-- written pointer passes its own CAS and deploys concurrently: the pointer ends
-- up naming one release while the Worker runs whichever upload finished last.
--
-- The expiry is what keeps a crashed holder from wedging the storefront; it is
-- a bound on how long a lost deployment blocks the next one, not a timeout for
-- the deploy itself.
ALTER TABLE `storefronts` ADD `deployment_lease_owner` text;--> statement-breakpoint
ALTER TABLE `storefronts` ADD `deployment_lease_expires_at` integer;
