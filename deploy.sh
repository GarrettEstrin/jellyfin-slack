#!/bin/bash

# Deployment script for Jellyfin bot
# Usage: ./deploy.sh

set -e

echo "🚀 Starting deployment to mint.local..."

# SSH into the server and run deployment commands
ssh mint@mint.local << 'ENDSSH'
  cd /home/mint/jellyfin-slack
  
  echo "📦 Pulling latest changes from GitHub..."
  git checkout master
  git pull origin master
  
  echo "🛑 Stopping containers..."
  docker compose down
  
  echo "🔨 Building and starting containers..."
  docker compose up -d --build --force-recreate
  
  echo "✅ Deployment complete!"
  
  echo "📋 Container status:"
  docker compose ps
ENDSSH

echo ""
echo "🎉 Deployment finished!"
echo "📊 Check logs with: ssh mint@mint.local 'cd /home/mint/jellyfin-slack && docker compose logs -f'"