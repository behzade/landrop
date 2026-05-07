# landrop

Local-first LAN dropbox for sending text, JSON, and files from a phone browser to a desktop.

## Development

Install dependencies:

```bash
bun install
```

Run the backend and Vite frontend in separate terminals:

```bash
bun run dev:server
bun run dev
```

Open the Vite URL for HMR during development. The Vite server proxies `/api` to the Bun backend on port `8787`.

## Production

Build the frontend and start the Bun server:

```bash
bun run start
```

Build a standalone executable for the current platform:

```bash
bun run build:prod
./build/landrop
```

Cross-compile by passing a Bun compile target:

```bash
bun run build:prod -- --target=bun-linux-x64 --outfile=build/landrop-linux-x64
bun run build:prod -- --target=bun-darwin-arm64 --outfile=build/landrop-darwin-arm64
bun run build:prod -- --target=bun-windows-x64 --outfile=build/landrop-windows-x64.exe
```

Runtime data is stored in `~/Downloads/landrop` by default. Override with `LANDROP_ROOT`.
