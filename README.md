# api.rustcult.com

Rust+ companion web app: Steam/Discord auth, server pairing via Rust+ API, shared map for teams.

## Production deploy

1. **Dependencies**: `npm install` (for `canvas`, install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev pkg-config first).
2. **Frontend**: `git submodule update --init rustcult.com`
3. **Secrets**: Copy `secrets.example.js` to `secrets.js` and set all values (MySQL, Steam API key, session secret, Discord app, SSL paths, ports, etc.). Use `host: '127.0.0.1'` for MySQL if IPv6 localhost causes ECONNREFUSED.
4. **Database**: Create MySQL/MariaDB database and user, run `setup-database.sql`. Ensure the DB user can connect from `127.0.0.1` if the app uses that host.
5. **SSL**: Put key and cert at the paths in `secrets.js` (e.g. Let's Encrypt for rustcult.com). For local/testing, a self-signed cert in `ssl/` is fine; use `httpPort`/`httpsPort` 3080/3443 to avoid needing root.
6. **Run**: `node server.js`, or install the systemd unit: `cp rustcult-api.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now rustcult-api`.

App listens on `secrets.httpPort` and `secrets.httpsPort`. Use a reverse proxy in front for SSL and ports 80/443 if desired.
