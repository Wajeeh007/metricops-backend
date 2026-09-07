# MetricOps Product and Development Understanding

**Document type:** Internal working guide  
**Audience:** Product owner, architects, engineers, QA, security reviewers, and future AI-assisted development sessions  
**Purpose:** Preserve a clear shared understanding of what is being built, why it exists, and how development decisions should be evaluated

## 1. The simplest correct understanding

MetricOps is a governed layer above customer monitoring and infrastructure systems.

It answers four connected questions:

1. **What do we operate?** A normalized inventory of servers, applications, endpoints, databases, and cloud resources.
2. **Is it healthy?** Current and historical evidence of availability, latency, capacity, connection state, alerts, and monitoring freshness.
3. **What happened and who owns it?** Alert ownership, incident timeline, maintenance, recent changes, and audit evidence.
4. **What may we safely do?** Only resource-supported, policy-authorized, approved, typed, verified, and audited operations.

MetricOps is valuable because these answers are normally divided among many technical tools and people. It is not valuable merely because it draws charts.

## 2. Product identity

MetricOps should be positioned as an infrastructure assurance and controlled-operations platform.

Avoid reducing it to:

- A monitoring dashboard.
- A cloud-management console.
- A server restart tool.
- A security dashboard.
- A managed-service-provider portal.

It includes parts of each idea, but its defining feature is the combination of operational evidence and governance.

The core customer promise is:

> The customer remains in control of its infrastructure and data while MetricOps makes health, ownership, incidents, support, and authorized operations understandable and accountable.

## 3. Primary product distinction

The system has two administration planes.

### Platform Administration

Owned by the MetricOps operating company. It manages customer records, subscriptions, entitlements, deployments, versions, connection health, onboarding, and support cases.

Platform Administration does not automatically grant access to customer dashboards, metrics, settings, users, secrets, or infrastructure.

### Customer Operations

Owned by the customer. It manages customer users, workspaces, environments, connections, resources, dashboards, alerts, incidents, maintenance, policies, approvals, support grants, and audit evidence.

Any development shortcut that makes a MetricOps super administrator automatically all-powerful inside customer environments violates the product's trust model.

## 4. The initial product slice

The first sellable product is deliberately bounded:

- One customer-controlled installation or approved hosted deployment.
- Linux server monitoring.
- Endpoint and certificate monitoring.
- One database technology selected by the pilot customer.
- Existing metrics and detailed dashboard integration.
- AWS read-only connection for EC2, EBS, RDS, selected load balancing, service metrics, and alarms.
- A small set of explainable security, backup, monitoring, and resilience findings.
- Alert acknowledgement and incident workflow.
- Executive, capacity, availability, incident, and audit reporting.
- Platform and customer administration.
- Customer-approved, time-limited support access.
- One allow-listed non-production operation after read-only workflows are stable.

This is already a substantial MVP. New providers and major modules must not enter it simply because the architecture can theoretically support them.

## 5. The golden path

All development should support this end-to-end path:

```text
Create customer
→ customer owner configures workspace and users
→ connect monitoring and AWS using customer-controlled access
→ validate and discover resources
→ classify resources and business services
→ show fresh health and capacity evidence
→ detect and route an actionable alert
→ acknowledge, assign, investigate, and record an incident
→ optionally execute an approved non-production action
→ verify recovery
→ produce audit and availability evidence
```

A feature that does not strengthen this path or a mandatory security/deployment requirement is likely deferred.

## 6. System mental model

### Control plane

The control plane holds customer metadata, identity context, policy, inventory, workflow state, audit evidence, and reports. It coordinates integrations but does not need to own all underlying telemetry.

### Data plane

The data plane consists of the customer's metrics, cloud APIs, exporters, applications, databases, and future log/trace/security systems. It may remain fully inside the customer's network.

### Edge gateway

The edge gateway is used only when a centralized control plane needs bounded access to private customer systems. It initiates the connection outward and brokers allow-listed requests and typed operations. It is not a remote shell.

### Provider and connector layer

Connectors translate provider-specific discovery, metrics, capability, action, and error behavior into common MetricOps models. Common models must not erase important provider limitations.

### Evidence sources

Every status comes from evidence. Important interface elements should be able to explain:

- Which source produced the value.
- When it was collected.
- Whether it is current or stale.
- Whether it is direct, calculated, inferred, or manually classified.
- Which policy or threshold turned it into a status or finding.

## 7. Non-negotiable invariants

1. Customer context is determined by the authenticated backend, not accepted from an arbitrary request field.
2. Every customer-owned query includes an enforced customer boundary.
3. Platform roles and customer roles are distinct.
4. Support access is denied unless an active customer-approved grant covers the user, scope, resource, and time.
5. A secret can be replaced or rotated but is never redisplayed after enrollment.
6. Missing data is not healthy data.
7. An operation is not successful until its expected state and health have been verified.
8. Infrastructure operations are typed and allow-listed; arbitrary command text is prohibited.
9. Read-only and operational provider permissions are separate.
10. Audit records are append-only and corrections create new events.
11. Every resource displays only capabilities the current connection and provider actually support.
12. No customer monitoring endpoint is made public merely to simplify integration.
13. Security findings state exactly what was observed and do not claim more than the evidence proves.
14. Billing or platform support roles cannot silently become customer operators.
15. A retry must not execute the same infrastructure action twice.

## 8. Bounded contexts

Treat the following as separate modules even if they begin in one deployable backend:

- Platform Customers and Commercial Entitlements.
- Deployments and Release Health.
- Customer Tenancy and Access.
- Connections and Secret References.
- Inventory and Resource Relationships.
- Metrics Query and Dashboard References.
- Alerts and Incidents.
- Maintenance and Notifications.
- Policies, Approvals, Operations, and Verification.
- Support Cases and Support Access.
- Findings and Exceptions.
- Audit and Reports.

Modules should communicate through explicit services and domain events rather than reaching into one another's tables without ownership rules.

## 9. How to reason about health

Health is not one Boolean field. At minimum, consider:

- Resource lifecycle state.
- Monitoring connection health.
- Telemetry freshness.
- Availability check result.
- Capacity thresholds.
- Active alerts.
- Open incident impact.
- Maintenance state.
- Security/resilience findings.
- Recent operational verification.

An overall status must be a documented policy derived from these signals. The interface should preserve the underlying reasons so that a red or green badge is explainable.

## 10. How to reason about AWS

AWS is the first provider integration, not a special parallel product.

The connector should:

- Use a customer-owned cross-account role and temporary sessions.
- Validate the expected account before discovery.
- Respect approved regions and resource filters.
- Normalize supported resources into the common inventory.
- Preserve account, region, native identifier, tags, and provider capabilities.
- Combine cloud-service metrics with operating-system metrics where both describe one resource.
- Continue operating when a customer grants only partial read permissions, while clearly reporting unsupported evidence.
- Treat access revocation as normal customer control rather than an exceptional failure.

Operational permissions are attached separately and are never inferred from monitoring access.

## 11. How to reason about security

MetricOps contributes to security in three legitimate ways:

1. It protects its own identities, connections, secrets, and operations.
2. It reports selected explainable infrastructure configuration findings.
3. It creates evidence about access, changes, support sessions, incidents, and retention.

It does not prove that customer infrastructure is secure. Full threat detection, vulnerability management, endpoint security, log correlation, and independent compliance assessment remain separate capabilities or future integrations.

Use precise language:

- Prefer “encrypted according to observed provider setting” over “secure.”
- Prefer “no telemetry received in the last five minutes” over “server offline” when the source cannot prove power state.
- Prefer “management port exposed to all IPv4 addresses” over “server compromised.”
- Prefer “PISF-aligned evidence” over “PISF compliant” until assessed.

## 12. How to reason about support

Customer trust is part of the product architecture.

The default support workflow should solve most problems through:

- Deployment and connector-health metadata.
- Safe error codes.
- Customer-run connection tests.
- Secret-redacted diagnostic bundles.
- Documentation and guided remediation.

Remote support access is an exception initiated or approved by the customer. A support session must be obvious, temporary, scoped, revocable, and auditable. A general “impersonate customer” feature without these controls should not be implemented.

## 13. Development sequence

### Stage 1 — Foundations

- Confirm domain language and IDs.
- Establish separate platform and customer identities.
- Implement customer boundary, permission evaluation, sessions, and audit capture.
- Make the application itself observable from its first deployable version.

### Stage 2 — One monitoring flow

- Connect one host to the monitoring backend.
- Query a small curated metric set through the backend.
- Display source, time range, unit, freshness, and errors correctly.
- Trigger one alert and receive it into the customer workspace.

### Stage 3 — Resource context

- Add inventory, ownership, environment, business service, and relationships.
- Add endpoint and database monitoring.
- Build fixed overview and detail pages.

### Stage 4 — Administration

- Complete platform customer, deployment, entitlement, and support modules.
- Complete customer users, roles, connections, policies, and audit views.
- Prove that platform staff cannot cross the customer boundary.

### Stage 5 — AWS read-only

- Implement role onboarding, account verification, discovery, metrics, alarms, and findings.
- Correlate cloud and host records.
- Prove customer revocation and partial-permission behavior.

### Stage 6 — Operational workflow

- Implement policies, approvals, jobs, idempotency, verification, and live updates.
- Enable one non-production operation only.

### Stage 7 — Pilot hardening

- Complete reporting, backup, restore, upgrade, rollback, load, failure, and penetration tests.
- Deliver runbooks and role-based training.
- Run the pilot against agreed acceptance measures.

## 14. Definition of done for a feature

A feature is complete only when:

- Its customer and business outcome is documented.
- Permission and tenant behavior are defined and tested.
- Loading, empty, error, stale, degraded, and unsupported states are handled.
- Audit requirements are implemented.
- Secrets and sensitive data are classified.
- API and user documentation are updated.
- Unit and integration tests cover expected and forbidden behavior.
- Deployment, upgrade, and rollback impact is known.
- Monitoring and safe diagnostics exist.
- Accessibility and time-zone behavior are considered.
- The acceptance evidence is demonstrated, not merely asserted.

## 15. Engineering decision rules

- Prefer a modular monolith until measured constraints justify service decomposition.
- Prefer standard exporters and provider APIs over a proprietary collection agent.
- Prefer configuration and templates over hard-coded customer behavior.
- Prefer asynchronous jobs for discovery, reports, notifications, and operations.
- Persist authoritative workflow transitions; do not rely on an in-memory queue as history.
- Prefer short-lived provider credentials and signed requests.
- Prefer explicit unsupported states over simulated compatibility.
- Prefer a small validated alert catalogue over a large noisy catalogue.
- Prefer fixed dashboards and reports before building general-purpose editors.
- Prefer customer-visible controls over hidden operational convenience.

Exact implementation technologies and their responsibilities are maintained in the Detailed System Documentation so that this guide remains focused on product reasoning.

## 16. Questions to resolve during discovery

- Which government department and workload will be the first pilot?
- Will the pilot run in the department, KP Data Center, government cloud, or a managed local environment?
- Which database engine is most important for the pilot?
- Are Windows hosts required in the first customer installation?
- Which identity provider and MFA method are available?
- Which information is permitted to leave the customer network?
- What availability calculation and exclusion rules will the customer accept?
- What alert channels can be used in the target environment?
- What retention periods apply to operational metrics, incidents, reports, and security/audit events?
- Is remote vendor support permitted, and who may approve it?
- Which AWS accounts and regions are in scope?
- Which security and resilience findings are acceptable for the pilot?
- Is any infrastructure operation allowed, even in non-production?
- What procurement, hosting, security-assessment, and training evidence is mandatory?

These are discovery questions, not reasons to delay the core architecture. The system must support conservative defaults while customer-specific answers are obtained.

## 17. Development anti-goals

Do not:

- Build every screen in the original vision before proving the golden path.
- Reimplement the metrics database, visualization engine, or cloud console.
- store millions of samples in the application database.
- Add an unrestricted agent for engineering convenience.
- Hide authorization only in the interface.
- Use one global cloud credential for multiple customers.
- Make support access permanent.
- Promise production automation before verification and recovery behavior is proven.
- Confuse absence of alerts with health.
- Add artificial intelligence before data quality, ownership, and workflows are reliable.

## 18. Final internal test

When considering a design or feature, ask:

1. Does this help the customer understand infrastructure health or accountability?
2. Is the evidence source and freshness clear?
3. Does the customer retain control?
4. Are platform and customer privileges separated?
5. Is failure safe and understandable?
6. Can the behavior be audited and tested?
7. Does it strengthen the agreed MVP golden path?

If the answer to the last question is no, defer the feature unless it is required for security, deployment, procurement, or pilot acceptance.
