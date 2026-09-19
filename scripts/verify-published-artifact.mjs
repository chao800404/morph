/**
 * Reads back what a publish actually produced, through the same local bindings
 * the Worker wrote it with.
 *
 * The end-to-end suite can see that the editor says "Published" and that the
 * history panel marks a release live. Neither statement is evidence that the
 * release points at a build, that the build's artifact is intact, or that the
 * artifact runs — and in local development it cannot be, because
 * `OperatorManagedThemeWorkerDeployer` reports every deployment as successful
 * without reading the request. Its own docblock is honest about why: this is not
 * a stub, it is a topology where deployment is the operator's step. So the
 * operator's step is what this file performs, and then checks.
 *
 * Read-only, and deliberately after the publish has settled. Wrangler's local
 * D1 has a history of `SQLITE_BUSY`/`SQLITE_LOCKED` under concurrent access, and
 * a second Miniflare instance opened while a build is still writing would be
 * inventing a race this run does not need.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const HANDOFF_SCHEMA_VERSION = 1;

/**
 * Bindings declared on their own rather than read from `wrangler.jsonc`.
 *
 * `getPlatformProxy` refuses that file outright: it resolves container images
 * and asserts `Build ID should be set if containers are defined and enabled`,
 * and the app's config defines the Sandbox container. Passing
 * `environment: "local_preview_e2e"` does get past it — containers are not
 * inherited by named environments — but the publish slice runs the container
 * transport, which is the default environment, so that escape does not cover the
 * case this file exists for.
 *
 * Declaring the two bindings here reaches the same stored data, because local
 * storage is keyed by the database and bucket names, not by which config named
 * them. It also keeps this verifier from breaking every time the app's config
 * grows a binding it does not read.
 */
function verifierConfig() {
  return {
    name: "morph-e2e-artifact-verifier",
    compatibility_date: "2026-03-24",
    d1_databases: [
      {
        binding: "DATABASE",
        database_name: "morph-d1-global",
        database_id: "43d5c881-bd19-4020-92cc-3945d8b5cb39",
      },
    ],
    r2_buckets: [{ binding: "R2_BUCKET", bucket_name: "morph-r2-global" }],
  };
}

/**
 * The published state, in one read.
 *
 * One JOIN rather than three lookups: the pointer, the release it names and the
 * build that release was cut from have to agree at a single instant, and three
 * sequential reads could each be right about a different one.
 *
 * `content_publication_id` comes back with it because the edit this run made is
 * published through a content publication, not baked into the artifact — see
 * below. `source_revision_id` is the theme's *source* revision, which is what the
 * build was cut from; it is reported for context and is deliberately not where
 * the edit is looked for.
 *
 * `isolation` is not here, and cannot be — no migration defines such a column.
 * Which build plane ran is reported by `theme-build.service.ts` on a
 * `storefront.theme.build.timings` line instead, and the runner asserts it from
 * there.
 */
const PUBLISHED_STATE_SQL = `
  SELECT
    s.active_release_id AS active_release_id,
    r.id                AS release_id,
    r.theme_id          AS theme_id,
    r.theme_build_id    AS theme_build_id,
    r.source_revision_id AS source_revision_id,
    r.content_publication_id AS content_publication_id,
    b.status            AS build_status,
    b.artifact_prefix   AS artifact_prefix
  FROM storefronts s
  JOIN storefront_releases r ON r.id = s.active_release_id
  JOIN storefront_theme_builds b ON b.id = r.theme_build_id
  WHERE s.id = ?
`;

/**
 * Resolves a manifest path inside the reconstruction root, or refuses.
 *
 * The manifest decides which files get written and where, so it decides what
 * this process overwrites. An absolute path, or one that climbs out with `..`,
 * would land outside the run's temporary directory — and the artifact store
 * already guards the other direction of this (`ARTIFACT_CONTAINMENT_BREACH` on
 * the way in), so the same containment is owed on the way out.
 */
export function containedPath(root, relative) {
  if (path.isAbsolute(relative)) {
    throw new Error(`ARTIFACT_PATH_ABSOLUTE: ${relative}`);
  }
  const resolved = path.resolve(root, relative);
  const boundary = path.resolve(root) + path.sep;
  if (!resolved.startsWith(boundary)) {
    throw new Error(`ARTIFACT_PATH_ESCAPES_ROOT: ${relative}`);
  }
  return resolved;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Writes the wrangler config a reconstructed artifact needs to run.
 *
 * The artifact carries none. That was a surprise worth recording: it holds
 * `runtime/server/index.js`, `runtime/client/...` and a preview bundle, and no
 * wrangler config anywhere — because the real deployer composes one in the
 * sandbox from its deployment plan and writes it beside the server entry before
 * calling `wrangler deploy`. So the harness has to do the same thing to start it.
 *
 * The parts that describe the artifact are taken from the artifact's own
 * manifest, which is where `planThemeWorkerDeployment` takes them from too:
 * `runtime.workerEntry` and `runtime.clientAssetsDirectory`. The layout is
 * therefore the build's, not this file's guess.
 *
 * The compatibility date and flags are this file's own, and that is the one place
 * the harness's config is not the deployer's. A real deployment reads them from
 * the theme's wrangler config, which the artifact does not contain. So a theme
 * that needed some other flag could run here and fail on a real deploy; what this
 * establishes is that the published bytes execute and render, not that they would
 * deploy under the theme's own compatibility settings.
 */
async function writeWorkerConfig(root, manifest, scriptName) {
  const runtime = manifest.runtime;
  if (!runtime || runtime.kind !== "cloudflare-worker") {
    throw new Error(
      `ARTIFACT_NOT_A_WORKER: the manifest declares runtime kind "${runtime?.kind ?? "none"}", so this artifact is not a Theme runtime that can be started.`,
    );
  }
  const workerEntry = runtime.workerEntry?.replace(/\\/g, "/");
  if (!workerEntry) {
    // The same precondition `planThemeWorkerDeployment` fails on, checked here so
    // the harness refuses for the deployer's reason rather than a missing file.
    throw new Error(
      "MISSING_WORKER_ENTRY: the build manifest declares no Worker entry, so this artifact is not deployable.",
    );
  }
  if (!manifest.files.some((file) => file.path === workerEntry)) {
    throw new Error(
      `MISSING_WORKER_ENTRY: the manifest names "${workerEntry}" as the Worker entry and does not list it among its files.`,
    );
  }

  const serverDirectory = path.posix.dirname(workerEntry);
  const clientDirectory = (runtime.clientAssetsDirectory ?? "runtime/client")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const configPath = containedPath(
    root,
    path.posix.join(serverDirectory, "wrangler.json"),
  );

  await writeFile(
    configPath,
    JSON.stringify(
      {
        name: scriptName,
        main: path.posix.basename(workerEntry),
        compatibility_date: "2026-03-24",
        compatibility_flags: ["nodejs_compat"],
        // Relative to the config's own directory, the way the deployer writes it.
        assets: {
          directory: path.posix.relative(serverDirectory, clientDirectory),
        },
      },
      null,
      2,
    ),
  );
  return configPath;
}

export async function verifyPublishedArtifact({ handoffPath, persistTo, outDir }) {
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  if (handoff.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    throw new Error(
      `HANDOFF_SCHEMA_MISMATCH: expected ${HANDOFF_SCHEMA_VERSION}, found ${handoff.schemaVersion}. The spec and this verifier are out of step.`,
    );
  }
  for (const field of ["marker", "releaseLabel", "storefrontId", "themeId"]) {
    if (typeof handoff[field] !== "string" || handoff[field].trim() === "") {
      throw new Error(`HANDOFF_INCOMPLETE: ${field} is missing.`);
    }
  }

  const { getPlatformProxy } = await import("wrangler");
  const configPath = path.join(outDir, "..", "verifier.wrangler.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(verifierConfig()));

  const platform = await getPlatformProxy({
    configPath,
    // Wrangler's CLI appends `v3` to `--persist-to`; this option does not, and
    // Cloudflare has confirmed the two are inconsistent. Pointing at the parent
    // would open an empty store and every assertion below would fail for the
    // wrong reason.
    persist: { path: path.join(persistTo, "v3") },
    // Defaults to true. A verification of local state has no business reaching
    // a remote binding, and if it ever did the failure would be silent.
    remoteBindings: false,
  });

  try {
    const state = await platform.env.DATABASE.prepare(PUBLISHED_STATE_SQL)
      .bind(handoff.storefrontId)
      .first();

    if (!state) {
      throw new Error(
        `NO_ACTIVE_RELEASE: storefront ${handoff.storefrontId} has no row joining an active release to a build. The publish did not move the pointer, or moved it to a release whose build is gone.`,
      );
    }
    // Compared by prefix because a prefix is all the UI has. The release history
    // panel renders the first eight characters of a release id, so what the spec
    // can report as "the release the editor showed as live" is that much and no
    // more. The assertion still does its job: D1's pointer and what a person
    // would have read off the screen have to be the same release.
    if (!state.active_release_id.startsWith(handoff.releaseLabel)) {
      throw new Error(
        `POINTER_MISMATCH: active_release_id is ${state.active_release_id}, the editor showed ${handoff.releaseLabel} as live.`,
      );
    }
    if (state.theme_id !== handoff.themeId) {
      throw new Error(
        `THEME_MISMATCH: the active release belongs to theme ${state.theme_id}, the spec edited ${handoff.themeId}.`,
      );
    }
    if (state.build_status !== "succeeded") {
      throw new Error(
        `BUILD_NOT_SUCCEEDED: the active release points at build ${state.theme_build_id}, whose status is ${state.build_status}.`,
      );
    }
    if (!state.artifact_prefix) {
      throw new Error(
        `NO_ARTIFACT_PREFIX: build ${state.theme_build_id} succeeded without recording where its artifact went.`,
      );
    }

    // The edit this run made, in the release that is live.
    //
    // Asserted here rather than by looking for the marker in the page the
    // artifact renders, because it is not there and cannot be. Morph publishes
    // code and content separately: the artifact is the Theme Worker, and the
    // content it renders is fetched at runtime as JSON from
    // `StorefrontProductionService`, scoped to the release's
    // `content_publication_id`. An artifact started on its own — which is what
    // this harness does — has no route to that endpoint, so it serves the theme
    // shell and no authored content. An earlier version of this check asserted
    // the marker in the rendered bytes and failed for that reason, which was the
    // design being wrong rather than the publish.
    //
    // What can be established, and is: the live release was cut from the
    // revision carrying this run's edit. That ties the pointer to the content
    // instead of inferring it from a render.
    // Reached through the content publication, which is where an authored edit
    // actually goes. A release binds three things: a theme *source* revision, a
    // build, and a content publication — and the marker is in none of the first
    // two. `source_revision_id` points into `storefront_theme_revisions`, the
    // theme's code; the edit lands in a theme template document, which is
    // published as a content publication item.
    //
    // Both wrong turns are worth recording, because each looked right. Asserting
    // the marker in the rendered response failed because content is fetched at
    // runtime from `StorefrontProductionService` and a standalone artifact has no
    // route to it. Asserting it against `source_revision_id` then failed for a
    // different reason: that id is not even in the template revisions table, so
    // the query could only ever return zero.
    if (!state.content_publication_id) {
      throw new Error(
        `NO_CONTENT_PUBLICATION: release ${state.release_id} is live without a content publication, so nothing it publishes can carry an authored edit.`,
      );
    }
    // `instr`, not `LIKE`. D1 refuses a LIKE pattern past a length it does not
    // document — `LIKE or GLOB pattern too complex: SQLITE_ERROR` — and the
    // marker is already close to it: `%morph-e2e-<uuid>%` is 47 characters and
    // passes, while the same pattern with sixteen more fails. That failure names
    // the pattern, not the marker, so it reads as a broken query rather than a
    // longer string. `instr` takes a plain substring and has no pattern to be too
    // complex. The same limit was met once before, in
    // `0054_normalize_sales_channel_timestamps.sql`, where a GLOB had to become
    // length/instr arithmetic.
    const edited = await platform.env.DATABASE.prepare(
      `SELECT count(*) AS carries
         FROM storefront_content_publication_items i
         JOIN storefront_theme_template_revisions t ON t.id = i.revision_id
        WHERE i.publication_id = ? AND instr(t.document, ?) > 0`,
    )
      .bind(state.content_publication_id, handoff.marker)
      .first();
    if (!edited || edited.carries === 0) {
      throw new Error(
        `EDIT_NOT_PUBLISHED: the live release's content publication ${state.content_publication_id} includes no template revision containing "${handoff.marker}". A release was published, but not this run's edit.`,
      );
    }

    const bucket = platform.env.R2_BUCKET;
    const manifestKey = `${state.artifact_prefix}/manifest.json`;
    const manifestObject = await bucket.get(manifestKey);
    if (!manifestObject) {
      throw new Error(`MANIFEST_MISSING: ${manifestKey} is not in the bucket.`);
    }
    const manifest = JSON.parse(await manifestObject.text());
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`MANIFEST_EMPTY: ${manifestKey} declares no files.`);
    }

    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    // Fetched together. These are binding calls against one already-running
    // Miniflare instance, so the cost of a file is a read, not a process.
    await Promise.all(
      manifest.files.map(async (entry) => {
        const destination = containedPath(outDir, entry.path);
        const object = await bucket.get(`${state.artifact_prefix}/${entry.path}`);
        if (!object) {
          throw new Error(
            `ARTIFACT_OBJECT_MISSING: the manifest declares ${entry.path} and the bucket does not have it.`,
          );
        }
        const bytes = new Uint8Array(await object.arrayBuffer());

        // The manifest is the build's own provenance record, so it can be held
        // to it. Checking both catches a truncated upload and a corrupted one,
        // which a file count would report as a complete artifact.
        if (bytes.byteLength !== entry.sizeBytes) {
          throw new Error(
            `ARTIFACT_SIZE_MISMATCH: ${entry.path} is ${bytes.byteLength} bytes, the manifest says ${entry.sizeBytes}.`,
          );
        }
        const digest = sha256(bytes);
        if (digest !== entry.sha256) {
          throw new Error(
            `ARTIFACT_DIGEST_MISMATCH: ${entry.path} hashes to ${digest}, the manifest says ${entry.sha256}.`,
          );
        }

        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
      }),
    );

    const workerConfig = await writeWorkerConfig(
      outDir,
      manifest,
      `morph-e2e-theme-${state.theme_build_id.slice(0, 8)}`,
    );

    const files = manifest.files.map((entry) => entry.path);
    return {
      marker: handoff.marker,
      releaseId: state.release_id,
      buildId: state.theme_build_id,
      artifactPrefix: state.artifact_prefix,
      sourceRevisionId: state.source_revision_id,
      contentPublicationId: state.content_publication_id,
      artifactDir: outDir,
      workerConfig,
      fileCount: files.length,
    };
  } finally {
    await platform.dispose();
    await rm(configPath, { force: true });
  }
}
