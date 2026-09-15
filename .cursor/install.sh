#!/usr/bin/env bash
# Idempotent repository bootstrap for the MASTER EYE Cloud Agent environment.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[install] Installing Node dependencies (runs postinstall copy-cesium)…"
npm install

echo "[install] Installing Python worker dependencies…"
pip3 install --user -r workers/requirements.txt

if [ ! -f .env.local ]; then
  echo "[install] Seeding .env.local from .env.example…"
  cp .env.example .env.local
else
  echo "[install] .env.local already present — leaving as-is."
fi

echo "[install] Done."
