-- Backfill the source-backed Principles component for existing Dawn Starter
-- workspaces. Existing component files and custom manifest mappings are never
-- overwritten.
INSERT INTO `storefront_theme_files` (
  `id`,
  `storefront_id`,
  `theme_id`,
  `path`,
  `content`,
  `mime_type`,
  `is_entry`,
  `version`,
  `created_at`,
  `updated_at`,
  `deleted_at`
)
SELECT
  'starter-principles-' || lower(hex(randomblob(16))),
  manifest.`storefront_id`,
  manifest.`theme_id`,
  'src/components/Principles.tsx',
  'export type PrincipleItem = {
  number?: string;
  title?: string;
  body?: string;
};

export type PrinciplesProps = {
  items?: PrincipleItem[];
};

export default function Principles({ items = [] }: PrinciplesProps) {
  return (
    <section
      data-morph-section="principles"
      data-morph-node="principles-root"
      className="bg-stone-50 px-[clamp(1.75rem,6vw,6rem)] py-[clamp(6rem,10vw,9rem)]"
    >
      <p
        data-morph-node="principles-label"
        data-morph-element="label"
        className="mb-14 text-xs font-medium uppercase tracking-[0.22em] text-stone-500"
      >
        Why we choose differently
      </p>
      <div
        data-morph-node="principles-grid"
        data-morph-element="grid"
        className="grid border-t border-stone-300 lg:grid-cols-3"
      >
        {items.map((item, idx) => (
          <article
            key={item.number ?? idx}
            data-morph-node="principle-card"
            data-morph-element="principle-card"
            className="border-b border-stone-300 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0"
          >
            <span
              data-morph-node="principle-number"
              data-morph-element="number"
              className="text-xs text-stone-400"
            >
              {item.number ?? ("0" + (idx + 1))}
            </span>
            <h3
              data-morph-node="principle-title"
              data-morph-element="title"
              className="mt-12 font-serif text-3xl tracking-tight text-stone-950"
            >
              {item.title ?? ""}
            </h3>
            <p
              data-morph-node="principle-body"
              data-morph-element="body"
              className="mt-4 max-w-sm text-sm leading-6 text-stone-600"
            >
              {item.body ?? ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
',
  'text/typescript',
  0,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
FROM `storefront_theme_files` AS manifest
WHERE manifest.`path` = 'morph.theme.json'
  AND manifest.`deleted_at` IS NULL
  AND json_valid(manifest.`content`)
  AND json_extract(manifest.`content`, '$.name') = 'Dawn Starter'
  AND NOT EXISTS (
    SELECT 1
    FROM `storefront_theme_files` AS existing
    WHERE existing.`theme_id` = manifest.`theme_id`
      AND existing.`path` = 'src/components/Principles.tsx'
      AND existing.`deleted_at` IS NULL
  );
--> statement-breakpoint
UPDATE `storefront_theme_files`
SET
  `content` = json_insert(
    `content`,
    '$.components."principles.default"',
    json('{"name":"Principles","source":"src/components/Principles.tsx","sectionType":"principles"}'),
    '$.sections.principles',
    json('{"componentRef":"principles.default","source":"src/components/Principles.tsx"}')
  ),
  `version` = `version` + 1,
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `path` = 'morph.theme.json'
  AND `deleted_at` IS NULL
  AND json_valid(`content`)
  AND json_extract(`content`, '$.name') = 'Dawn Starter'
  AND (
    json_type(`content`, '$.components."principles.default"') IS NULL
    OR json_type(`content`, '$.sections.principles') IS NULL
  );
--> statement-breakpoint
UPDATE `storefront_themes`
SET
  `source_generation` = `source_generation` + 1,
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `storefront_theme_files` AS manifest
    WHERE manifest.`theme_id` = `storefront_themes`.`id`
      AND manifest.`path` = 'morph.theme.json'
      AND manifest.`deleted_at` IS NULL
      AND json_valid(manifest.`content`)
      AND json_extract(manifest.`content`, '$.name') = 'Dawn Starter'
  );
