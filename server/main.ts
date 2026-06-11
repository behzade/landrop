import {
  FileSystem,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import {
  BunFileSystem,
  BunHttpServer,
  BunPath,
  BunRuntime,
} from "@effect/platform-bun"
import { Database, type Statement } from "bun:sqlite"
import { embeddedFiles } from "bun"
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { homedir, networkInterfaces } from "node:os"
import { basename, extname, join, resolve, sep } from "node:path"
import { Effect, Layer, Option, PubSub, Schedule, Stream, pipe } from "effect"
import { toString as qrToString } from "qrcode"
import "./embedded-assets.generated"

type ItemKind = "paste" | "file" | "folder"

interface ItemInsert {
  readonly id: string
  readonly kind: ItemKind
  readonly name: string
  readonly mimeType: string | null
  readonly size: number
  readonly path: string
  readonly createdAt: number
}

interface ItemRow {
  readonly id: string
  readonly kind: ItemKind
  readonly name: string
  readonly mime_type: string | null
  readonly size: number
  readonly path: string
  readonly created_at: number
}

interface TrustedDeviceInsert {
  readonly id: string
  readonly name: string
  readonly tokenHash: string
  readonly createdAt: number
}

interface TrustedDeviceRow {
  readonly id: string
  readonly name: string
  readonly created_at: number
  readonly revoked_at: number | null
}

interface AudioEntry {
  readonly name: string
  readonly path: string
  readonly mime_type: string
  readonly size: number
  readonly modified_at: number | null
}

type EmbeddedFile = Blob & {
  readonly name?: string
}

const PORT = Number(process.env.PORT ?? "8787")
const HOST = process.env.HOST ?? "0.0.0.0"
const TOKEN_COOKIE = "landrop_token"
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const PAIRING_CODE = process.env.LANDROP_PAIRING_CODE ?? randomPairingCode()

const ROOT = process.env.LANDROP_ROOT ?? join(homedir(), "Downloads", "landrop")
const PASTES_DIR = join(ROOT, "pastes")
const UPLOADS_DIR = join(ROOT, "uploads")
const DATA_DIR = join(ROOT, "data")
const DIST_DIR = resolve(process.cwd(), "dist")
const DIST_INDEX = join(DIST_DIR, "index.html")
const PUBLIC_DIR = resolve(process.cwd(), "public")
const EMBEDDED_ASSETS = embeddedAssetMap()
const NO_STORE_HEADERS = {
  "cache-control": "no-store",
}

installTerminalCleanup()

class AppDb extends Effect.Service<AppDb>()("AppDb", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    yield* fs.makeDirectory(DATA_DIR, { recursive: true })

    const db = new Database(join(DATA_DIR, "landrop.sqlite"), {
      create: true,
    })

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
      `)
    )
    yield* Effect.sync(() =>
      db.run(`
        CREATE TABLE IF NOT EXISTS trusted_devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER
        )
      `)
    )

    const insertItem = db.prepare(`
      INSERT INTO items (id, kind, name, mime_type, size, path, created_at)
      VALUES ($id, $kind, $name, $mimeType, $size, $path, $createdAt)
    `)
    const insertTrustedDevice = db.prepare(`
      INSERT INTO trusted_devices (id, name, token_hash, created_at)
      VALUES ($id, $name, $tokenHash, $createdAt)
    `)

    const selectRecent = db.prepare(`
      SELECT id, kind, name, mime_type, size, path, created_at
      FROM items
      ORDER BY created_at DESC
      LIMIT 50
    `)

    const selectById = db.prepare(`
      SELECT id, kind, name, mime_type, size, path, created_at
      FROM items
      WHERE id = $id
      LIMIT 1
    `)
    const deleteItem = db.prepare(`
      DELETE FROM items
      WHERE id = $id
    `)
    const selectTrustedToken = db.prepare(`
      SELECT id, name, created_at, revoked_at
      FROM trusted_devices
      WHERE token_hash = $tokenHash AND revoked_at IS NULL
      LIMIT 1
    `)
    const selectTrustedDevices = db.prepare(`
      SELECT id, name, created_at, revoked_at
      FROM trusted_devices
      WHERE revoked_at IS NULL
      ORDER BY created_at DESC
    `)
    const updateTrustedDeviceName = db.prepare(`
      UPDATE trusted_devices
      SET name = $name
      WHERE id = $id AND revoked_at IS NULL
    `)
    const revokeTrustedDevice = db.prepare(`
      UPDATE trusted_devices
      SET revoked_at = $revokedAt
      WHERE id = $id AND revoked_at IS NULL
    `)

    return {
      insert: (item: ItemInsert) => insert(insertItem, item),
      trustDevice: (device: TrustedDeviceInsert) =>
        insertTrustedDeviceRow(insertTrustedDevice, device),
      recent: Effect.sync(() => selectRecent.all() as ItemRow[]),
      findById: (id: string) =>
        Effect.sync(() => selectById.get({ $id: id }) as ItemRow | null),
      deleteItem: (id: string) =>
        Effect.sync(() => deleteItem.run({ $id: id })),
      trustedDevices: Effect.sync(
        () => selectTrustedDevices.all() as TrustedDeviceRow[]
      ),
      findTrustedDeviceByToken: (token: string) =>
        Effect.sync(
          () =>
            selectTrustedToken.get({
              $tokenHash: hashToken(token),
            }) as TrustedDeviceRow | null
        ),
      renameTrustedDevice: (id: string, name: string) =>
        Effect.sync(() =>
          updateTrustedDeviceName.run({ $id: id, $name: name })
        ),
      revokeTrustedDevice: (id: string) =>
        Effect.sync(() =>
          revokeTrustedDevice.run({ $id: id, $revokedAt: Date.now() })
        ),
      hasTrustedToken: (token: string) =>
        Effect.sync(() =>
          Boolean(selectTrustedToken.get({ $tokenHash: hashToken(token) }))
        ),
    } as const
  }),
}) {}

class ItemEvents extends Effect.Service<ItemEvents>()("ItemEvents", {
  effect: Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<string>(64)

    return {
      publishItemsChanged: () => PubSub.publish(pubsub, "items-changed"),
      stream: Stream.fromPubSub(pubsub),
    } as const
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
    })
  )

const insertTrustedDeviceRow = (
  statement: Statement,
  device: TrustedDeviceInsert
) =>
  Effect.sync(() =>
    statement.run({
      $id: device.id,
      $name: device.name,
      $tokenHash: device.tokenHash,
      $createdAt: device.createdAt,
    })
  )

const ensureInbox = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  yield* fs.makeDirectory(PASTES_DIR, { recursive: true })
  yield* fs.makeDirectory(UPLOADS_DIR, { recursive: true })
})

const redirectHome = HttpServerResponse.redirect("/", {
  status: 303,
})

const handlePaste = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const form = yield* Effect.tryPromise(() => webRequest.formData())
  const text = String(form.get("text") ?? "")

  if (!text.trim()) {
    return HttpServerResponse.text("Empty paste", { status: 400 })
  }

  const db = yield* AppDb
  const fs = yield* FileSystem.FileSystem
  const id = randomUUID()
  const formattedJson = tryFormatJson(text)
  const extension = formattedJson ? "json" : "txt"
  const filename = `${new Date().toISOString().replaceAll(":", "-")}-${id}.${extension}`
  const path = join(PASTES_DIR, filename)
  const body = formattedJson ?? text

  yield* fs.writeFileString(path, body)
  yield* db.insert({
    id,
    kind: "paste",
    name: filename,
    mimeType: formattedJson ? "application/json" : "text/plain",
    size: Buffer.byteLength(body),
    path,
    createdAt: Date.now(),
  })
  yield* (yield* ItemEvents).publishItemsChanged()

  return redirectHome
})

const handleUpload = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const form = yield* Effect.tryPromise(() => webRequest.formData())
  const file = form.get("file")

  if (!(file instanceof File) || file.size === 0) {
    return HttpServerResponse.text("Missing file", { status: 400 })
  }

  const db = yield* AppDb
  const fs = yield* FileSystem.FileSystem
  const id = randomUUID()
  const safeName = sanitizeFilename(file.name || "upload.bin")
  const filename = `${id}-${safeName}`
  const path = join(UPLOADS_DIR, filename)
  const bytes = new Uint8Array(
    yield* Effect.tryPromise(() => file.arrayBuffer())
  )

  yield* fs.writeFile(path, bytes)
  yield* db.insert({
    id,
    kind: "file",
    name: file.name || safeName,
    mimeType: file.type || null,
    size: file.size,
    path,
    createdAt: Date.now(),
  })
  yield* (yield* ItemEvents).publishItemsChanged()

  return redirectHome
})

const handleServeFolder = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const form = yield* Effect.tryPromise(() => webRequest.formData())
  const rawPath = String(form.get("path") ?? "").trim()

  if (!rawPath) {
    return HttpServerResponse.text("Folder path is required", { status: 400 })
  }

  const fs = yield* FileSystem.FileSystem
  const servedPath = resolve(expandHomePath(rawPath))
  const folderPath = yield* Effect.either(fs.realPath(servedPath))

  if (folderPath._tag === "Left") {
    return HttpServerResponse.text("Folder does not exist", { status: 400 })
  }

  const stat = yield* fs.stat(folderPath.right)

  if (stat.type !== "Directory") {
    return HttpServerResponse.text("Path is not a folder", { status: 400 })
  }

  const db = yield* AppDb
  const id = randomUUID()

  yield* db.insert({
    id,
    kind: "folder",
    name: basename(servedPath) || servedPath,
    mimeType: "inode/directory",
    size: 0,
    path: servedPath,
    createdAt: Date.now(),
  })
  yield* (yield* ItemEvents).publishItemsChanged()

  return redirectHome
})

const handleItems = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const db = yield* AppDb
  const rows = yield* db.recent

  return yield* HttpServerResponse.json(rows, {
    headers: NO_STORE_HEADERS,
  })
})

const handleOpenItem = serveItemFile(false)
const handleDownloadItem = serveItemFile(true)
const handleDeleteItem = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const params = yield* HttpRouter.params
  const id = params.id

  if (!id) {
    return HttpServerResponse.text("Missing item id", { status: 400 })
  }

  const db = yield* AppDb
  const item = yield* db.findById(id)

  if (!item) {
    return HttpServerResponse.text("Item not found", { status: 404 })
  }

  yield* db.deleteItem(id)
  yield* (yield* ItemEvents).publishItemsChanged()

  return yield* HttpServerResponse.json(
    { removed: true },
    {
      headers: NO_STORE_HEADERS,
    }
  )
})
const handleFolderItems = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const folder = yield* findFolderItem

  if (!folder.ok) {
    return folder.response
  }

  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const nestedPath = new URL(webRequest.url).searchParams.get("path") ?? ""
  const resolved = yield* resolveFolderChild(folder.item.path, nestedPath)

  if (!resolved.ok) {
    return resolved.response
  }

  const fs = yield* FileSystem.FileSystem
  const stat = yield* fs.stat(resolved.path)

  if (stat.type !== "Directory") {
    return HttpServerResponse.text("Path is not a folder", { status: 400 })
  }

  const names = yield* fs.readDirectory(resolved.path)
  const entries: Array<{
    name: string
    path: string
    kind: "file" | "folder"
    mime_type: string
    size: number
    modified_at: number | null
  }> = []

  for (const name of names) {
    const relativePath = join(nestedPath, name).replaceAll("\\", "/")
    const entryPath = yield* resolveFolderChild(folder.item.path, relativePath)

    if (!entryPath.ok) {
      continue
    }

    const info = yield* fs.stat(entryPath.path)

    if (info.type !== "Directory" && info.type !== "File") {
      continue
    }

    entries.push({
      name,
      path: relativePath,
      kind: info.type === "Directory" ? "folder" : "file",
      mime_type:
        info.type === "Directory" ? "inode/directory" : mimeTypeForFile(name),
      size: info.type === "Directory" ? 0 : Number(info.size),
      modified_at: Option.getOrUndefined(info.mtime)?.getTime() ?? null,
    })
  }

  return yield* HttpServerResponse.json(
    {
      path: nestedPath,
      entries: entries.sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "folder" ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      }),
    },
    {
      headers: NO_STORE_HEADERS,
    }
  )
})
const handleOpenFolderFile = serveFolderFile(false)
const handleDownloadFolderFile = serveFolderFile(true)
const handleFolderAudio = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const folder = yield* findFolderItem

  if (!folder.ok) {
    return folder.response
  }

  const entries = yield* collectAudioEntries(folder.item.path)

  return yield* HttpServerResponse.json(
    {
      entries,
    },
    {
      headers: NO_STORE_HEADERS,
    }
  )
})

const handleAuthStatus = Effect.gen(function* () {
  const trusted = yield* isTrustedRequest
  const currentDevice = yield* currentTrustedDevice

  return yield* HttpServerResponse.json({ trusted, currentDevice })
})

const handlePair = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const body = (yield* Effect.tryPromise(() => webRequest.json())) as {
    readonly code?: unknown
    readonly name?: unknown
  }
  const code = typeof body.code === "string" ? body.code.trim() : ""

  if (!constantTimeEqual(code, PAIRING_CODE)) {
    return HttpServerResponse.text("Invalid pairing code", { status: 401 })
  }

  const token = randomBytes(32).toString("base64url")
  const db = yield* AppDb
  const id = randomUUID()
  const name =
    sanitizeDeviceName(typeof body.name === "string" ? body.name : "") ||
    "Browser"
  const createdAt = Date.now()

  yield* db.trustDevice({
    id,
    name,
    tokenHash: hashToken(token),
    createdAt,
  })

  return yield* HttpServerResponse.json(
    {
      trusted: true,
      currentDevice: {
        id,
        name,
        created_at: createdAt,
        revoked_at: null,
      },
    },
    {
      headers: {
        "set-cookie": `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_MAX_AGE_SECONDS}`,
      },
    }
  )
})

const handlePairingCodeStatus = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const code = new URL(webRequest.url).searchParams.get("code")?.trim() ?? ""

  return yield* HttpServerResponse.json({
    valid: constantTimeEqual(code, PAIRING_CODE),
  })
})

const handleDevices = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const db = yield* AppDb
  const devices = yield* db.trustedDevices
  const currentDevice = yield* currentTrustedDevice

  return yield* HttpServerResponse.json({
    currentDeviceId: currentDevice?.id ?? null,
    devices,
  })
})

const handleRenameCurrentDevice = Effect.gen(function* () {
  const device = yield* currentTrustedDevice

  if (!device) {
    return HttpServerResponse.text(
      "Current request is not backed by a paired device token",
      { status: 400 }
    )
  }

  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const body = (yield* Effect.tryPromise(() => webRequest.json())) as {
    readonly name?: unknown
  }
  const name = sanitizeDeviceName(
    typeof body.name === "string" ? body.name : ""
  )

  if (!name) {
    return HttpServerResponse.text("Device name is required", { status: 400 })
  }

  const db = yield* AppDb

  yield* db.renameTrustedDevice(device.id, name)

  return yield* HttpServerResponse.json({
    ...device,
    name,
  })
})

const handleRevokeDevice = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const params = yield* HttpRouter.params
  const id = params.id

  if (!id) {
    return HttpServerResponse.text("Missing device id", { status: 400 })
  }

  const currentDevice = yield* currentTrustedDevice
  const db = yield* AppDb

  yield* db.revokeTrustedDevice(id)

  const headers =
    currentDevice?.id === id
      ? {
          "set-cookie": `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        }
      : undefined

  return yield* HttpServerResponse.json({ revoked: true }, { headers })
})

const handleConnect = HttpServerResponse.json({
  url: connectUrlWithPairingCode(),
})

const handleEvents = Effect.gen(function* () {
  const auth = yield* requireTrustedDevice

  if (auth) {
    return auth
  }

  const events = yield* ItemEvents
  const itemEvents = pipe(
    events.stream,
    Stream.map((event) => `event: ${event}\ndata: ${Date.now()}\n\n`)
  )
  const keepAlive = pipe(
    Stream.make(`: keepalive ${Date.now()}\n\n`),
    Stream.repeat(Schedule.spaced("5 seconds"))
  )
  const stream = pipe(itemEvents, Stream.merge(keepAlive), Stream.encodeText)

  return HttpServerResponse.stream(stream, {
    contentType: "text/event-stream; charset=utf-8",
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
})

const serveIndex = Effect.gen(function* () {
  const embeddedIndex = EMBEDDED_ASSETS.get("index.html")

  if (embeddedIndex) {
    return HttpServerResponse.fromWeb(
      new Response(embeddedIndex, {
        headers: {
          "content-type": embeddedIndex.type || "text/html; charset=utf-8",
        },
      })
    )
  }

  const fs = yield* FileSystem.FileSystem
  const hasBuild = yield* fs.exists(DIST_INDEX)

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
      }
    )
  }

  return yield* pipe(HttpServerResponse.file(DIST_INDEX), Effect.flatten)
})

const serveStatic = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const pathname = new URL(webRequest.url).pathname
  const embeddedAsset = EMBEDDED_ASSETS.get(pathname.replace(/^\/+/, ""))

  if (embeddedAsset) {
    return HttpServerResponse.fromWeb(
      new Response(embeddedAsset, {
        headers: {
          "content-type": embeddedAsset.type || mimeTypeForPath(pathname),
        },
      })
    )
  }

  const filePath = resolve(DIST_DIR, `.${pathname}`)

  if (!isInside(filePath, DIST_DIR)) {
    return HttpServerResponse.text("Not found", { status: 404 })
  }

  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs.exists(filePath)

  if (exists) {
    return yield* pipe(HttpServerResponse.file(filePath), Effect.flatten)
  }

  const publicFilePath = resolve(PUBLIC_DIR, `.${pathname}`)

  if (!isInside(publicFilePath, PUBLIC_DIR)) {
    return HttpServerResponse.text("Not found", { status: 404 })
  }

  const publicExists = yield* fs.exists(publicFilePath)

  if (!publicExists) {
    return HttpServerResponse.text("Not found", { status: 404 })
  }

  return yield* pipe(HttpServerResponse.file(publicFilePath), Effect.flatten)
})

const apiApp = pipe(
  HttpRouter.empty,
  HttpRouter.post("/api/paste", handlePaste),
  HttpRouter.post("/api/upload", handleUpload),
  HttpRouter.post("/api/folders", handleServeFolder),
  HttpRouter.get("/api/auth/status", handleAuthStatus),
  HttpRouter.post("/api/pair", handlePair),
  HttpRouter.get("/api/pairing-code", handlePairingCodeStatus),
  HttpRouter.get("/api/devices", handleDevices),
  HttpRouter.patch("/api/devices/current", handleRenameCurrentDevice),
  HttpRouter.del("/api/devices/:id", handleRevokeDevice),
  HttpRouter.get("/api/items", handleItems),
  HttpRouter.del("/api/items/:id", handleDeleteItem),
  HttpRouter.get("/api/items/:id/open", handleOpenItem),
  HttpRouter.get("/api/items/:id/download", handleDownloadItem),
  HttpRouter.get("/api/items/:id/folder", handleFolderItems),
  HttpRouter.get("/api/items/:id/folder/audio", handleFolderAudio),
  HttpRouter.get("/api/items/:id/folder/open", handleOpenFolderFile),
  HttpRouter.get("/api/items/:id/folder/download", handleDownloadFolderFile),
  HttpRouter.get("/api/connect", handleConnect),
  HttpRouter.get("/api/events", handleEvents)
)

const app = pipe(
  apiApp,
  HttpRouter.get("/", serveIndex),
  HttpRouter.get("/assets/*", serveStatic),
  HttpRouter.get("/favicon.svg", serveStatic),
  HttpRouter.get("/landrop.svg", serveStatic),
  HttpRouter.get("/manifest.webmanifest", serveStatic),
  HttpRouter.get("/sw.js", serveStatic),
  HttpRouter.get("*", serveIndex)
)

const ServerLive = BunHttpServer.layer({
  hostname: HOST,
  idleTimeout: 120,
  port: PORT,
})

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)
const AppDbLive = Layer.provide(AppDb.Default, PlatformLive)
const Live = Layer.mergeAll(
  ServerLive,
  PlatformLive,
  AppDbLive,
  ItemEvents.Default
)

const program = pipe(
  ensureInbox,
  Effect.zipRight(
    Effect.promise(() => startupMessage()).pipe(Effect.flatMap(Effect.log))
  ),
  Effect.zipRight(HttpServer.serveEffect(app)),
  Effect.zipRight(Effect.never),
  Effect.provide(Live),
  Effect.scoped
)

function sanitizeFilename(name: string) {
  return name.replaceAll("/", "_").replaceAll("\\", "_")
}

function expandHomePath(path: string) {
  if (path === "~") {
    return homedir()
  }

  if (path.startsWith(`~${sep}`) || path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }

  return path
}

function tryFormatJson(input: string): string | null {
  try {
    return JSON.stringify(JSON.parse(input), null, 2)
  } catch {
    return null
  }
}

function embeddedAssetMap() {
  const assets = new Map<string, Blob>()

  for (const file of embeddedFiles as readonly EmbeddedFile[]) {
    if (!file.name) {
      continue
    }

    const name = normalizeAssetName(file.name)

    assets.set(name, file)

    const distIndex = name.indexOf("dist/")

    if (distIndex >= 0) {
      assets.set(name.slice(distIndex + "dist/".length), file)
    }
  }

  return assets
}

function normalizeAssetName(name: string) {
  return name.replaceAll("\\", "/").replace(/^\/+/, "")
}

function mimeTypeForPath(pathname: string) {
  if (pathname.endsWith(".css")) {
    return "text/css; charset=utf-8"
  }

  if (pathname.endsWith(".js")) {
    return "text/javascript; charset=utf-8"
  }

  if (pathname.endsWith(".webmanifest")) {
    return "application/manifest+json; charset=utf-8"
  }

  if (pathname.endsWith(".svg")) {
    return "image/svg+xml"
  }

  if (pathname.endsWith(".woff2")) {
    return "font/woff2"
  }

  return "application/octet-stream"
}

function mimeTypeForFile(pathname: string) {
  const extension = extname(pathname).toLowerCase()

  if (extension === ".aac") return "audio/aac"
  if (extension === ".flac") return "audio/flac"
  if (extension === ".m4a") return "audio/mp4"
  if (extension === ".mp3") return "audio/mpeg"
  if (extension === ".oga" || extension === ".ogg") return "audio/ogg"
  if (extension === ".opus") return "audio/ogg"
  if (extension === ".wav") return "audio/wav"
  if (extension === ".webm") return "audio/webm"
  if (extension === ".avif") return "image/avif"
  if (extension === ".gif") return "image/gif"
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".svg") return "image/svg+xml"
  if (extension === ".webp") return "image/webp"
  if (extension === ".json") return "application/json"
  if (extension === ".md") return "text/markdown; charset=utf-8"
  if (extension === ".txt") return "text/plain; charset=utf-8"

  return "application/octet-stream"
}

const findFolderItem = Effect.gen(function* () {
  const params = yield* HttpRouter.params
  const id = params.id

  if (!id) {
    return {
      ok: false as const,
      response: HttpServerResponse.text("Missing item id", { status: 400 }),
    }
  }

  const db = yield* AppDb
  const item = yield* db.findById(id)

  if (!item) {
    return {
      ok: false as const,
      response: HttpServerResponse.text("Item not found", { status: 404 }),
    }
  }

  if (item.kind !== "folder") {
    return {
      ok: false as const,
      response: HttpServerResponse.text("Item is not a folder", {
        status: 400,
      }),
    }
  }

  return { ok: true as const, item }
})

function resolveFolderChild(rootPath: string, childPath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(rootPath)
    const resolved = resolve(root, childPath || ".")

    if (!isInside(resolved, root)) {
      return {
        ok: false as const,
        response: HttpServerResponse.text("Path is outside served folder", {
          status: 403,
        }),
      }
    }

    const exists = yield* fs.exists(resolved)

    if (!exists) {
      return {
        ok: false as const,
        response: HttpServerResponse.text("Folder path not found", {
          status: 404,
        }),
      }
    }

    const realPath = yield* fs.realPath(resolved)

    if (!isInside(realPath, root)) {
      return {
        ok: false as const,
        response: HttpServerResponse.text("Path is outside served folder", {
          status: 403,
        }),
      }
    }

    return { ok: true as const, path: realPath }
  })
}

function collectAudioEntries(rootPath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(rootPath)
    const entries: AudioEntry[] = []
    const pending = [""]
    const maxEntries = 5000

    while (pending.length > 0 && entries.length < maxEntries) {
      const relativeDir = pending.shift() ?? ""
      const directoryPath = resolve(root, relativeDir || ".")

      if (!isInside(directoryPath, root)) {
        continue
      }

      const names = yield* Effect.either(fs.readDirectory(directoryPath))

      if (names._tag === "Left") {
        continue
      }

      for (const name of names.right) {
        if (entries.length >= maxEntries) {
          break
        }

        const relativePath = join(relativeDir, name).replaceAll("\\", "/")
        const resolved = resolve(root, relativePath)

        if (!isInside(resolved, root)) {
          continue
        }

        const info = yield* Effect.either(fs.stat(resolved))

        if (info._tag === "Left") {
          continue
        }

        if (info.right.type === "Directory") {
          pending.push(relativePath)
          continue
        }

        if (info.right.type !== "File") {
          continue
        }

        const mimeType = mimeTypeForFile(name)

        if (!mimeType.startsWith("audio/")) {
          continue
        }

        entries.push({
          name,
          path: relativePath,
          mime_type: mimeType,
          size: Number(info.right.size),
          modified_at:
            Option.getOrUndefined(info.right.mtime)?.getTime() ?? null,
        })
      }
    }

    return entries.sort((left, right) =>
      left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )
  })
}

function serveItemFile(download: boolean) {
  return Effect.gen(function* () {
    const auth = yield* requireTrustedDevice

    if (auth) {
      return auth
    }

    const params = yield* HttpRouter.params
    const id = params.id

    if (!id) {
      return HttpServerResponse.text("Missing item id", { status: 400 })
    }

    const db = yield* AppDb
    const item = yield* db.findById(id)

    if (!item) {
      return HttpServerResponse.text("Item not found", { status: 404 })
    }

    if (item.kind === "folder") {
      return HttpServerResponse.text("Use the folder browser to open files", {
        status: 400,
      })
    }

    const path = resolve(item.path)
    const root = resolve(ROOT)

    if (!isInside(path, root)) {
      return HttpServerResponse.text("Item path is outside storage root", {
        status: 403,
      })
    }

    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(path)

    if (!exists) {
      return HttpServerResponse.text("File is missing on disk", { status: 404 })
    }

    const stat = yield* fs.stat(path)

    if (stat.type !== "File") {
      return HttpServerResponse.text("Path is not a file", { status: 400 })
    }

    return yield* serveFileWithRange({
      contentType: item.mime_type ?? "application/octet-stream",
      download,
      filename: item.name || basename(path),
      path,
      size: Number(stat.size),
    })
  })
}

function serveFolderFile(download: boolean) {
  return Effect.gen(function* () {
    const auth = yield* requireTrustedDevice

    if (auth) {
      return auth
    }

    const folder = yield* findFolderItem

    if (!folder.ok) {
      return folder.response
    }

    const request = yield* HttpServerRequest.HttpServerRequest
    const webRequest = yield* HttpServerRequest.toWeb(request)
    const nestedPath = new URL(webRequest.url).searchParams.get("path") ?? ""

    if (!nestedPath) {
      return HttpServerResponse.text("Missing file path", { status: 400 })
    }

    const path = yield* resolveFolderChild(folder.item.path, nestedPath)

    if (!path.ok) {
      return path.response
    }

    const fs = yield* FileSystem.FileSystem
    const stat = yield* fs.stat(path.path)

    if (stat.type !== "File") {
      return HttpServerResponse.text("Path is not a file", { status: 400 })
    }

    return yield* serveFileWithRange({
      contentType: mimeTypeForFile(path.path),
      download,
      filename: basename(path.path),
      path: path.path,
      size: Number(stat.size),
    })
  })
}

function serveFileWithRange({
  contentType,
  download,
  filename,
  path,
  size,
}: {
  contentType: string
  download: boolean
  filename: string
  path: string
  size: number
}) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const webRequest = yield* HttpServerRequest.toWeb(request)
    const range = parseRangeHeader(webRequest.headers.get("range"), size)
    const baseHeaders = {
      ...NO_STORE_HEADERS,
      "accept-ranges": "bytes",
      "content-type": contentType,
      ...(download
        ? {
            "content-disposition": `attachment; filename="${escapeHeaderFilename(filename)}"`,
          }
        : {}),
    }

    if (range?.status === "invalid") {
      return HttpServerResponse.fromWeb(
        new Response(null, {
          headers: {
            ...baseHeaders,
            "content-range": `bytes */${size}`,
          },
          status: 416,
        })
      )
    }

    if (range?.status === "partial") {
      const body = Bun.file(path).slice(range.start, range.end + 1)

      return HttpServerResponse.fromWeb(
        new Response(body, {
          headers: {
            ...baseHeaders,
            "content-length": String(range.end - range.start + 1),
            "content-range": `bytes ${range.start}-${range.end}/${size}`,
          },
          status: 206,
        })
      )
    }

    return HttpServerResponse.fromWeb(
      new Response(Bun.file(path), {
        headers: {
          ...baseHeaders,
          "content-length": String(size),
        },
      })
    )
  })
}

const requireTrustedDevice = Effect.gen(function* () {
  const trusted = yield* isTrustedRequest

  return trusted
    ? null
    : HttpServerResponse.text("Pairing required", { status: 401 })
})

const isTrustedRequest = Effect.gen(function* () {
  const device = yield* currentTrustedDevice

  if (device) {
    return true
  }

  const request = yield* HttpServerRequest.HttpServerRequest
  const remoteAddress = Option.getOrUndefined(request.remoteAddress)

  if (remoteAddress && isLoopbackAddress(remoteAddress)) {
    return true
  }

  return false
})

const currentTrustedDevice = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const token = request.cookies[TOKEN_COOKIE]

  if (!token) {
    return null
  }

  const db = yield* AppDb

  return yield* db.findTrustedDeviceByToken(token)
})

function isInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}${sep}`)
}

function escapeHeaderFilename(name: string) {
  return name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function parseRangeHeader(header: string | null, size: number) {
  if (!header) {
    return null
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())

  if (!match || size <= 0) {
    return { status: "invalid" as const }
  }

  const [, rawStart, rawEnd] = match

  if (!rawStart && !rawEnd) {
    return { status: "invalid" as const }
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd)

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { status: "invalid" as const }
    }

    return {
      status: "partial" as const,
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number(rawStart)
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return { status: "invalid" as const }
  }

  return {
    status: "partial" as const,
    start,
    end: Math.min(requestedEnd, size - 1),
  }
}

function sanitizeDeviceName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 80)
}

function serverUrls() {
  const urls = new Set<string>()

  if (HOST === "0.0.0.0" || HOST === "::") {
    urls.add(`http://localhost:${PORT}`)

    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) {
          urls.add(`http://${address.address}:${PORT}`)
        }
      }
    }
  } else {
    urls.add(`http://${HOST}:${PORT}`)
  }

  return [...urls]
}

function preferredConnectUrl() {
  const urls = serverUrls()

  return (
    urls.find((url) => !url.includes("localhost")) ??
    urls[0] ??
    `http://localhost:${PORT}`
  )
}

function connectUrlWithPairingCode() {
  const url = new URL(preferredConnectUrl())
  url.searchParams.set("pairingCode", PAIRING_CODE)

  return url.toString()
}

async function startupMessage() {
  const pairUrl = connectUrlWithPairingCode()
  const qr = await qrToString(pairUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    small: true,
    type: "terminal",
  })

  return [
    "LAN Drop is ready",
    "",
    "Scan this from your phone to pair and send immediately:",
    qr.trimEnd(),
    "",
    `Phone URL: ${pairUrl}`,
    `Desktop URLs: ${serverUrls().join("  ")}`,
    `Pairing code: ${PAIRING_CODE}`,
  ].join("\n")
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url")
}

function randomPairingCode() {
  return Array.from({ length: 3 }, () =>
    randomBytes(2).readUInt16BE(0).toString().padStart(5, "0")
  ).join("-")
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)

  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

function isLoopbackAddress(address: string) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  )
}

function installTerminalCleanup() {
  const cleanup = () => {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1l\x1b>")
    }
  }

  process.once("SIGINT", () => {
    cleanup()
    process.exit(130)
  })

  process.once("SIGTERM", () => {
    cleanup()
    process.exit(143)
  })

  process.once("exit", cleanup)
}

BunRuntime.runMain(program)
