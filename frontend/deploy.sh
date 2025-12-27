#!/bin/bash

# deploy.sh - Deployment script with automatic version bump
set -e

BUMP_TYPE=${1:-patch}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR"
BACKEND_DIR="$SCRIPT_DIR/../Backend"

echo "🚀 Starting deployment with $BUMP_TYPE version bump..."

increment_version() {
    local version=$1
    local bump=$2
    IFS='.' read -r major minor patch <<< "$version"
    case $bump in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
    esac
    echo "$major.$minor.$patch"
}

# 1. Get current version
CURRENT_VERSION=$(grep "const APP_VERSION" "$FRONTEND_DIR/vite.config.js" | sed "s/.*'\(.*\)'.*/\1/")
echo "📌 Current version: $CURRENT_VERSION"

# 2. Calculate and Update versions
NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$BUMP_TYPE")
echo "📌 New version: $NEW_VERSION"

sed -i "s/const APP_VERSION = '.*'/const APP_VERSION = '$NEW_VERSION'/" "$FRONTEND_DIR/vite.config.js"
sed -i "s/const APP_VERSION = '.*'/const APP_VERSION = '$NEW_VERSION'/" "$BACKEND_DIR/app.js"
echo "✅ Updated versions in config files"

# 3. Build frontend
echo "🔨 Building frontend..."
cd "$FRONTEND_DIR"
npm install  # Ensure dependencies are up to date
npm run build

# 4. Refresh Services
echo "🔄 Refreshing Backend (PM2)..."
cd "$BACKEND_DIR"
pm2 restart wolfkrypt-api  # Matches the name we used in PM2 setup

echo "🔄 Refreshing Nginx..."
sudo systemctl restart nginx

echo ""
echo "🎉 Deployment complete!"
echo "   New Version: $NEW_VERSION"
echo "   Frontend: kite.wolfkrypt.me"
echo "   Backend:  api.wolfkrypt.me"