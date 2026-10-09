# Contributing

## Development

```shell
pnpm install
pnpm dev          # rebuild on change
pnpm test
pnpm lint
pnpm format
pnpm typecheck
```

## Playground

Runs the latest Directus with the built extension mounted, at http://localhost:8055 (`admin@example.com` / `password`).
Run `pnpm dev` alongside it, and Directus reloads the extension on every rebuild:

```shell
pnpm build
docker compose -f playground/compose.yaml up -d --wait
docker compose -f playground/compose.yaml down --volumes   # stop and delete all data
```

To pin a Directus version, or change the port or the license key, copy
[`playground/.env.example`](playground/.env.example) to `playground/.env`.
