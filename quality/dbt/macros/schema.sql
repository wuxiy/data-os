{% macro generate_schema_name(custom_schema_name, node) -%}
    {% if node.resource_type == 'test' %}
        {{ env_var('DORIS_AUDIT_DATABASE', 'dataos_quality_audit') }}
    {% elif custom_schema_name is none %}
        {{ target.schema }}
    {% else %}
        {{ target.schema }}_{{ custom_schema_name | trim }}
    {% endif %}
{%- endmacro %}
