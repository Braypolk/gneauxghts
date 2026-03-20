# Gneauxghts Sync Server

Hosted and self-hostable sync server for single-user cross-device vault sync.

## What It Provides

- Email magic-link auth skeleton
- Per-user single vault provisioning
- Device registration
- Vault manifest endpoint
- Incremental change feed
- Note snapshot push with revision conflict detection
- Trash/restore push with revision conflict detection
- PostgreSQL metadata storage
- Local filesystem blob storage for note revision snapshots

## Configuration

Copy `.env.example` to `.env` and adjust as needed.

Required:

- `DATABASE_URL`

Common defaults:

- `BIND_ADDR=0.0.0.0:8787`
- `APP_BASE_URL=http://localhost:8787`
- `BLOB_ROOT=/var/lib/gneauxghts-sync/blobs`
- `MAGIC_LINK_TTL_MINUTES=15`
- `SESSION_TTL_DAYS=30`
- `ALLOW_INSECURE_TOKEN_RESPONSE=true`

`ALLOW_INSECURE_TOKEN_RESPONSE=true` is useful for local development because the server returns the raw magic-link token in the response. For a hosted deployment, set it to `false` and replace the current dev-only delivery behavior with real email sending.

## Run Locally

```bash
cd sync-server
cp .env.example .env
cargo run
```

## Run With Docker Compose

```bash
cd sync-server
cp .env.example .env
docker compose up
```

## API

- `POST /auth/request-magic-link`
- `POST /auth/complete`
- `GET /v1/sync/manifest`
- `GET /v1/sync/changes?cursor=0&limit=100`
- `GET /v1/sync/notes/:note_id`
- `POST /v1/sync/notes`
- `POST /v1/sync/trash`

Protected endpoints require `Authorization: Bearer <session_token>`.

The request/response types live in [`crates/sync-contract`](../crates/sync-contract).
