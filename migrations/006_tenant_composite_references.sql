BEGIN;

-- Composite foreign keys make tenant ownership structural, not merely an
-- application convention. This prevents a tenant row from referencing an
-- object owned by another tenant even if application validation regresses.
ALTER TABLE resources ADD CONSTRAINT resources_customer_id_id_unique UNIQUE (customer_id, id);
ALTER TABLE alert_instances ADD CONSTRAINT alert_instances_customer_id_id_unique UNIQUE (customer_id, id);
ALTER TABLE incidents ADD CONSTRAINT incidents_customer_id_id_unique UNIQUE (customer_id, id);

ALTER TABLE alert_instances DROP CONSTRAINT alert_instances_resource_id_fkey;
ALTER TABLE alert_instances
  ADD CONSTRAINT alert_instances_customer_resource_fkey
  FOREIGN KEY (customer_id, resource_id) REFERENCES resources(customer_id, id);

ALTER TABLE alert_events DROP CONSTRAINT alert_events_alert_instance_id_fkey;
ALTER TABLE alert_events
  ADD CONSTRAINT alert_events_customer_alert_fkey
  FOREIGN KEY (customer_id, alert_instance_id) REFERENCES alert_instances(customer_id, id);

ALTER TABLE incidents DROP CONSTRAINT incidents_alert_instance_id_fkey;
ALTER TABLE incidents DROP CONSTRAINT incidents_resource_id_fkey;
ALTER TABLE incidents
  ADD CONSTRAINT incidents_customer_alert_fkey
  FOREIGN KEY (customer_id, alert_instance_id) REFERENCES alert_instances(customer_id, id);
ALTER TABLE incidents
  ADD CONSTRAINT incidents_customer_resource_fkey
  FOREIGN KEY (customer_id, resource_id) REFERENCES resources(customer_id, id);

ALTER TABLE incident_events DROP CONSTRAINT incident_events_incident_id_fkey;
ALTER TABLE incident_events
  ADD CONSTRAINT incident_events_customer_incident_fkey
  FOREIGN KEY (customer_id, incident_id) REFERENCES incidents(customer_id, id);

COMMIT;
