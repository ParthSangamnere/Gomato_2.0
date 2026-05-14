#!/usr/bin/env bash
# Exit on error
set -o errexit

# Build Frontend
cd gomato-dashboard
npm install
npm run build

# Build Backend
cd ../gomato-backend
npm install
