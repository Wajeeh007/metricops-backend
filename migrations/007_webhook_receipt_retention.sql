BEGIN;

CREATE OR REPLACE FUNCTION prune_metricops_webhook_receipts(p_retention interval DEFAULT interval '24 hours')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  IF p_retention < interval '10 minutes' OR p_retention > interval '30 days' THEN
    RAISE EXCEPTION 'webhook receipt retention must be between 10 minutes and 30 days';
  END IF;
  DELETE FROM public.webhook_receipts WHERE received_at < clock_timestamp() - p_retention;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION prune_metricops_webhook_receipts(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_metricops_webhook_receipts(interval) TO metricops_worker;

COMMIT;
