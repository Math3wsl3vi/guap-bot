#!/bin/bash

PROMPT="$1"

CONTEXT=$(find . -type f \
  ! -path "*/node_modules/*" \
  ! -path "*/.git/*" \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.json" -o -name "*.md" \) | \
  xargs cat)

echo -e "Here is the project context:\n\n$CONTEXT\n\nTask: $PROMPT" | ollama run dscoder-pro
