# MetricOps

MetricOps is an infrastructure assurance control plane. The repository now contains the initial secure Node.js/Express backend foundation alongside the product, delivery, and communication documentation.

## Backend quick start

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
# In a separate terminal:
npm run worker
```

The API exposes liveness and readiness at `/health/live` and `/health/ready`, and versioned APIs under `/api/v1`. The worker handles durable validation jobs using PostgreSQL leases. The current backend supports PostgreSQL and Prometheus connections, tenant-scoped resource inventory, and policy-bounded host metrics templates. Its interface contract is in [`openapi/metricops-v1.yaml`](openapi/metricops-v1.yaml). See [the deployment guide](docs/guides/DEPLOYMENT.md), [the integration guide](docs/guides/INTEGRATIONS.md), and [the security baseline](SECURITY.md) before running outside a local development environment.

Frontend developers can import the [Postman package](postman/README.md), which includes complete local and staging environments, endpoint guidance, example payloads and responses, and the dashboard-facing API workflow.

Backend checks:

```bash
npm run check
npm test
npm run build
```

## Documents

1. `docs/01-MetricOps-Project-Plan.md` — delivery plan, MVP scope, workstreams, milestones, risks, and acceptance criteria.
2. `docs/02-MetricOps-Detailed-System-Documentation.md` — authoritative product and technical system specification.
3. `docs/03-MetricOps-Product-and-Development-Understanding.md` — internal working model for the product and development team.
4. `presentation/MetricOps-Platform-Overview.pptx` — stakeholder presentation focused on the problem, solution, value, trust model, and pilot.
5. `presentation/MetricOps-Platform-Overview-Outline.md` — editable presentation content source.
6. `docs/guides/DEPLOYMENT.md` — deployment, TLS, secrets, backup, upgrade, and production acceptance guidance.
7. `docs/guides/INTEGRATIONS.md` — PostgreSQL onboarding and the contract for future system adapters.

Rendered Word versions of the three documents are stored alongside their Markdown sources.

## Document precedence

If the documents conflict, use this order:

1. Approved product decisions and contractual customer requirements.
2. Detailed System Documentation.
3. Project Plan.
4. Product and Development Understanding.
5. Presentation.

The presentation is intentionally non-technical. It must not be used as an implementation specification.
