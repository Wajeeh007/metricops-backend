# MetricOps Detailed System Documentation

**Document status:** Initial authoritative baseline  
**Purpose:** Define what MetricOps is, the problems it solves, how it behaves, how it is secured, and how it should be implemented  
**Primary audience:** Product, engineering, security, deployment, operations, and customer technical stakeholders

## 1. Product definition

MetricOps is an enterprise infrastructure assurance and controlled-operations platform. It provides a single, governed interface for observing servers, applications, databases, cloud resources, alerts, incidents, maintenance, and authorized operational activity.

MetricOps is not a new time-series database, a replacement cloud console, a remote shell, or a complete security-information and event-management product. It integrates established telemetry and infrastructure systems and adds the organizational capabilities that are normally fragmented across them:

- Customer and workspace administration.
- Resource inventory and business context.
- Executive health summaries.
- Consistent dashboards and alert workflows.
- Incident ownership and investigation timelines.
- Maintenance and operational governance.
- Approval and verification of supported actions.
- Customer-controlled vendor support access.
- Audit-ready evidence and operational reporting.

The preferred product statement is:

> MetricOps gives an organization one secure place to understand the health and availability of its digital infrastructure, investigate operational issues, and perform only explicitly authorized actions with complete accountability.

## 2. Problems addressed

### 2.1 Fragmented visibility

Infrastructure information is distributed among server tools, dashboards, cloud consoles, database utilities, alert channels, spreadsheets, and individual staff knowledge. A user may know that an application is unavailable without knowing whether the cause is its server, database, network path, certificate, or cloud resource.

MetricOps creates a normalized inventory and connects each resource to its health evidence, alerts, incidents, changes, and responsible team.

### 2.2 Monitoring expertise barriers

General-purpose monitoring systems are powerful but require knowledge of metric names, labels, queries, data sources, exporters, and alert configuration. Managers and junior operators frequently need a simpler answer: which services are at risk, why, who owns the issue, and what should happen next?

MetricOps provides opinionated dashboards, plain-language status, curated alert templates, and a beginner-to-expert drill-down path.

### 2.3 Weak operational accountability

Monitoring and infrastructure changes commonly occur in separate tools. That makes it difficult to answer who restarted a service, who approved the action, whether it recovered, and which incident required it.

MetricOps connects the request, policy, approval, execution, verification, and audit history into one workflow.

### 2.4 Inconsistent client administration

A managed product needs to administer customer subscriptions and deployments without silently inheriting access to customer infrastructure. Conventional super-admin designs often create unnecessary trust and security risk.

MetricOps separates platform administration from customer operations. Platform staff manage the commercial relationship, deployment health, versions, entitlements, and support process. Customer data or infrastructure access requires a separate customer-approved support grant.

### 2.5 Inadequate operational reporting

Government and enterprise stakeholders frequently require evidence of availability, incidents, capacity, maintenance, access, and administrative activity. Producing this evidence manually is slow and inconsistent.

MetricOps produces repeatable reports from recorded monitoring and audit evidence, while preserving the source and calculation period.

### 2.6 Security claims without evidence

Availability metrics do not prove that an environment is secure. MetricOps separates:

- **Operational health:** availability, latency, saturation, capacity, and dependencies.
- **Configuration findings:** explainable observations such as public exposure, encryption state, backup configuration, and monitoring coverage.
- **Security events:** authentication failures, access changes, suspicious behavior, or threat detections obtained from future log/security integrations.
- **Compliance evidence:** recorded controls, actions, retention, review, and reports.

The MVP provides operational health, selected configuration findings, and audit evidence. It does not claim to replace vulnerability scanners, endpoint protection, a security operations center, or independent security assessment.

## 3. Target organizations and users

### 3.1 Initial organizations

- Government departments and authorities.
- Government data-center and shared-service teams.
- Public-sector programs operating citizen-facing applications.
- Enterprises with mixed on-premises and cloud infrastructure.
- Managed service providers that need strong customer separation.

### 3.2 User personas

| Persona | Main questions |
|---|---|
| Executive or department head | Are critical digital services available? Which risks need management attention? |
| IT manager or DIO | What do we operate, who owns it, and where are the capacity and availability risks? |
| Operator or DevOps engineer | What failed, what changed, and what is the safe next action? |
| Application owner | Is my service healthy and are its endpoints and dependencies performing correctly? |
| Database administrator | Is the database reachable, saturated, low on storage, blocked, or lagging? |
| Security or compliance officer | Who has access, what administrative actions occurred, and what evidence is retained? |
| Customer owner | Who may administer the customer workspace and approve support or production operations? |
| MetricOps platform operator | Is the customer deployment connected, supported, licensed, current, and recoverable? |
| MetricOps support engineer | What diagnostics has the customer authorized me to inspect for a specific support case? |

## 4. System boundaries

### 4.1 MetricOps owns

- Platform and customer account management.
- Entitlements and deployment registration.
- Workspace, environment, team, and policy context.
- Integration configuration and health metadata.
- Resource inventory and normalized capabilities.
- Dashboard navigation and curated overview experiences.
- Alert normalization and incident workflow.
- Maintenance, approval, operation, and verification workflow.
- Support-access grants.
- Audit history and generated reports.

### 4.2 Integrated systems own

- Collection and storage of high-volume time-series samples.
- Detailed visualization and advanced metric exploration.
- Native cloud-resource state and APIs.
- Database-engine behavior.
- Host and application metric production.
- Notification delivery through configured external channels.
- Future log, trace, vulnerability, and security-finding data.

### 4.3 The system must never do

- Store customer infrastructure credentials in the client application.
- Expose internal monitoring or exporter endpoints to the public internet by default.
- Give a platform administrator implicit customer access.
- execute arbitrary operating-system commands.
- Display a successful operation before the expected state has been verified.
- Present unsupported capabilities for a resource.
- Label an environment compliant or secure without defined supporting evidence.
- Mix customer telemetry or authorization context.

## 5. Functional architecture

### 5.1 Platform Administration module

This module is used by the MetricOps service organization.

Functions:

- Create, activate, suspend, and archive customer records.
- Manage customer contacts, subscription, contract dates, support tier, and entitlements.
- Configure feature availability and usage limits.
- Register customer deployments and approved deployment models.
- View deployment heartbeat, version, connector state, last synchronization, and error categories.
- View aggregate resource counts and service consumption where contractually permitted.
- Manage onboarding tasks and support cases.
- Request customer support access; it cannot approve its own request.
- View platform security events and platform-administrator audit history.
- Schedule release notices and support communications.

Default platform metadata must exclude resource names, IP addresses, metric values, dashboard contents, infrastructure secrets, and customer user activity unless the contract and customer configuration explicitly permit them.

### 5.2 Customer Administration module

This module is controlled by the customer.

Functions:

- Manage organization profile and authorized administrators.
- Create workspaces and environments.
- Invite, deactivate, and review users.
- Manage teams, built-in roles, custom roles, and resource scopes.
- Configure connections and rotate credentials.
- Classify resources by owner, environment, criticality, service, and location.
- Configure alert policies, escalation, maintenance windows, and reports.
- Approve or deny temporary MetricOps support access.
- Review customer, support, and infrastructure-operation audit events.
- Configure production approval requirements.

### 5.3 Identity and Access module

Required capabilities:

- User authentication through an enterprise identity provider where available.
- Local emergency or initial administrator authentication where approved.
- Multi-factor authentication for privileged users.
- Short-lived access sessions and revocable refresh sessions.
- Platform roles and customer roles stored as separate role families.
- Workspace, environment, resource, and action scopes.
- Deny-by-default authorization.
- Periodic access review and inactive-user reporting.
- Service identities for connectors and automation.

Recommended customer roles:

| Role | Typical access |
|---|---|
| Customer Owner | Customer governance, owners, security policy, and support approval |
| Customer Administrator | Users, teams, connections, dashboards, alerts, and settings |
| Approver | Approves defined production operations without necessarily administering the platform |
| Operator | Investigates and performs specifically permitted actions |
| Developer/Application Owner | Views assigned applications and related telemetry |
| Viewer | Read-only access to assigned health and dashboards |
| Auditor | Read-only access to audit, access, incident, and report evidence |

Recommended platform roles:

| Role | Typical access |
|---|---|
| Platform Owner | Platform governance and assignment of platform administrators |
| Platform Operations Administrator | Deployments, versions, availability, and operational configuration |
| Support Engineer | Support cases and customer-granted support sessions |
| Billing Administrator | Subscription, contract, invoice, and entitlement metadata only |
| Platform Security Auditor | Platform access, support sessions, and administrative audit evidence |

### 5.4 Organization, Workspace, and Environment module

Hierarchy:

```text
Platform
└── Customer Organization
    ├── Subscription and Deployment
    ├── Users and Teams
    └── Workspace
        └── Environment
            ├── Business Services
            ├── Resources
            ├── Connections
            ├── Dashboards
            ├── Alerts and Incidents
            └── Policies and Maintenance
```

Every customer-owned record must carry an immutable organization identifier. Workspace and environment identifiers must be enforced by backend data access, not merely by interface filters.

### 5.5 Connection Management module

Every integration connection contains:

- Customer and workspace.
- Connection type and display name.
- Deployment route: local, edge gateway, or centralized.
- Authentication method and secret reference.
- Allowed endpoints, accounts, regions, and resource filters.
- Supported and granted capabilities.
- Last validation and synchronization.
- Version and compatibility information.
- Health state and safe diagnostic information.

Standard connection states:

- Pending setup.
- Connected.
- Degraded.
- Authentication expired.
- Permission denied.
- Offline.
- Unsupported version.
- Disabled.
- Unknown.

The connection service must use bounded timeouts, retry with backoff, failure isolation, rate limits, and per-customer concurrency limits.

### 5.6 Resource Inventory module

The inventory stores metadata, relationships, and capabilities rather than raw time-series samples.

Common resource properties:

- Stable MetricOps resource identifier.
- Provider-native identifier.
- Resource type.
- Name, description, region, location, and environment.
- Owner and support team.
- Business service and dependencies.
- Criticality and data classification.
- Tags and discovery source.
- Monitoring, control, log, trace, and security capabilities.
- Current lifecycle and connection state.
- Last discovery and last telemetry time.

Initial resource types:

- Linux host.
- Application or API endpoint.
- Database instance.
- AWS EC2 instance.
- AWS EBS volume.
- AWS RDS instance or cluster.
- Selected AWS load balancer.

Resource correlation must support an EC2 instance being the same operational resource as a Linux host observed through Prometheus. Provider metadata and host telemetry remain separate evidence sources but appear on one resource page.

### 5.7 Metrics and Query module

Responsibilities:

- Route instant and range queries to the correct customer metrics connection.
- Validate approved templates. User-entered PromQL is deferred until a separate query-cost, label-authorization, and abuse-control design is approved.
- Apply time-range, step, series-count, response-size, and execution-time limits.
- Escape or reject unsafe label input.
- Add required tenant or resource matchers where the deployment shares a backend.
- Normalize values, timestamps, labels, units, and missing-data states.
- Cache safe, repeated dashboard queries for short periods.
- Record query metadata without logging secrets or sensitive results unnecessarily.

MetricOps must distinguish:

- Healthy value.
- Unhealthy value.
- No data because a resource is down.
- No data because collection is failing.
- No data because the query is unsupported.
- Stale data.

### 5.8 Dashboard module

The MVP has two dashboard levels:

1. **MetricOps curated overview:** simple, consistent pages for executives, managers, operators, database administrators, and auditors.
2. **Grafana technical drill-down:** detailed visualization, exploration, and established dashboard behavior.

Initial curated dashboards:

- Organization health.
- Critical business services.
- Linux server overview and detail.
- Application endpoint overview.
- Database overview and detail.
- AWS account overview.
- Active alerts and incidents.
- Capacity risks.
- Security and resilience findings.
- Recent operations and audit activity.

MetricOps should provision versioned Grafana dashboard templates. It should not duplicate a general-purpose dashboard editor in the MVP.

### 5.9 Alert Management module

Prometheus evaluates metric rules, and Alertmanager handles grouping, inhibition, silencing, and notification routing. MetricOps receives normalized alert state through an authenticated webhook and may also query Alertmanager for current state.

MetricOps adds:

- Customer and resource mapping.
- Plain-language title and impact.
- Ownership and acknowledgement.
- Assignment and comments.
- Links to evidence and runbooks.
- Maintenance and business-service context.
- Incident conversion.
- Permanent workflow history.

Alert states:

- Pending.
- Firing.
- Acknowledged.
- Silenced.
- Resolved.
- Suppressed by maintenance.

### 5.10 Incident Management module

An incident contains:

- Customer, workspace, environment, and affected service.
- Severity, status, commander or owner, and responders.
- Related alerts and resources.
- Timeline of notes, evidence, support access, and operations.
- Runbook references.
- Impact start, detection, acknowledgement, mitigation, recovery, and closure times.
- Root cause and resolution summary.
- Follow-up actions.

Incident status should support Open, Acknowledged, Investigating, Mitigating, Monitoring, Resolved, and Closed.

### 5.11 Maintenance module

- Planned start and end.
- Customer, workspace, resource, service, or label scope.
- Reason, owner, approver, and related change reference.
- Alert notification suppression without deleting alert evidence.
- Before-and-after resource health.
- Extension, cancellation, and audit history.

### 5.12 Infrastructure Operations module

The operation lifecycle is:

```text
Requested
→ Authenticating
→ Authorizing
→ Checking capability
→ Evaluating policy
→ Awaiting approval, when required
→ Queued
→ Executing
→ Verifying
→ Succeeded, Failed, Rejected, Cancelled, or Timed Out
```

Each operation type must define:

- Supported resource types.
- Required permission.
- Required provider capability.
- Allowed environments and tags.
- Approval policy.
- Idempotency behavior.
- Execution timeout.
- Expected resulting state.
- Health verification.
- Rollback or recovery guidance.
- Audit payload.

MVP operations are disabled globally by default. Initial candidates are restarting an allow-listed service through the edge gateway and starting, stopping, or rebooting an explicitly tagged non-production EC2 instance. Delete and arbitrary-command operations are prohibited.

### 5.13 Support Access module

Support access is a separate authorization object, not an elevated platform role.

Required properties:

- Customer and support case.
- Customer requester and approver.
- Named MetricOps support user or support team.
- Requested and approved scopes.
- Allowed resource and environment scope.
- Read-only or specific change permissions.
- Start, expiry, and revocation timestamps.
- Reason and approval comments.
- Session identifiers and audit events.

Rules:

- A MetricOps employee cannot approve access to a customer.
- Access is denied before its start and immediately after expiry or revocation.
- Operations require an additional explicit permission and normal customer operation policy.
- Secrets are never displayed.
- An active support banner remains visible.
- All support access appears in the customer's audit and report interfaces.
- Customer policy can disable remote support completely.

### 5.14 Reporting module

Initial reports:

- Executive service-health summary.
- Service availability and outage report.
- Infrastructure capacity report.
- Database health and capacity report.
- Alert and incident report.
- Security and resilience configuration findings.
- User access and privilege review.
- Administrative and infrastructure-operation audit report.
- Support-access report.

Every report must identify its customer, time zone, period, data sources, generated time, calculation method, missing-data periods, and report version.

## 6. AWS integration specification

### 6.1 Connection model

The customer deploys a MetricOps-provided CloudFormation template that creates a customer-owned IAM role. MetricOps stores the role ARN, customer/account mapping, allowed regions, and a unique external ID. It uses AWS Security Token Service `AssumeRole` to obtain temporary credentials.

Requirements:

- Never request a customer's root credentials or long-lived access keys.
- Generate a unique external ID controlled by MetricOps for each connection.
- Use a custom least-privilege policy instead of a broad managed read-only policy.
- Separate read-only discovery/monitoring from operational permissions.
- Let customers delete or disable the role at any time.
- Record role-assumption failures without exposing sensitive AWS response data.
- Validate expected account identity after connection.
- Support region allow-lists and customer resource filters.

### 6.2 Initial AWS services

**EC2:** instance metadata, lifecycle state, status checks, type, image/platform metadata where available, availability zone, addresses, monitoring state, tags, launch time, and attached volumes.

**EBS:** volume identity, type, size, state, attachment, encryption state, and selected performance information.

**RDS:** instance/cluster identity, engine, version, class, status, endpoint metadata with sensitive details masked as required, storage, encryption, backup retention, deletion protection, Multi-AZ state, public accessibility, and supported metrics.

**CloudWatch:** selected EC2/RDS metrics, existing alarms, alarm history where permitted, and controlled query ranges.

**Load balancing:** selected load-balancer and target-health information when needed by the pilot business service.

### 6.3 Initial AWS findings

Findings are evidence-backed observations with severity, category, resource, observed value, expected condition, collection time, and remediation guidance.

Initial rules may include:

- Production instance lacks required monitoring coverage.
- EC2 instance has a public address.
- Sensitive management port is open to all IPv4 or IPv6 addresses.
- Attached volume is unencrypted.
- Instance does not require the latest metadata-session behavior.
- RDS is publicly accessible.
- RDS storage is unencrypted.
- Automated backup retention does not meet customer policy.
- Production RDS lacks deletion protection.
- Required owner, environment, or business-service tag is absent.
- Cloud alarm coverage required by customer policy is missing.

These findings do not establish full AWS security posture. Existing AWS Security Hub findings may be imported in a later release.

## 7. Technology architecture

### 7.1 Architectural style

Use a modular monolith for the MVP, with explicit domain modules and asynchronous workers. This keeps deployment and transactions manageable while preserving future service boundaries. Do not begin with independent microservices unless a measured deployment or scaling constraint requires them.

Suggested deployable components:

- Web client.
- Backend API and domain application.
- Background worker.
- PostgreSQL database.
- Redis for queues, rate-limit state, and short-lived cache.
- Identity provider.
- Prometheus, Alertmanager, and Grafana, where packaged by MetricOps.
- Edge gateway for outbound private-network connectivity when required.
- Reverse proxy/API gateway.
- Optional S3-compatible object storage for generated reports and support bundles.

### 7.2 Frontend

**Recommended MVP:** Flutter Web, because the original product direction and team context favor a shared Flutter user interface. Use responsive layouts optimized for desktop browsers. Defer Windows, macOS, and Linux desktop packaging until a customer requirement justifies it.

Frontend responsibilities:

- Authentication redirects and session handling.
- Platform-admin and customer navigation shells.
- Dashboard summaries and chart presentation.
- Connection wizards and validation feedback.
- Alert, incident, maintenance, approval, and support-access workflows.
- Live job status through Server-Sent Events or WebSocket where justified.
- Accessible error, empty, loading, stale-data, and permission-denied states.

Suggested Flutter libraries should be selected and locked through an architecture decision record. Likely categories include Riverpod for state management, GoRouter for navigation, Dio for HTTP, secure browser-compatible token handling, and a chart library with acceptable commercial licensing. Library names are implementation recommendations, not contractual product requirements.

### 7.3 Backend

**Approved MVP implementation:** TypeScript on a supported Node.js LTS release with Express.js. The Express application must retain explicit domain modules, deny-by-default authorization middleware, strict schema validation, versioned OpenAPI contracts, bounded background work, and testable service/repository boundaries. Any proposal to replace Node.js or Express.js requires prior stakeholder approval and a documented reason for the change.

Suggested backend modules:

- Platform Administration.
- Tenancy and Entitlements.
- Identity and Authorization.
- Connections and Secrets.
- Inventory and Discovery.
- Metrics Query.
- AWS Connector.
- Alerts and Incidents.
- Maintenance.
- Approvals and Operations.
- Support Access.
- Audit and Reporting.
- Notifications.

Use REST for primary APIs. Use Server-Sent Events for one-directional live operation and alert updates unless bidirectional WebSocket behavior is genuinely required.

### 7.4 Application database

Use PostgreSQL for transactional and configuration data. Prisma is a suitable TypeScript data-access layer and migration tool. Enforce customer ownership in repository/query helpers and add PostgreSQL row-level security for defense in depth where operationally manageable.

PostgreSQL stores:

- Customers, subscriptions, and entitlements.
- Deployments and versions.
- Users, team mappings, application roles, and resource scopes.
- Workspaces and environments.
- Connection metadata and secret references.
- Resource inventory and relationships.
- Dashboard metadata and templates.
- Alert workflow state and incidents.
- Maintenance, approvals, operations, and support grants.
- Audit events and report metadata.

It must not store bulk Prometheus time-series samples.

### 7.5 Queue, cache, and asynchronous work

The approved initial implementation uses PostgreSQL-backed durable jobs with atomic `SKIP LOCKED` claims, expiring worker leases, bounded retries, tenant scope, idempotency keys, and audit linkage. This keeps the first deployment within the approved Node.js, Express.js, and PostgreSQL stack. Redis/BullMQ remains a possible scaling option, but it must not be introduced without prior stakeholder approval and a documented operational reason.

Do not treat the queue as the permanent audit record. Persist authoritative job state and transitions in PostgreSQL.

### 7.6 Metrics and visualization

Use Prometheus as the initial metrics backend and PromQL as the advanced query language. Connect through the MetricOps backend or local edge gateway. Use:

- Node Exporter for Linux host metrics.
- Blackbox Exporter for HTTP, HTTPS, DNS, TCP, ICMP where permitted, and certificate checks.
- PostgreSQL Exporter or MySQL Exporter according to the selected pilot database.
- Windows Exporter in a later increment if required.
- Application instrumentation using official Prometheus client libraries.

Use Alertmanager for alert routing, grouping, inhibition, and silences. MetricOps consumes alert webhooks and adds ownership and incident context.

Use Grafana for detailed visualization. Provision data sources, folders, and versioned dashboards with least-privilege service accounts. Prefer authenticated deep links initially. If embedding is required, use a reviewed authentication-proxy or supported embedding design; never enable public/anonymous dashboard access for private government telemetry.

Grafana OSS is AGPLv3-licensed. Maintain a component licence register and obtain legal review before modifying, distributing, white-labelling, or tightly embedding it in a proprietary product. Do not remove required attribution or assume an open-source licence permits proprietary redistribution without obligations.

### 7.7 AWS connector

Use the AWS SDK for JavaScript v3. Use STS temporary sessions and dedicated clients for EC2, RDS, CloudWatch, Elastic Load Balancing, and caller identity. Apply per-connection region and concurrency limits. Use paginated APIs and incremental discovery.

Provide a versioned CloudFormation template for the customer role. Infrastructure-operation permissions must be in a separate optional template or policy attachment.

### 7.8 Edge gateway

Build the edge gateway only when a central control plane must reach private customer systems. Go is recommended for a small, statically compiled service with controlled resource use and simple distribution.

Gateway responsibilities:

- Outbound enrollment and mutually authenticated channel.
- Connection-health heartbeat.
- Proxy of allow-listed monitoring API requests.
- Execution of signed, typed, allow-listed operations.
- Local result verification where required.
- Secret redaction and bounded diagnostics.
- Version and update status.

The gateway must not accept arbitrary shell text, expose a general inbound management port, or retain control-plane credentials unnecessarily.

### 7.9 Identity provider

Use an established OpenID Connect provider. Keycloak is a suitable self-hosted option for government or isolated deployments and can support federation, multi-factor authentication, and enterprise identity integration. Customer identity remains separate from MetricOps domain permissions, which the backend evaluates on every protected request.

### 7.10 Secrets and cryptography

Use HashiCorp Vault, a deployment-environment key-management service, or envelope encryption with a master key outside PostgreSQL. Store references or ciphertext, never plaintext connection secrets. Rotation, expiry, access audit, backup, and disaster recovery must be defined.

Use TLS for all network communication and mTLS for edge enrollment and communication. Prefer short-lived credentials and certificates. Do not log authorization headers, cookies, session tokens, external connection secrets, or private keys.

### 7.11 Deployment and operations

Initial deployment packaging:

- OCI-compatible containers.
- Docker Compose for a controlled pilot or small single-node installation.
- Kubernetes/Helm after high availability or government cloud operations justify the added complexity.
- NGINX or an equivalent reviewed reverse proxy.
- Configuration through environment-specific secret and configuration files excluded from source control.
- Terraform and CloudFormation for repeatable infrastructure and AWS connection setup.

Support deployment modes:

1. All components inside the customer network.
2. All components in an approved government data center or government cloud.
3. Central control plane plus customer edge gateway.
4. Managed single-tenant deployment in an approved local provider environment.

### 7.12 Future telemetry

Adopt OpenTelemetry conventions for MetricOps' own instrumentation and future application telemetry. Loki or an approved log backend and Tempo or an approved trace backend may be introduced later. Wazuh, OpenSearch, or an existing SIEM can provide security-event integration in a future security-observability phase.

## 8. Core data model

Principal entities:

- PlatformUser, PlatformRole, PlatformSession.
- Customer, CustomerContact, Subscription, Entitlement.
- Deployment, DeploymentHeartbeat, Release, UpgradeStatus.
- CustomerUser, Team, Role, Permission, Scope, AccessReview.
- Workspace, Environment, BusinessService.
- Connection, ConnectionCapability, SecretReference, SyncRun.
- Resource, ResourceRelationship, ResourceCapability, ResourceTag.
- Dashboard, DashboardTemplate, PanelReference.
- AlertRuleReference, AlertInstance, AlertEvent, Silence.
- Incident, IncidentParticipant, IncidentEvent, FollowUp.
- MaintenanceWindow.
- ApprovalPolicy, ApprovalRequest, ApprovalDecision.
- Operation, OperationTransition, VerificationResult.
- SupportCase, SupportAccessGrant, SupportSession.
- Finding, FindingEvidence, FindingException.
- AuditEvent, Report, ReportSchedule.

Audit events must be append-only. Corrections are represented by additional events, never destructive edits. High-assurance deployments should support cryptographic chaining or periodic signed digests and export to write-protected storage.

## 9. Key workflows

### 9.1 Customer onboarding

```text
Platform creates customer record
→ customer owner is invited
→ customer accepts terms and configures identity
→ deployment is registered
→ workspace and environments are created
→ monitoring connection is configured and tested
→ resources are discovered
→ customer classifies resources and ownership
→ dashboards and alerts are enabled
→ pilot acceptance checks begin
```

### 9.2 AWS onboarding

```text
Customer selects AWS connection
→ MetricOps generates connection ID and external ID
→ customer reviews and deploys role template
→ customer enters/confirms role ARN and regions
→ backend assumes role with temporary session
→ account identity and permissions are validated
→ supported resources are discovered
→ customer selects and classifies resources
→ scheduled metric synchronization begins
```

### 9.3 Alert-to-incident

```text
Monitoring rule becomes firing
→ Alertmanager groups and routes notification
→ authenticated webhook reaches MetricOps
→ alert maps to customer and resource
→ operator acknowledges and takes ownership
→ critical alert creates or joins an incident
→ evidence, notes, and actions form the timeline
→ health recovers and monitoring confirms stability
→ incident is resolved and later closed
```

### 9.4 Controlled operation

```text
User selects supported action and supplies reason
→ backend authenticates user and customer context
→ permission, resource, capability, and policy are checked
→ approval is requested when required
→ job is queued with idempotency key
→ connector obtains temporary provider authorization
→ typed operation executes
→ provider state and health evidence are verified
→ final result and audit event are committed
→ requesting user and approvers receive the result
```

### 9.5 Customer-approved support

```text
Support case exists
→ MetricOps support requests exact diagnostic scope
→ customer owner/admin reviews request
→ customer approves scope and expiry
→ support engineer uses MFA to start session
→ UI displays active support banner
→ every view and action is audited
→ customer revokes access or expiry ends session
→ support-access report remains available
```

## 10. Security architecture

### 10.1 Trust boundaries

- Browser to control plane.
- Platform administration to customer administration.
- Control plane to customer deployment or edge gateway.
- Backend to metrics, visualization, identity, and cloud providers.
- Worker to operational connectors.
- Application database to secret-management system.
- One customer to every other customer.

### 10.2 Mandatory controls

- MFA for privileged accounts.
- Short session lifetime and immediate session revocation.
- Deny-by-default backend authorization.
- Customer identifier derived from authenticated context, never trusted from request payload alone.
- Input validation and output encoding.
- CSRF protection where cookie authentication is used.
- Strict CORS, content-security, and transport-security configuration.
- Request-size, query-cost, and rate limits.
- Egress allow-lists or proxy controls for user-configured endpoints to prevent server-side request forgery.
- Encryption in transit and at rest.
- Secret redaction and centralized secure logging.
- Dependency, container, and source scanning.
- Signed builds, provenance, and software bill of materials.
- Backup encryption and tested restoration.
- Independent penetration testing before production acceptance.
- Minimum twelve-month audit/security-event retention unless an approved customer policy requires longer.

### 10.3 Multi-tenant isolation testing

Automated tests must attempt horizontal and vertical privilege escalation across every customer-owned API. Test identifiers belonging to another customer, missing scopes, archived customers, suspended subscriptions, revoked users, expired support grants, and asynchronous jobs with mismatched customer context.

### 10.4 Monitoring system protection

- Do not expose Prometheus, exporters, Alertmanager, Grafana, or the edge gateway publicly without explicit protected architecture.
- Disable unnecessary administrative endpoints.
- Use network segmentation and reverse-proxy authentication.
- Restrict advanced query access because expensive queries can affect availability.
- Treat metric labels and resource metadata as customer-sensitive even where an upstream system does not treat metrics as secret.

## 11. Non-functional requirements

### Availability

- Pilot target: documented single-node availability limitations and tested restart/recovery.
- Production target: control-plane availability objective agreed per deployment, with redundant components where required.
- Monitoring collection must continue locally when a central control plane is temporarily unavailable.

### Performance

- Common dashboard API responses should meet an agreed percentile objective under pilot load.
- Expensive metric queries must be bounded and cancellable.
- Large discovery runs must be paginated and asynchronous.
- Interface lists require pagination, filtering, and server-side sorting.

### Scalability

- Initial design target: multiple customers, hundreds of resources per customer, and controlled concurrent dashboard queries.
- Scale workers independently before decomposing the core application.
- Establish tested limits rather than making unsupported unlimited-scale claims.

### Reliability and failure isolation

- One failing connection cannot exhaust global workers.
- Retries must not create duplicate operations or audit events.
- External errors use circuit breaking or backoff where appropriate.
- Missing telemetry must not be silently interpreted as healthy.

### Maintainability

- Typed connector contracts.
- Versioned database migrations, dashboard templates, role templates, and APIs.
- Architecture decision records for significant technical choices.
- Automated unit, integration, contract, end-to-end, and security tests.
- Backward-compatible upgrade and rollback plans.

### Accessibility and usability

- Desktop-browser-first responsive layout.
- Keyboard-accessible navigation and forms.
- Color is not the only carrier of health or severity.
- Times, units, time zones, and data freshness are explicit.
- Errors explain the problem, likely causes, and safe actions without exposing internals.

## 12. API and integration conventions

- Version APIs under `/api/v1`.
- Use opaque UUID identifiers.
- Support idempotency keys for action and creation endpoints where retries are likely.
- Include request/correlation IDs in responses and audit events.
- Return stable error codes plus safe human-readable messages.
- Use cursor pagination for changing event streams and large inventories.
- Use OpenAPI as the interface contract.
- Authenticate inbound alert webhooks and protect against replay.
- Sign edge operations and include expiry, nonce, customer, target, and action type.
- Never return stored secret values after initial enrollment.

Representative API groups:

```text
/api/v1/platform/customers
/api/v1/platform/deployments
/api/v1/platform/support-cases
/api/v1/customers/current/users
/api/v1/workspaces
/api/v1/environments
/api/v1/connections
/api/v1/resources
/api/v1/metrics/query
/api/v1/alerts
/api/v1/incidents
/api/v1/maintenance-windows
/api/v1/operations
/api/v1/approvals
/api/v1/support-access-grants
/api/v1/audit-events
/api/v1/reports
```

## 13. Testing strategy

### Unit tests

- Policy and permission evaluation.
- Capability checks.
- Metric normalization and unit conversion.
- Finding evaluation.
- Job transitions and idempotency.
- Report calculations.

### Integration tests

- PostgreSQL tenancy and transaction behavior.
- Identity-provider claims and session revocation.
- Prometheus and Alertmanager APIs.
- Grafana provisioning and supported versions.
- AWS role assumption, pagination, throttling, revocation, and partial permissions.
- Queue retry and worker recovery.
- Secret-manager access and rotation.

### End-to-end tests

- Platform creates customer without customer access.
- Customer connects infrastructure and discovers resources.
- Viewer cannot modify settings or execute operations.
- Alert becomes incident and is resolved.
- Customer grants and revokes support access.
- Approved non-production operation executes and verifies.
- Report matches known monitoring fixtures.

### Security tests

- Cross-customer identifier substitution.
- Privilege escalation and role manipulation.
- Expired/revoked support sessions.
- Server-side request forgery through connection endpoints.
- PromQL injection and excessive queries.
- Webhook forgery and replay.
- Job replay or duplicate execution.
- Secret leakage in logs, errors, support bundles, and reports.
- Dependency and container vulnerabilities.

### Recovery tests

- Database backup restoration.
- Secret-store recovery.
- Queue interruption during operation.
- Edge disconnection and reconnection.
- Failed upgrade and rollback.
- Monitoring continuation during control-plane outage.

## 14. Deployment acceptance checklist

- Approved network and data-flow diagram.
- Named system owner, administrator, security contact, and support contact.
- Data classification and residency decision.
- TLS certificates and trusted time synchronization.
- Identity and MFA configured.
- Least-privilege monitoring connections validated.
- Production operations disabled unless separately approved.
- Backup schedule and restoration test completed.
- Audit retention and export configured.
- Alert ownership and escalation tested.
- Customer support-access policy configured.
- Administrative and user training delivered.
- Vulnerability and penetration-test findings resolved or formally accepted.
- Upgrade and rollback runbooks approved.
- Pilot acceptance metrics baselined.

## 15. Recommended build order

1. Establish identity, customer boundary, audit foundation, and project observability.
2. Prove one Linux host → Prometheus → backend → customer dashboard path.
3. Add endpoint and database monitoring.
4. Add alert ingestion, acknowledgement, incident, and maintenance behavior.
5. Build Platform Administration and Customer Administration as separate shells and permission domains.
6. Add AWS read-only connection, discovery, metrics, and findings.
7. Add reporting and customer-approved support sessions.
8. Harden deployment, backup, upgrades, and recovery.
9. Add one non-production controlled operation.
10. Run the measured customer pilot before expanding providers or signals.

## 16. Future roadmap

Possible later increments, driven by signed customer demand:

- Windows infrastructure monitoring.
- Docker and Kubernetes inventory, metrics, rollout, and scaling operations.
- Additional AWS services and organization-level account aggregation.
- Microsoft Azure and Google Cloud connectors.
- Logs and security-event correlation.
- Distributed traces and application performance monitoring.
- Security Hub or existing SIEM integration.
- Vulnerability and patch-management integration.
- Public or stakeholder status pages.
- Advanced service-level objectives and error budgets.
- Capacity forecasting and anomaly detection.
- Mobile incident acknowledgement.
- High-availability government-cloud reference architecture.

## 17. Product success definition

MetricOps succeeds when a customer can reliably answer:

- What infrastructure and digital services do we operate?
- Which critical services are currently unavailable or at risk?
- Is an issue caused by the application, host, database, endpoint, monitoring connection, or cloud resource?
- Which alerts require action and who owns them?
- What changed before and during an incident?
- Which operational actions are supported and authorized?
- Who requested, approved, executed, and verified each action?
- Who can access each environment?
- Did MetricOps support personnel access the customer, why, and under whose approval?
- Can we produce trustworthy availability, capacity, incident, and audit evidence without manual reconstruction?

The product is ready for expansion only after the first customer pilot proves these answers with real infrastructure and repeatable evidence.
