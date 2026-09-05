# Deployment lock recovery

The deployment owner is a mutex, not a time-based permission to overwrite a
Worker. `deployment_lease_expires_at` is a stale-operation diagnostic threshold.
Publish and rollback acquire the same mutex; normal settled operations release
only their own owner. Passing the threshold never permits automatic takeover.

If a process is interrupted, the lock intentionally remains. Do not clear it
merely because it is old. The external Worker upload API cannot fence an old
process, and an upload may still be running after its caller disappears.

An authorized operator must:

1. Record the exact storefront, owner, active release and deployed Worker version.
2. Stop/verify termination of the original request and its isolated deployment
   container; check Cloudflare deployment status and logs for pending uploads.
3. Reconcile the actual deployed version with the release pointer. A failed
   request alone is not evidence that Cloudflare rejected the upload.
4. Only after no old writer can resume, clear the lock with an owner-scoped CAS
   through `storefrontReleaseDal.releaseDeploymentLease`. Never clear all locks
   or remove an owner that changed during investigation.
5. Retry the existing authorized Publish/activation path with fresh OCC state.

No automatic lock recovery endpoint or new permission model is introduced.
Production investigation and mutation require explicit operator authorization.

## Legacy Page routing

New Page revisions capture `document.handle`; publication items retain their
route snapshot. Draft rename/deletion no longer controls an existing snapshot.
Legacy revisions may reuse an unambiguous publication snapshot, or the current
handle only when the draft and published revision are still identical.
If no historical route can be proved, publishing fails with
`CONTENT_PUBLICATION_PAGE_ROUTE_UNAVAILABLE`: review and explicitly republish
the Page. Do not backfill historical releases from a changed current handle.
Runtime never falls back to a mutable handle for legacy items without a route
snapshot. Such legacy releases need a verified historical snapshot migration;
this change does not fabricate one or run any migration.

## Starter update

Starter v14 updates untouched v13 `src/morph/content.ts` copies. Customer-edited
files are preserved. Existing immutable builds/releases do not change: inspect
the workspace upgrade and explicitly build/publish before using the new loader
on the public storefront.
