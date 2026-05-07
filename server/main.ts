import { FileSystem, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { BunFileSystem, BunHttpServer, BunPath, BunRuntime } from "@effect/platform-bun";
import { Database, type Statement } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { homedir, networkInterfaces } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Effect, Layer, PubSub, Schedule, Stream, pipe } from "effect";

type ItemKind = "paste" | "file";

interface ItemInsert {
  readonly id: string;
  readonly kind: ItemKind;
  readonly name: string;
  readonly mimeType: string | null;
  readonly size: number;
  readonly path: string;
  readonly createdAt: number;
}

interface ItemRow {
  readonly id: string;
  readonly kind: ItemKind;
  readonly name: string;
  readonly mime_type: string | null;
  readonly size: number;
  readonly path: string;
  readonly created_at: number;
}

const PORT = Number(process.env.PORT ?? "8787");
const HOST = process.env.HOST ?? "0.0.0.0";

const ROOT = process.env.LANDROP_ROOT ?? join(homedir(), "Downloads", "landrop");
const PASTES_DIR = join(ROOT, "pastes");
const UPLOADS_DIR = join(ROOT, "uploads");
const DATA_DIR = join(ROOT, "data");
const DIST_DIR = resolve(process.cwd(), "dist");
const DIST_INDEX = join(DIST_DIR, "index.html");

installTerminalCleanup();

class AppDb extends Effect.Service<AppDb>()("AppDb", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(DATA_DIR, { recursive: true });

    const db = new Database(join(DATA_DIR, "landrop.sqlite"), {
      create: true,
    });

    yield* Effect.sync(() =>
      db.run(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT,
          size INTEGER NOT NULL,
          path TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `),
    );

    const insertItem = db.prepare(`
      INSERT INTO items (id, kind, name, mime_type, size, path, created_at)
      VALUES ($id, $kind, $name, $mimeType, $size, $path, $createdAt)
    `);

    const selectRecent = db.prepare(`
      SELECT id, kind, name, mime_type, size, path, created_at
      FROM items
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const selectById = db.prepare(`
      SELECT id, kind, name, mime_type, size, path, created_at
      FROM items
      WHERE id = $id
      LIMIT 1
    `);

    return {
      insert: (item: ItemInsert) => insert(insertItem, item),
      recent: Effect.sync(() => selectRecent.all() as ItemRow[]),
      findById: (id: string) => Effect.sync(() => selectById.get({ $id: id }) as ItemRow | null),
    } as const;
  }),
}) {}

class ItemEvents extends Effect.Service<ItemEvents>()("ItemEvents", {
  effect: Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<string>(64);

    return {
      publishItemsChanged: () => PubSub.publish(pubsub, "items-changed"),
      stream: Stream.fromPubSub(pubsub),
    } as const;
  }),
}) {}

const insert = (statement: Statement, item: ItemInsert) =>
  Effect.sync(() =>
    statement.run({
      $id: item.id,
      $kind: item.kind,
      $name: item.name,
      $mimeType: item.mimeType,
      $size: item.size,
      $path: item.path,
      $createdAt: item.createdAt,
    }),
  );

const ensureInbox = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(PASTES_DIR, { recursive: true });
  yield* fs.makeDirectory(UPLOADS_DIR, { recursive: true });
});

const redirectHome = HttpServerResponse.redirect("/", {
  status: 303,
});

const handlePaste = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const form = yield* Effect.tryPromise(() => webRequest.formData());
  const text = String(form.get("text") ?? "");

  if (!text.trim()) {
    return HttpServerResponse.text("Empty paste", { status: 400 });
  }

  const db = yield* AppDb;
  const fs = yield* FileSystem.FileSystem;
  const id = randomUUID();
  const formattedJson = tryFormatJson(text);
  const extension = formattedJson ? "json" : "txt";
  const filename = `${new Date().toISOString().replaceAll(":", "-")}-${id}.${extension}`;
  const path = join(PASTES_DIR, filename);
  const body = formattedJson ?? text;

  yield* fs.writeFileString(path, body);
  yield* db.insert({
    id,
    kind: "paste",
    name: filename,
    mimeType: formattedJson ? "application/json" : "text/plain",
    size: Buffer.byteLength(body),
    path,
    createdAt: Date.now(),
  });
  yield* (yield* ItemEvents).publishItemsChanged();

  return redirectHome;
});

const handleUpload = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const form = yield* Effect.tryPromise(() => webRequest.formData());
  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return HttpServerResponse.text("Missing file", { status: 400 });
  }

  const db = yield* AppDb;
  const fs = yield* FileSystem.FileSystem;
  const id = randomUUID();
  const safeName = sanitizeFilename(file.name || "upload.bin");
  const filename = `${id}-${safeName}`;
  const path = join(UPLOADS_DIR, filename);
  const bytes = new Uint8Array(yield* Effect.tryPromise(() => file.arrayBuffer()));

  yield* fs.writeFile(path, bytes);
  yield* db.insert({
    id,
    kind: "file",
    name: file.name || safeName,
    mimeType: file.type || null,
    size: file.size,
    path,
    createdAt: Date.now(),
  });
  yield* (yield* ItemEvents).publishItemsChanged();

  return redirectHome;
});

const handleItems = Effect.gen(function* () {
  const db = yield* AppDb;
  const rows = yield* db.recent;

  return yield* HttpServerResponse.json(rows);
});

const handleOpenItem = serveItemFile(false);
const handleDownloadItem = serveItemFile(true);

const handleConnect = HttpServerResponse.json({
  url: preferredConnectUrl(),
});

const handleEvents = Effect.gen(function* () {
  const events = yield* ItemEvents;
  const itemEvents = pipe(
    events.stream,
    Stream.map((event) => `event: ${event}\ndata: ${Date.now()}\n\n`),
  );
  const keepAlive = pipe(
    Stream.make(`: keepalive ${Date.now()}\n\n`),
    Stream.repeat(Schedule.spaced("5 seconds")),
  );
  const stream = pipe(
    itemEvents,
    Stream.merge(keepAlive),
    Stream.encodeText,
  );

  return HttpServerResponse.stream(stream, {
    contentType: "text/event-stream; charset=utf-8",
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});

const serveIndex = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const hasBuild = yield* fs.exists(DIST_INDEX);

  if (!hasBuild) {
    return HttpServerResponse.text(
      `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>LAN Drop</title>
      <body style="font-family: monospace; padding: 24px">
        <h1>LAN Drop frontend is not built.</h1>
        <p>Run <code>bun run build</code>, then restart <code>bun run start:server</code>.</p>
      </body>`,
      {
        contentType: "text/html; charset=utf-8",
        status: 503,
      },
    );
  }

  return yield* pipe(HttpServerResponse.file(DIST_INDEX), Effect.flatten);
});

const serveStatic = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const pathname = new URL(webRequest.url).pathname;
  const filePath = resolve(DIST_DIR, `.${pathname}`);

  if (!isInsideDist(filePath)) {
    return HttpServerResponse.text("Not found", { status: 404 });
  }

  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(filePath);

  if (!exists) {
    return HttpServerResponse.text("Not found", { status: 404 });
  }

  return yield* pipe(HttpServerResponse.file(filePath), Effect.flatten);
});

const app = pipe(
  HttpRouter.empty,
  HttpRouter.post("/api/paste", handlePaste),
  HttpRouter.post("/api/upload", handleUpload),
  HttpRouter.get("/api/items", handleItems),
  HttpRouter.get("/api/items/:id/open", handleOpenItem),
  HttpRouter.get("/api/items/:id/download", handleDownloadItem),
  HttpRouter.get("/api/connect", handleConnect),
  HttpRouter.get("/api/events", handleEvents),
  HttpRouter.get("/", serveIndex),
  HttpRouter.get("/assets/*", serveStatic),
  HttpRouter.get("/vite.svg", serveStatic),
  HttpRouter.get("*", serveIndex),
);

const ServerLive = BunHttpServer.layer({
  hostname: HOST,
  idleTimeout: 120,
  port: PORT,
});

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const AppDbLive = Layer.provide(AppDb.Default, PlatformLive);
const Live = Layer.mergeAll(ServerLive, PlatformLive, AppDbLive, ItemEvents.Default);

const program = pipe(
  ensureInbox,
  Effect.zipRight(Effect.log(`LAN Drop listening:\n${serverUrls().join("\n")}`)),
  Effect.zipRight(HttpServer.serveEffect(app)),
  Effect.zipRight(Effect.never),
  Effect.provide(Live),
  Effect.scoped,
);

function sanitizeFilename(name: string) {
  return name.replaceAll("/", "_").replaceAll("\\", "_");
}

function tryFormatJson(input: string): string | null {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return null;
  }
}

function isInsideDist(path: string) {
  return path === DIST_DIR || path.startsWith(`${DIST_DIR}${sep}`);
}

function serveItemFile(download: boolean) {
  return Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params.id;

    if (!id) {
      return HttpServerResponse.text("Missing item id", { status: 400 });
    }

    const db = yield* AppDb;
    const item = yield* db.findById(id);

    if (!item) {
      return HttpServerResponse.text("Item not found", { status: 404 });
    }

    const path = resolve(item.path);
    const root = resolve(ROOT);

    if (!isInside(path, root)) {
      return HttpServerResponse.text("Item path is outside storage root", { status: 403 });
    }

    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path);

    if (!exists) {
      return HttpServerResponse.text("File is missing on disk", { status: 404 });
    }

    return yield* pipe(
      HttpServerResponse.file(path, {
        contentType: item.mime_type ?? "application/octet-stream",
        headers: download
          ? {
              "content-disposition": `attachment; filename="${escapeHeaderFilename(item.name || basename(path))}"`,
            }
          : undefined,
      }),
      Effect.flatten,
    );
  });
}

function isInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function escapeHeaderFilename(name: string) {
  return name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function serverUrls() {
  const urls = new Set<string>();

  if (HOST === "0.0.0.0" || HOST === "::") {
    urls.add(`http://localhost:${PORT}`);

    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) {
          urls.add(`http://${address.address}:${PORT}`);
        }
      }
    }
  } else {
    urls.add(`http://${HOST}:${PORT}`);
  }

  return [...urls];
}

function preferredConnectUrl() {
  const urls = serverUrls();

  return urls.find((url) => !url.includes("localhost")) ?? urls[0] ?? `http://localhost:${PORT}`;
}

function installTerminalCleanup() {
  const cleanup = () => {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1l\x1b>");
    }
  };

  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  process.once("exit", cleanup);
}

BunRuntime.runMain(program);
