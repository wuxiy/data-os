#!/usr/bin/env sh

# Parse the small dotenv subset used by deployment scripts as data, never as
# shell code. Existing environment variables win over values from the file.
load_dotenv() {
  dotenv_file=$1
  [ -r "$dotenv_file" ] || return 0

  while IFS= read -r dotenv_line || [ -n "$dotenv_line" ]; do
    case "$dotenv_line" in
      ""|[[:space:]]*|\#*) continue ;;
    esac
    dotenv_key=${dotenv_line%%=*}
    [ "$dotenv_key" != "$dotenv_line" ] || continue
    case "$dotenv_key" in
      ""|[!A-Za-z_]*|*[!A-Za-z0-9_]*) continue ;;
    esac
    dotenv_value=${dotenv_line#*=}
    case "$dotenv_value" in
      \"*\") dotenv_value=${dotenv_value#\"}; dotenv_value=${dotenv_value%\"} ;;
      \'*\') dotenv_value=${dotenv_value#\'}; dotenv_value=${dotenv_value%\'} ;;
    esac
    dotenv_is_set=
    eval "dotenv_is_set=\${$dotenv_key+x}"
    if [ "$dotenv_is_set" != x ]; then
      export "$dotenv_key=$dotenv_value"
    fi
  done < "$dotenv_file"
}
