# Lexora frontend

This is a static Next.js frontend that calls the Lexora backend over HTTP.

## Backend connection

Set `NEXT_PUBLIC_API_BASE_URL` to the backend's origin only, with no path or trailing slash. The current `http://localhost:3000` setting is a local-development placeholder. The v4 backend ZIP supplies Next.js API route source and a setup script, but no standalone package manifest, deployment target, public hostname, or fixed port. Its README says to merge the routes into a Next.js project and run `npm run dev`; that does not establish a deployed backend URL. The existing workspace note about port 5000 describes a separate Express API artifact, not the v4 backend.

Before treating the frontend as connected:

1. Replace the placeholder with the actual backend origin.
2. Set the backend's `ALLOWED_ORIGINS` to this site's exact origin and restart the backend.
3. Confirm that `GET <backend-origin>/api/health` succeeds from the deployed frontend.

The home-page status indicator reports the health request result. A placeholder value alone does not mean the backend is reachable.
