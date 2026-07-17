# Fastest Launch Plan (GoDaddy + VPS)

This is the easiest production route for the current codebase:

1. Host this `landing-page` app on a VPS (Ubuntu recommended).
2. Point GoDaddy DNS to the VPS.
3. Put Nginx in front of Node.
4. Enable SSL with Certbot.
5. Configure desktop software to pull from the live feed endpoint.

## 1) Server Prerequisites

Run on VPS:

```bash
sudo apt update
sudo apt install -y nginx unzip
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2) Deploy Landing App

From local machine (PowerShell):

```powershell
cd d:\timeshareprojec\landing-page\tools
.\deploy-vps.ps1 -Host "YOUR_VPS_IP" -User "ubuntu" -SshKeyPath "C:\path\to\key.pem"
```

On VPS, set real env values:

```bash
cd /var/www/freedomshare-landing
nano .env
```

Recommended `.env` values:

```env
PORT=8080
LANDING_FEED_TOKEN=replace_with_long_secret
LANDING_FEED_TOKEN_HEADER=Authorization
```

Restart app:

```bash
pm2 restart freedomshare-landing --update-env
pm2 save
```

## 3) Configure Nginx

Copy config template from `tools/nginx-freedomsharesolutions.conf` to:

`/etc/nginx/sites-available/freedomsharesolutions`

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/freedomsharesolutions /etc/nginx/sites-enabled/freedomsharesolutions
sudo nginx -t
sudo systemctl reload nginx
```

## 4) GoDaddy DNS

In GoDaddy DNS for your domain:

- A record: `@` -> `YOUR_VPS_IP`
- CNAME: `www` -> `@`

Wait for DNS propagation.

## 5) SSL (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d freedomsharesolutions.com -d www.freedomsharesolutions.com
```

## 6) Verify Landing Site + Feed

- `https://freedomsharesolutions.com/health`
- `https://freedomsharesolutions.com/.well-known/freedomshare-leads.json`

If token is enabled, test with header:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://freedomsharesolutions.com/.well-known/freedomshare-leads.json
```

## 7) Connect Main Software Pull

In main app `.env.local` (`d:\timeshareprojec\.env.local`):

```env
LANDING_LEADS_FEED_URL=https://freedomsharesolutions.com/.well-known/freedomshare-leads.json
LANDING_LEADS_FEED_TOKEN=YOUR_TOKEN
LANDING_LEADS_TOKEN_HEADER=Authorization
LANDING_LEADS_FEED_FORMAT=auto
LANDING_LEADS_SOURCE=landing_page_pull
```

Restart desktop/software process after env update.

## 8) End-to-End Test

1. Submit test form on landing page.
2. Confirm lead appears in landing feed.
3. Run Admin "Landing Pull" in software.
4. Confirm lead appears in employee queue.
