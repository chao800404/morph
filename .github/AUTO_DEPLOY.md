# Deployment automation status

Morph does not currently include an active GitHub Actions deployment workflow.

Deployment is performed manually with Wrangler so that production migrations and releases remain explicit. Follow [`DEPLOY.md`](../DEPLOY.md) for the supported procedure.

If a workflow is added later, it must use GitHub Actions secrets and follow the same validation, migration, deployment, and verification order documented there. Do not assume that pushing to `main` deploys the application.
