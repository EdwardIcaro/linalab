#!/bin/bash

# Run Prisma migrations
echo "Running Prisma migrations..."
npx prisma db push --accept-data-loss

# Start the application
echo "Starting LinaX server..."
node dist/index.js
