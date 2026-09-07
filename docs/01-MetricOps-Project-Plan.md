# MetricOps Project Plan

**Document status:** Initial baseline  
**Audience:** Product owners, delivery team, engineering leadership, pilot stakeholders, and procurement stakeholders  
**Planning horizon:** MVP through first controlled customer pilot

## 1. Executive summary

MetricOps will provide organizations with a centralized infrastructure assurance dashboard. It will help authorized users understand whether servers, applications, databases, and selected cloud resources are available, healthy, secure in their basic configuration, and operating within expected capacity.

The product will combine monitoring information with operational governance. It will present executive health summaries, technical drill-down dashboards, alerts, incidents, maintenance history, audit evidence, and carefully controlled infrastructure actions. It will not replace the customer's monitoring systems or cloud provider. It will provide a consistent management and governance layer above them.

The initial target market is government and public-sector organizations in Khyber Pakhtunkhwa, Pakistan. The MVP will therefore favor customer-controlled deployment, data sovereignty, predictable licensing, strong auditability, and read-only operation by default.

## 2. Project objectives

The MVP must prove that an organization can:

- Create and administer a protected customer workspace.
- Connect an existing monitoring environment without exposing it publicly.
- Connect one cloud account through customer-controlled, least-privilege access.
- Discover and classify supported infrastructure resources.
- View current and historical health and capacity information.
- Monitor application endpoints and one supported database technology.
- Receive, acknowledge, assign, silence, and resolve alerts.
- Produce uptime, capacity, incident, and audit reports.
- Separate MetricOps platform administration from customer infrastructure administration.
- Grant temporary, scoped support access when a customer explicitly approves it.
- Demonstrate one allow-listed non-production infrastructure operation with authorization, verification, and audit.

## 3. Product principles

The following principles govern scope and implementation:

1. **Read-only first.** Monitoring and reporting must be useful before infrastructure control is enabled.
2. **Customer ownership.** Infrastructure accounts, roles, credentials, telemetry, and operational authority remain under customer control.
3. **No hidden access.** MetricOps personnel receive no automatic access to customer telemetry or infrastructure.
4. **Evidence over claims.** Health, security, and compliance statements must show their source and last collection time.
5. **Use existing monitoring investments.** MetricOps integrates with established monitoring and visualization systems instead of recreating them.
6. **Safe operations.** Every supported change passes identity, permission, capability, policy, approval, execution, verification, and audit stages.
7. **Sovereign deployment.** The product must support installation in a customer data center, government cloud, or another approved environment.
8. **Focused extensibility.** The MVP proves a small number of integrations through reusable connector interfaces.

## 4. MVP scope

### 4.1 Platform administration

- Platform administrator authentication and mandatory multi-factor authentication.
- Client organization creation, activation, suspension, and archival.
- Client contacts, contract dates, support plan, subscription, and entitlements.
- Limits for users, monitored resources, data retention, and enabled features.
- Deployment registration and version visibility.
- Connector heartbeat, last synchronization, error state, and certificate-expiry visibility.
- Customer onboarding checklist.
- Support requests and customer-approved support-access grants.
- Platform-wide administrative audit trail.
- Separation of Platform Owner, Operations Administrator, Support Engineer, Billing Administrator, and Security Auditor permissions.

### 4.2 Customer administration

- Customer owner and customer administrator roles.
- Workspaces and environments such as Production, Staging, Testing, and Development.
- Users, teams, roles, invitations, session revocation, and access review.
- Integration setup, validation, disablement, and credential rotation.
- Resource ownership, tags, criticality, and business-service grouping.
- Alert policies, maintenance windows, notification preferences, and report schedules.
- Customer audit history and support-access approval.

### 4.3 Monitoring and visualization

- Connection to one or more existing metrics systems.
- Optional packaged monitoring deployment for customers without an existing system.
- Linux host discovery and standard CPU, memory, filesystem, network, load, and uptime metrics.
- HTTP, HTTPS, DNS, TCP, and certificate-expiry checks.
- Application availability, response time, request rate, error rate, and latency where instrumentation exists.
- Initial support for either PostgreSQL or MySQL, selected with the pilot customer.
- Fixed executive, infrastructure, application, database, alert, and audit dashboards.
- Advanced drill-down into the connected visualization system.
- Time-range selection and controlled query execution.
- Data-source and connector freshness indicators.

### 4.4 Alerts, incidents, and reports

- Import and normalization of monitoring alerts.
- Severity, affected resource, state, owner, and source.
- Acknowledge, assign, comment, silence, resolve, and reopen workflows.
- Maintenance windows that suppress expected notifications without deleting evidence.
- Incident creation from critical alerts.
- Incident timeline containing alerts, notes, operational activity, and resolution.
- On-demand and scheduled uptime, availability, capacity, incident, and audit reports.
- PDF and CSV export.

### 4.5 Initial cloud integration

- Secure, customer-controlled connection to an AWS account.
- Discovery of EC2 instances, attached EBS volumes, RDS databases, selected load balancers, and existing CloudWatch alarms.
- Cloud service metrics for supported resources.
- Correlation of EC2 resource metadata with operating-system metrics where available.
- Read-only security, availability, backup, monitoring, and governance findings.
- Separate monitoring and operations permissions.
- Optional start, stop, and reboot for explicitly managed non-production EC2 instances after the read-only pilot is accepted.

### 4.6 Trust and support access

- Platform personnel see customer identity, subscription, deployment, and connector-health metadata by default.
- Customer telemetry, dashboards, settings, and infrastructure remain inaccessible by default.
- A customer may create a time-limited support grant specifying scope, reason, support ticket, and expiry.
- Active support sessions show a visible banner to both parties.
- Every support view and action is recorded.
- The customer can revoke a support session immediately.
- Air-gapped deployments can generate customer-approved, secret-redacted diagnostic bundles instead of remote access.

## 5. Explicitly deferred scope

The following capabilities are not required for first MVP acceptance:

- Broad multi-cloud support.
- Container-orchestration management.
- Full log analytics, distributed tracing, or security-information and event management.
- Full cloud-security posture management.
- Automated remediation.
- Arbitrary remote shell or command execution.
- Infrastructure deletion.
- Cloud identity or network-policy modification.
- A complete custom dashboard builder.
- Native desktop clients.
- Mobile applications.
- Public status pages.
- Usage-based billing automation.
- Artificial-intelligence incident diagnosis.

## 6. Brief technology direction

The MVP will use a web-first client, a secure modular backend, a relational application database, established metrics and visualization systems, a background job mechanism, and a small secure edge connector where centralized access is required. The initial integrations will cover Prometheus, Grafana, AWS, standard host and endpoint exporters, and one database exporter. Deployments will be containerized and support customer-controlled hosting. Detailed technology choices and responsibilities are defined in the Detailed System Documentation.

## 7. Delivery workstreams

### Workstream A — Product and customer discovery

- Interview target department technology and operations stakeholders.
- Inventory target servers, applications, databases, network zones, and existing tools.
- Identify reporting, security, data-residency, and procurement requirements.
- Select the first pilot workload and database.
- Agree measurable pilot outcomes.

### Workstream B — Platform foundation

- Establish project repositories, environments, coding standards, and release process.
- Implement identity, sessions, platform roles, customer roles, and tenant boundaries.
- Create organizations, workspaces, environments, subscriptions, and entitlements.
- Establish audit-event capture and administrative reporting.

### Workstream C — Monitoring vertical slice

- Connect a test Linux server to the metrics pipeline.
- Discover the resource and classify it in MetricOps.
- Display current and historical infrastructure health.
- Monitor an application endpoint and selected database.
- Trigger and process a controlled alert.

### Workstream D — AWS integration

- Create customer deployment instructions and a least-privilege role template.
- Implement temporary cross-account sessions.
- Discover supported resources and metrics.
- Normalize AWS resources into the common inventory model.
- Produce explainable configuration findings.
- Validate immediate access revocation.

### Workstream E — Operations and governance

- Implement alert and incident workflows.
- Implement maintenance windows, approvals, and policy evaluation.
- Add the job lifecycle and live status updates.
- Demonstrate one allow-listed non-production action.
- Verify the resulting state and write complete audit evidence.

### Workstream F — Reporting, deployment, and hardening

- Produce executive and technical reports.
- Package customer-controlled deployments.
- Create backup, restore, upgrade, and rollback procedures.
- Perform security review, vulnerability testing, load testing, and recovery testing.
- Prepare administrator, operator, and support documentation.

## 8. Phased schedule

The schedule assumes two backend engineers, one frontend engineer, one platform/SRE engineer, and shared product, design, QA, and security support.

| Phase | Indicative duration | Primary outcome |
|---|---:|---|
| Discovery and pilot definition | 2 weeks | Signed scope, asset list, deployment decision, and acceptance measures |
| Architecture and proof of concept | 4 weeks | One complete monitoring-to-alert flow and one controlled test operation |
| Platform and customer administration | 4–5 weeks | Separated administration planes, tenancy, identity, entitlements, and audit |
| Monitoring and dashboard MVP | 5–6 weeks | Host, endpoint, database, dashboards, alert workflow, and reports |
| AWS read-only connector | 4–5 weeks | EC2/RDS discovery, CloudWatch metrics and alarms, and configuration findings |
| Integration, hardening, and pilot release | 3–4 weeks | Installable, tested release and operating documentation |
| Customer pilot | 8–12 weeks | Measured operational evidence and production decision |

Some engineering phases can run in parallel. A realistic target for a pilot-ready release is approximately 18–22 calendar weeks, followed by the controlled pilot.

## 9. Team responsibilities

| Role | Primary responsibility |
|---|---|
| Product owner | Product decisions, customer discovery, scope, acceptance, and commercial alignment |
| Solution architect/technical lead | Architecture, security boundaries, data model, integrations, and technical decisions |
| Backend engineers | APIs, tenancy, identity integration, connectors, jobs, alerts, reports, and audit |
| Frontend engineer | Platform admin, customer portal, dashboards, workflows, accessibility, and error handling |
| Platform/SRE engineer | Monitoring stack, deployment automation, networking, backups, upgrades, and platform observability |
| QA engineer | Functional, integration, tenancy, permissions, recovery, and release testing |
| Security reviewer | Threat model, secure design review, dependency review, penetration testing, and compliance mapping |
| UX/product designer | Information architecture, workflow design, design system, and operator usability |

## 10. MVP acceptance criteria

The MVP is accepted only when evidence demonstrates that:

1. A platform administrator can create and manage a customer without receiving customer infrastructure access.
2. A customer administrator can create environments and restricted users.
3. A restricted user cannot access another customer, forbidden workspace, secret, setting, query, or operation.
4. A customer can connect the supported metrics environment without making its internal endpoints public.
5. Supported servers, endpoints, and database resources are discovered and show source and freshness information.
6. A customer can connect AWS without supplying a permanent access key.
7. The AWS role can be revoked by the customer and subsequent access fails.
8. Supported EC2 and RDS resources and metrics are correctly displayed.
9. A sustained test failure produces an alert and can be acknowledged, assigned, investigated, and resolved.
10. Uptime and incident reports reconcile with the underlying monitoring evidence.
11. Every administrative, support, and infrastructure-changing action produces an immutable audit event.
12. A time-limited support grant cannot exceed its approved customer, scope, or expiry.
13. One allowed non-production EC2 or service operation progresses through authorization, execution, verification, and audit.
14. Backup restoration, software upgrade, and rollback procedures are demonstrated.
15. No private metrics, exporter, database, or management endpoint is exposed directly to the public internet.

## 11. Pilot success measures

The pilot should establish a baseline and then measure:

- Percentage of agreed critical resources represented in inventory.
- Percentage of agreed services covered by validated availability checks.
- Alert precision and number of noisy or unactionable alerts.
- Mean time to detect and acknowledge pilot incidents.
- Availability-report accuracy.
- Number of capacity risks identified before failure.
- Percentage of privileged actions with complete audit evidence.
- Time required to prepare monthly operational reports before and after MetricOps.
- User adoption by administrators, operators, and auditors.
- Number and severity of security or resilience configuration findings resolved.

## 12. Dependencies and assumptions

- The pilot customer will nominate technical and approving stakeholders.
- Network routes, firewall changes, certificates, DNS, and test infrastructure will be provided on schedule.
- The customer will approve a least-privilege AWS role and selected monitored resources.
- The customer will identify which data may leave its network, if any.
- The selected applications and database can expose health or metric evidence without exposing sensitive business data.
- Procurement and security teams will review deployment and support-access terms.
- Production operations will remain disabled until separately accepted.

## 13. Key risks and mitigation

| Risk | Mitigation |
|---|---|
| Scope expands into a complete monitoring suite | Enforce explicit MVP boundaries and reuse established monitoring capabilities |
| Customer distrust of vendor access | No-access default, customer-approved support grants, visible sessions, and complete audit |
| AWS permissions are broader than necessary | Separate read-only and operations roles; use temporary sessions and customer revocation |
| Metrics are mistaken for full security coverage | Clearly separate availability findings, configuration findings, and security-event capabilities |
| Alert fatigue reduces adoption | Start with a small validated alert catalogue and maintenance windows |
| Private infrastructure cannot accept inbound connections | Deploy locally or use an outbound edge connector |
| Government approval or procurement takes longer than engineering | Begin policy, procurement, data-residency, and pilot discussions during discovery |
| Customer environments are inconsistent | Use capability discovery and show unsupported states explicitly |
| A custom agent becomes a security burden | Prefer standard exporters; keep the edge component minimal and allow-listed |
| Reports do not match stakeholder expectations | Agree report samples and calculations before implementation |

## 14. Governance and change control

- The product owner owns scope and acceptance decisions.
- Security-boundary changes require technical-lead and security review.
- Any new infrastructure-changing capability requires a threat model, explicit permissions, verification behavior, and audit schema.
- Any new integration must implement the common connector contract and failure-isolation requirements.
- Changes affecting retention, customer access, data location, or support access require documented customer and compliance impact.
- Deferred features enter the MVP only through an approved change request with schedule and risk impact.

## 15. Initial deliverables

- Approved product requirements and architecture.
- Platform and customer administration modules.
- Linux, endpoint, database, Prometheus, Grafana, and AWS connection guides.
- Default dashboard and alert catalogue.
- Incident, maintenance, support-access, and audit workflows.
- Customer-controlled deployment package.
- Backup, restore, upgrade, and rollback runbooks.
- Administrator, operator, auditor, and support guides.
- Security model and compliance-control mapping.
- Pilot acceptance report and recommendations for the next release.
