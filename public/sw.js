const APP_CACHE = "landrop-app-v1"
const MEDIA_CACHE = "landrop-media-v1"
const APP_ASSETS = ["/", "/manifest.webmanifest", "/landrop.svg", "/favicon.svg"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== MEDIA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const { request } = event

  if (request.method !== "GET") {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (isMediaRequest(url)) {
    event.respondWith(networkWithMediaFallback(request))
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(networkWithAppFallback(request))
    return
  }

  if (isAppAsset(url)) {
    event.respondWith(cacheFirst(request))
  }
})

async function networkWithAppFallback(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(APP_CACHE)
    cache.put(request, response.clone())
    return response
  } catch {
    return (await caches.match(request)) ?? caches.match("/")
  }
}

async function networkWithMediaFallback(request) {
  try {
    return await fetch(request)
  } catch {
    const cached = await caches.open(MEDIA_CACHE)
    const response = await cached.match(request, { ignoreVary: true })

    if (response) {
      const range = request.headers.get("range")

      if (range) {
        return rangedResponse(response, range)
      }

      return response
    }

    throw new Error("Media is not cached")
  }
}

async function rangedResponse(response, range) {
  const match = /bytes=(\d+)-(\d*)/.exec(range)

  if (!match) {
    return response
  }

  const blob = await response.blob()
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : blob.size - 1
  const sliced = blob.slice(start, end + 1)
  const headers = new Headers(response.headers)

  headers.set("content-length", String(sliced.size))
  headers.set("content-range", `bytes ${start}-${end}/${blob.size}`)
  headers.set("accept-ranges", "bytes")

  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers,
  })
}

async function cacheFirst(request) {
  const cached = await caches.match(request)

  if (cached) {
    return cached
  }

  const response = await fetch(request)
  const cache = await caches.open(APP_CACHE)
  cache.put(request, response.clone())

  return response
}

function isMediaRequest(url) {
  return (
    url.pathname.startsWith("/api/items/") &&
    (url.pathname.endsWith("/open") || url.pathname.endsWith("/folder/open"))
  )
}

function isAppAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/landrop.svg" ||
    url.pathname === "/favicon.svg"
  )
}
