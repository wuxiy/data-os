{% macro generate_alias_name(custom_alias_name, node) -%}
    {%- if node.resource_type == 'test' -%}
        {{ env_var('DATAOS_TEST_NAMESPACE', 'default') }}__{{ custom_alias_name or node.name }}
    {%- else -%}
        {{ custom_alias_name or node.name }}
    {%- endif -%}
{%- endmacro %}
