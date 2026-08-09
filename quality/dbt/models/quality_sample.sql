{{ config(materialized='view') }}

select
    record_id,
    patient_id,
    status,
    updated_at
from {{ source('quality_acceptance', 'quality_sample') }}
