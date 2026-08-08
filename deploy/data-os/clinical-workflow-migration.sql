\set ON_ERROR_STOP on

-- Archive only the data-os projection of the historical Gate 1 Shell
-- experiment. Current clinical SeaTunnel jobs are not matched by these names.
BEGIN;

UPDATE data_os.ingestion_jobs
SET status = 'ARCHIVED'
WHERE upper(executor) = 'DOLPHINSCHEDULER'
  AND (
      left(name, length(:'legacy_job_prefix')) = :'legacy_job_prefix'
      OR left(name, length('dataos_gate1_shell_')) = 'dataos_gate1_shell_'
  )
  AND status <> 'ARCHIVED';

COMMIT;
