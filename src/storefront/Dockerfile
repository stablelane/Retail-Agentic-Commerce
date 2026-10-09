# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Matter Storefront (Feature 18) Dockerfile
# Multi-stage build for optimized production image.
# Build context: src/storefront (see docker-compose.yml)

# Stage 1: Install dependencies
FROM node:20-slim AS deps

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . ./

# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
# API keys and upstream URLs are server-side only and supplied at runtime.
ARG NEXT_PUBLIC_API_VERSION=2026-01-16
ARG NEXT_PUBLIC_BRAND_NAME="Visit Dubai"
ARG NEXT_PUBLIC_DEMO_PREFILL=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_VERSION=${NEXT_PUBLIC_API_VERSION}
ENV NEXT_PUBLIC_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME}
ENV NEXT_PUBLIC_DEMO_PREFILL=${NEXT_PUBLIC_DEMO_PREFILL}

RUN pnpm build

# Stage 3: Production runner
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3002

ENV PORT=3002
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
