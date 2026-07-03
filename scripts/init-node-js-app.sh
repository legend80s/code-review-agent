#!/bin/bash
set -euo pipefail

set -x

pnpm init --init-type module --init-package-manager && git init && tsgo --init --types=node --checkJs=true && pnpm install -D @types/node && biome init && echo node_modules/ > .gitignore

# node ./modify-node-js-app.ts

# modify package.json to include "scripts":
# "typecheck": "tsgo --noEmit",
# "test": "node --test",
# "pub:patch": "npm version patch",
# "pub:minor": "npm version minor",
# "pub:major": "npm version major",
# "preversion": "npm test && npm run typecheck",
# "postversion": "npm publish && git push && git push --tags"

# 最佳实践 一键发布 `npm run pub:patch` / `npm run pub:minor` / `npm run pub:major`
npm pkg set scripts.typecheck="tsgo --noEmit" \
  scripts.test="node --test" \
  scripts.pub:patch="npm version patch" \
  scripts.pub:minor="npm version minor" \
  scripts.pub:major="npm version major" \
  scripts.preversion="npm test && npm run typecheck" \
  scripts.postversion="npm publish && git push && git push --tags"