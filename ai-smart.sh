#!/bin/bash

PROMPT="$1"

CONTEXT=$(git ls-files | grep -E "\.(ts|tsx|js|json|md)$" | xargs cat)

echo -e "Here is the project context:\n\n$CONTEXT\n\nTask: $PROMPT" | ollama run dscoder-pro
