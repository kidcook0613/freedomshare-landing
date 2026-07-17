# Easiest Launch (No VPS, No Server IP Needed)

If you only bought the domain and do not have a server yet, this is the easiest route:

1. Deploy `landing-page` to Render (or similar Node host).
2. Point `www` in GoDaddy to Render using CNAME.
3. Forward root `@` to `https://www.freedomsharesolutions.com` in GoDaddy.
4. Configure software feed pull URL to your live `www` domain endpoint.

## Why this is easiest

- No server setup (no Linux, no nginx, no SSH).
- No public VPS IP required.
- Keeps your backend endpoints working (`/api/qualify`, feed JSON).

## Step 1: Deploy landing app on Render

- Create account at https://render.com
- New -> Web Service
- Connect repo that contains this project
- Root directory: `landing-page`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `PORT=10000`
  - `LANDING_FEED_TOKEN=<strong-random-token>`
  - `LANDING_FEED_TOKEN_HEADER=Authorization`
  - `LEAD_DATA_DIR=/var/data`

### Persistent storage (important)

Attach a persistent disk in Render and mount it at `/var/data`.
This keeps lead submissions from being lost on restart.

## Step 2: Add custom domain in Render

Add:
- `www.freedomsharesolutions.com`

Render will give you a target like:
- `your-service.onrender.com`

## Step 3: GoDaddy DNS

In GoDaddy DNS for `freedomsharesolutions.com`:

- Add/Edit `CNAME`
  - Host: `www`
  - Points to: `your-service.onrender.com`
  - TTL: default

For root domain (`@`), use GoDaddy Forwarding:

- Forward domain `freedomsharesolutions.com` -> `https://www.freedomsharesolutions.com`
- Type: Permanent (301)
- Forward settings: Forward only

## Step 4: Verify landing backend

Check in browser:

- `https://www.freedomsharesolutions.com/health`
- `https://www.freedomsharesolutions.com/.well-known/freedomshare-leads.json`

If feed token is enabled, verify with header-aware client.

## Step 5: Connect software lead pull

In main app `.env.local` set:

```env
LANDING_LEADS_FEED_URL=https://www.freedomsharesolutions.com/.well-known/freedomshare-leads.json
LANDING_LEADS_FEED_TOKEN=<same token as LANDING_FEED_TOKEN>
LANDING_LEADS_TOKEN_HEADER=Authorization
LANDING_LEADS_FEED_FORMAT=auto
LANDING_LEADS_SOURCE=landing_page_pull
```

Restart software after env changes.

## Step 6: End-to-end test

1. Submit a test form on the live landing page.
2. Confirm it appears in feed JSON.
3. Run Admin -> Landing Pull in software.
4. Confirm lead appears in employee queue.
