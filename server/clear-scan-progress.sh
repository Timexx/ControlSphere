#!/bin/bash

# Script to clear stuck scan progress entries
# Usage: ./clear-scan-progress.sh [machineId]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

if [ -n "$1" ]; then
  echo "🧹 Clearing scan progress for machine: $1"
  node scripts/clear-scan-progress.js "$1"
else
  echo "🧹 Clearing ALL scan progress entries..."
  echo ""
  echo "Usage: $0 [machineId]"
  echo ""
  echo "Examples:"
  echo "  $0                           # Clear all scan progress"
  echo "  $0 cm123abc456def           # Clear specific machine"
  echo ""
  
  # List current stuck scans
  echo "📊 Current scan progress entries:"
  npx prisma db execute --stdin <<EOF
SELECT machineId, phase, progress, startedAt 
FROM ScanProgressState 
ORDER BY startedAt DESC;
EOF
  
  echo ""
  read -p "Clear all entries? (y/N): " confirm
  if [[ $confirm == [yY] ]]; then
    node scripts/clear-scan-progress.js
  else
    echo "Cancelled"
  fi
fi
