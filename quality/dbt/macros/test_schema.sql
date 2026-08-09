{% macro generate_schema_name_for_test(custom_schema_name, node) -%}
    {{ env_var('DORIS_AUDIT_DATABASE', 'dataos_quality_audit') }}
{%- endmacro %}
