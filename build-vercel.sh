#!/bin/sh
set -e

echo "Building intro-builder monorepo for Vercel..."

# Install all dependencies
pnpm install --frozen-lockfile

# Build the web app
pnpm --filter @intro-builder/web build

echo "Build completed successfully!"
