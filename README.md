# Lexora workspace

This repository contains the Lexora frontend and the deterministic NoticeDesk backend in a pnpm workspace.

## Requirements

- Node.js compatible with the workspace packages (Node 20+ recommended)
- pnpm (use the version in your Node environment)

## Install

From this folder, run `pnpm install`.

## Backend

Copy `artifacts/noticedesk-backend/.env.backend.example` to `artifacts/noticedesk-backend/.env.local` and configure the allowed frontend origin. Start with:

`pnpm --filter @workspace/noticedesk-backend dev`

Read the terminal output for the actual backend port. Do not assume it is 3000 if that port is occupied.

## Frontend

Copy `artifacts/notice-on-the-desk/.env.example` to `artifacts/notice-on-the-desk/.env.local`, set `NEXT_PUBLIC_API_BASE_URL` to the backend origin, and set the backend `ALLOWED_ORIGINS` to the exact frontend origin. For the Windows development setup, start the frontend with:

`pnpm --filter @workspace/notice-on-the-desk exec next dev --webpack --hostname 0.0.0.0 --port 3001`

The frontend is a static-export app for production; its development server calls the separate backend.

## Samples and limits

Synthetic samples are included for demonstration and testing. The registry is synthetic and is not an official government database. The application is informational and does not replace professional advice.

## Environment files

Local `.env.local` files and secrets are intentionally excluded. Use the checked-in `.env.example` and `.env.backend.example` templates.
