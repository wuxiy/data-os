\set ON_ERROR_STOP on

-- This migration is intentionally idempotent. It provisions the named tenant
-- used by data-os, binds the service account to it, and archives only the
-- historical Gate 1 Shell definitions created by this repository.
BEGIN;

SELECT CASE
    WHEN lower(:'tenant_code') <> 'default' THEN 1
    ELSE CAST(:'tenant_code' || current_timestamp::text AS integer)
END;

LOCK TABLE t_ds_tenant IN SHARE ROW EXCLUSIVE MODE;

SELECT EXISTS (
    SELECT 1
    FROM t_ds_queue
    WHERE id = (:'queue_id')::integer
) AS queue_exists \gset
\if :queue_exists
\else
    SELECT CAST('DolphinScheduler queue ' || :'queue_id' || ' does not exist' AS integer);
\endif

INSERT INTO t_ds_tenant (tenant_code, description, queue_id, create_time, update_time)
SELECT :'tenant_code', :'tenant_description', (:'queue_id')::integer, now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM t_ds_tenant WHERE tenant_code = :'tenant_code'
);

UPDATE t_ds_tenant
SET description = :'tenant_description',
    queue_id = (:'queue_id')::integer,
    update_time = now()
WHERE tenant_code = :'tenant_code';

SELECT EXISTS (
    SELECT 1
    FROM t_ds_user
    WHERE user_name = :'service_user'
) AS service_user_exists \gset
\if :service_user_exists
\else
    SELECT CAST('DolphinScheduler service user ' || :'service_user' || ' does not exist' AS integer);
\endif

UPDATE t_ds_user
SET tenant_id = (
        SELECT id FROM t_ds_tenant WHERE tenant_code = :'tenant_code'
    ),
    update_time = now()
WHERE user_name = :'service_user';

UPDATE t_ds_workflow_definition
SET release_state = 0,
    update_time = now()
WHERE left(name, length(:'legacy_workflow_prefix')) = :'legacy_workflow_prefix'
  AND COALESCE(release_state, 0) <> 0
  AND project_code = (:'legacy_project_code')::bigint;

COMMIT;
