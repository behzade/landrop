# Repository Guidelines

## Project Structure & Module Organization

This is a Bun-powered React/Vite app with a TypeScript backend. Frontend code lives in `src/`, with `src/main.tsx` as the entry point and `src/App.tsx` as the main app. UI primitives are in `src/components/ui/`, shared helpers are in `src/lib/`, and assets are split between `src/assets/` and `public/`. Backend code lives in `server/`; helper scripts live in `scripts/`. Production artifacts are written to `dist/` and `build/`; do not edit them by hand.

## Build, Test, and Development Commands

- `bun install`: install dependencies from `bun.lock`.
- `bun run dev`: run the combined local development workflow.
- `bun run dev:web`: run only the Vite frontend, exposed on `0.0.0.0`.
- `bun run dev:server`: run only the Bun backend on port `8787`.
- `bun run build`: type-check project references and build the Vite frontend.
- `bun run build:prod`: build a standalone executable.
- `bun run start`: build, then run the production server.
- `bun run lint`: run ESLint across the repository.
- `bun run typecheck`: run frontend and server TypeScript checks without emitting files.
- `bun run format`: format TypeScript and TSX files with Prettier.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep app component files in PascalCase, and use lowercase filenames for shared shadcn-style primitives such as `src/components/ui/button.tsx`. Put cross-cutting helpers in `src/lib/`. Formatting is managed by Prettier with the Tailwind CSS plugin. ESLint enforces TypeScript, React Hooks, and React Refresh rules.

## Testing Guidelines

There is currently no dedicated test runner configured. Verify changes with `bun run typecheck`, `bun run lint`, and `bun run build`. For backend behavior, run `bun run dev:server` and exercise API paths through the Vite proxy or browser workflow. If adding tests, colocate them near the code under test as `*.test.ts` or `*.test.tsx`, and add the test command to `package.json`.

## Commit & Pull Request Guidelines

Recent commits use concise Conventional Commit prefixes, especially `feat:` and `fix:`. Follow that pattern, for example `feat: add trusted device export` or `fix: handle upload errors`. Pull requests should include a summary, verification commands, linked issues when applicable, and screenshots or recordings for UI changes. Call out changes affecting `~/Downloads/landrop` or `LANDROP_ROOT`.

## Security & Configuration Tips

Runtime data is stored in `~/Downloads/landrop` by default. Use `LANDROP_ROOT` for local testing when you need an isolated data directory. Avoid committing generated binaries, local runtime data, or secrets.
