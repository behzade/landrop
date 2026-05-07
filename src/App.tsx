import { type FormEvent, useEffect, useState } from "react"
import { toDataURL } from "qrcode"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

type Item = {
  id: string
  kind: "paste" | "file"
  name: string
  mime_type: string | null
  size: number
  path: string
  created_at: number
}

type TrustedDevice = {
  id: string
  name: string
  created_at: number
  revoked_at: number | null
}

type DevicesResponse = {
  currentDeviceId: string | null
  devices: TrustedDevice[]
}

type AuthStatus = {
  trusted: boolean
  currentDevice: TrustedDevice | null
}

type Preview =
  | { status: "idle" }
  | { status: "loading"; item: Item }
  | { status: "ready"; item: Item; url?: string; text?: string }
  | { status: "error"; item: Item; message: string }

type PreviewPayload = { url?: string; text?: string }

const numberFormat = new Intl.NumberFormat()
const defaultDeviceName = guessDeviceName()

export function App() {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState("Loading recent drops...")
  const [trusted, setTrusted] = useState<boolean | null>(null)
  const [pairingCode, setPairingCode] = useState("")
  const [pairingDeviceName, setPairingDeviceName] = useState(defaultDeviceName)
  const [pairingStatus, setPairingStatus] = useState("")
  const [connectUrl, setConnectUrl] = useState("")
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [deviceSaving, setDeviceSaving] = useState(false)
  const [preview, setPreview] = useState<Preview>({ status: "idle" })
  const [copyStatus, setCopyStatus] = useState("Copy")
  const [pasteSubmitting, setPasteSubmitting] = useState(false)
  const [uploadSubmitting, setUploadSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const codeFromUrl = new URLSearchParams(window.location.search).get(
      "pairingCode",
    )

    if (codeFromUrl) {
      setPairingCode(codeFromUrl)
    }

    fetch("/api/connect")
      .then((response) => response.json() as Promise<{ url: string }>)
      .then(({ url }) => {
        if (!cancelled) {
          setConnectUrl(url)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConnectUrl(window.location.href)
        }
      })

    fetch("/api/auth/status")
      .then((response) => response.json() as Promise<AuthStatus>)
      .then(({ trusted: nextTrusted, currentDevice }) => {
        if (!cancelled) {
          setTrusted(nextTrusted)
          setCurrentDeviceId(currentDevice?.id ?? null)
          setDeviceName(currentDevice?.name ?? defaultDeviceName)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTrusted(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!trusted) {
      return
    }

    let cancelled = false

    const loadItems = () => {
      fetch("/api/items")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }

          return response.json() as Promise<Item[]>
        })
        .then((nextItems) => {
          if (!cancelled) {
            setItems(nextItems)
            setStatus(nextItems.length ? "Recent drops" : "No drops yet")
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            const message =
              error instanceof Error ? error.message : "Failed to load"

            setStatus(message)
            toast.error("Could not load inbox", {
              description: message,
            })
          }
        })
    }
    const loadDevices = () => {
      fetch("/api/devices")
        .then(throwIfNotOk)
        .then((response) => response.json() as Promise<DevicesResponse>)
        .then((nextDevices) => {
          if (!cancelled) {
            setDevices(nextDevices.devices)
            setCurrentDeviceId(nextDevices.currentDeviceId)

            const currentDevice = nextDevices.devices.find(
              (device) => device.id === nextDevices.currentDeviceId,
            )

            if (currentDevice) {
              setDeviceName(currentDevice.name)
            }
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            toast.error("Could not load trusted devices", {
              description:
                error instanceof Error
                  ? error.message
                  : "Device list request failed",
            })
          }
        })
    }

    loadItems()
    loadDevices()

    const events = new EventSource("/api/events")
    events.addEventListener("items-changed", loadItems)
    events.onerror = () => {
      if (!cancelled) {
        setStatus("Live updates disconnected; retrying...")
      }
    }

    return () => {
      cancelled = true
      events.close()
    }
  }, [trusted])

  useEffect(() => {
    let cancelled = false

    if (!connectUrl) {
      setQrDataUrl("")
      return
    }

    toDataURL(connectUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl("")
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectUrl])

  useEffect(() => {
    return () => {
      if (preview.status === "ready" && preview.url) {
        URL.revokeObjectURL(preview.url)
      }
    }
  }, [preview])

  const openPreview = (item: Item) => {
    setCopyStatus("Copy")
    setPreview((current) => {
      if (current.status === "ready" && current.url) {
        URL.revokeObjectURL(current.url)
      }

      return { status: "loading", item }
    })

    fetch(`/api/items/${item.id}/open`)
      .then<PreviewPayload>((response) => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }

        if (isTextPreview(item)) {
          return response.text().then((text) => ({ text }))
        }

        if (isImagePreview(item)) {
          return response.blob().then((blob) => ({
            url: URL.createObjectURL(blob),
          }))
        }

        return { text: "" }
      })
      .then((nextPreview) => {
        setPreview({ ...nextPreview, status: "ready", item })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to load"

        setPreview({
          status: "error",
          item,
          message,
        })
        toast.error("Could not open item", {
          description: message,
        })
      })
  }

  const copyPreviewText = () => {
    if (preview.status !== "ready" || typeof preview.text !== "string") {
      return
    }

    navigator.clipboard
      .writeText(preview.text)
      .then(() => {
        setCopyStatus("Copied")
        toast.success("Copied to clipboard")
        window.setTimeout(() => setCopyStatus("Copy"), 1200)
      })
      .catch(() => {
        setCopyStatus("Copy failed")
        toast.error("Clipboard copy failed")
        window.setTimeout(() => setCopyStatus("Copy"), 1200)
      })
  }

  const submitPaste = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (pasteSubmitting) {
      return
    }

    const form = event.currentTarget
    const formData = new FormData(form)
    const text = String(formData.get("text") ?? "")

    if (!text.trim()) {
      toast.warning("Paste is empty", {
        description: "Add text or JSON before sending.",
      })
      return
    }

    setPasteSubmitting(true)

    fetch("/api/paste", {
      method: "POST",
      body: formData,
    })
      .then(throwIfNotOk)
      .then(() => {
        form.reset()
        toast.success("Paste sent")
      })
      .catch((error: unknown) => {
        toast.error("Paste failed", {
          description:
            error instanceof Error ? error.message : "Could not send paste",
        })
      })
      .finally(() => {
        setPasteSubmitting(false)
      })
  }

  const submitUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (uploadSubmitting) {
      return
    }

    const form = event.currentTarget
    const formData = new FormData(form)
    const file = formData.get("file")

    if (!(file instanceof File) || file.size === 0) {
      toast.warning("No file selected", {
        description: "Choose a file before pressing upload.",
      })
      return
    }

    setUploadSubmitting(true)

    fetch("/api/upload", {
      method: "POST",
      body: formData,
    })
      .then(throwIfNotOk)
      .then(() => {
        form.reset()
        toast.success("File uploaded", {
          description: file.name,
        })
      })
      .catch((error: unknown) => {
        toast.error("Upload failed", {
          description:
            error instanceof Error ? error.message : "Could not upload file",
        })
      })
      .finally(() => {
        setUploadSubmitting(false)
      })
  }

  const submitPairing = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPairingStatus("Pairing...")

    fetch("/api/pair", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: pairingCode,
        name: pairingDeviceName,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Invalid pairing code")
        }

        return response.json() as Promise<AuthStatus>
      })
      .then(({ currentDevice }) => {
        setTrusted(true)
        setPairingCode("")
        setPairingStatus("")
        setCurrentDeviceId(currentDevice?.id ?? null)
        setDeviceName(currentDevice?.name ?? pairingDeviceName)
        toast.success("Device paired")
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Pairing failed"

        setPairingStatus(message)
        toast.error("Pairing failed", {
          description: message,
        })
      })
  }

  const submitDeviceName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (deviceSaving) {
      return
    }

    const name = deviceName.trim()

    if (!name) {
      toast.warning("Device name is required")
      return
    }

    setDeviceSaving(true)

    fetch("/api/devices/current", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name }),
    })
      .then(throwIfNotOk)
      .then((response) => response.json() as Promise<TrustedDevice>)
      .then((updatedDevice) => {
        setDevices((currentDevices) =>
          currentDevices.map((device) =>
            device.id === updatedDevice.id ? updatedDevice : device,
          ),
        )
        setDeviceName(updatedDevice.name)
        toast.success("Device name updated")
      })
      .catch((error: unknown) => {
        toast.error("Could not update device name", {
          description:
            error instanceof Error
              ? error.message
              : "Device rename request failed",
        })
      })
      .finally(() => {
        setDeviceSaving(false)
      })
  }

  if (trusted === null) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>LAN Drop</CardTitle>
            <CardDescription>Checking trusted device status...</CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  if (!trusted) {
    return (
      <main className="grid min-h-svh place-items-center bg-[radial-gradient(circle_at_0%_0%,oklch(0.879_0.169_91.605/.35),transparent_28rem),linear-gradient(135deg,var(--background),var(--muted))] p-4 text-foreground">
        <Card className="w-full max-w-md bg-card/90 shadow-2xl shadow-primary/10">
          <CardHeader>
            <Badge variant="outline" className="w-fit tracking-[0.24em]">
              Pair device
            </Badge>
            <CardTitle className="text-3xl tracking-[-0.06em]">
              Trust this browser
            </CardTitle>
            <CardDescription>
              Enter the pairing code printed in the desktop server console.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={submitPairing}>
              <Label htmlFor="pairing-code">Pairing code</Label>
              <Input
                autoComplete="one-time-code"
                id="pairing-code"
                inputMode="numeric"
                placeholder="00000-00000-00000"
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
              />
              <Label htmlFor="pairing-device-name">Device name</Label>
              <Input
                id="pairing-device-name"
                placeholder="Behzad's phone"
                value={pairingDeviceName}
                onChange={(event) =>
                  setPairingDeviceName(event.target.value)
                }
              />
              <Button className="h-10" type="submit">
                Pair device
              </Button>
              {pairingStatus ? (
                <p className="text-xs text-muted-foreground">{pairingStatus}</p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-svh overflow-hidden bg-[radial-gradient(circle_at_0%_0%,oklch(0.879_0.169_91.605/.35),transparent_28rem),radial-gradient(circle_at_100%_20%,oklch(0.52_0.105_223.128/.18),transparent_24rem),linear-gradient(135deg,var(--background),var(--muted))] px-4 py-5 text-foreground sm:px-8 sm:py-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="relative min-h-[calc(100svh-2.5rem)] justify-between bg-card/90 py-0 shadow-2xl shadow-primary/10 backdrop-blur">
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />

          <CardHeader className="relative px-5 pt-6 sm:px-8 sm:pt-8">
            <Badge variant="outline" className="w-fit tracking-[0.24em]">
              Local receiver
            </Badge>
            <CardTitle className="mt-4 max-w-xl text-5xl font-semibold tracking-[-0.08em] text-balance sm:text-7xl">
              LAN Drop
            </CardTitle>
            <CardDescription className="mt-2 max-w-xl text-sm leading-6 sm:text-base">
              Send JSON, notes, screenshots, and files from your phone to this
              desktop without a chat app or cloud hop.
            </CardDescription>
            <Dialog>
              <DialogTrigger
                render={
                  <Button className="mt-6 h-10 w-fit text-sm" type="button" />
                }
              >
                Connect phone
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Connect phone</DialogTitle>
                  <DialogDescription>
                    Scan this QR code from your phone on the same Wi-Fi.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                  <div className="mx-auto border bg-white p-4">
                    {qrDataUrl ? (
                      <img
                        alt={`QR code for ${connectUrl}`}
                        className="size-64"
                        src={qrDataUrl}
                      />
                    ) : (
                      <div className="grid size-64 place-items-center text-xs text-black">
                        Generating QR...
                      </div>
                    )}
                  </div>

                  <a
                    className="break-all border bg-muted px-3 py-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    href={connectUrl}
                  >
                    {connectUrl || "Loading LAN address..."}
                  </a>
                </div>

                <DialogFooter showCloseButton />
              </DialogContent>
            </Dialog>
          </CardHeader>

          <CardContent className="relative px-5 pb-6 sm:px-8 sm:pb-8">
            <form className="grid gap-3" onSubmit={submitPaste}>
              <Label
                className="uppercase tracking-[0.24em] text-muted-foreground"
                htmlFor="drop-text"
              >
                Paste text / JSON
              </Label>
              <Textarea
                id="drop-text"
                name="text"
                className="min-h-72 resize-y bg-background/80 p-4 font-mono text-sm leading-6"
                placeholder='{"from": "phone", "to": "desktop"}'
              />
              <Button
                className="h-11 w-full text-sm"
                type="submit"
                disabled={pasteSubmitting}
              >
                {pasteSubmitting ? "Sending..." : "Send paste"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <Card className="bg-card/90 shadow-xl shadow-primary/5">
            <CardHeader>
              <div>
                <Badge variant="secondary" className="tracking-[0.2em]">
                  File upload
                </Badge>
                <CardTitle className="mt-3 text-2xl font-semibold tracking-[-0.05em]">
                  Push a file
                </CardTitle>
                <CardDescription>
                  Stored under ~/Downloads/landrop/uploads.
                </CardDescription>
              </div>
              <CardAction>
                <Badge variant="outline">LAN only</Badge>
              </CardAction>
            </CardHeader>

            <CardContent>
              <form
                className="grid gap-3"
                onSubmit={submitUpload}
              >
                <Input
                  className="h-14 border-dashed bg-background/80"
                  type="file"
                  name="file"
                />
                <Button
                  className="h-11 w-full text-sm"
                  type="submit"
                  disabled={uploadSubmitting}
                >
                  {uploadSubmitting ? "Uploading..." : "Upload file"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-card/90 shadow-xl shadow-primary/5">
            <CardHeader className="gap-3">
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="secondary" className="tracking-[0.2em]">
                    Devices
                  </Badge>
                  <Badge variant="outline" className="shrink-0">
                    {devices.length} trusted
                  </Badge>
                </div>
                <CardTitle className="mt-3 text-2xl font-semibold tracking-[-0.05em]">
                  Trusted browsers
                </CardTitle>
                <CardDescription className="mt-1">
                  Names shown here are visible to other paired devices.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="grid gap-4">
              {currentDeviceId ? (
                <form className="grid gap-2" onSubmit={submitDeviceName}>
                  <Label
                    className="uppercase tracking-[0.2em] text-muted-foreground"
                    htmlFor="device-name"
                  >
                    This device
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      className="min-w-0 bg-background/80"
                      id="device-name"
                      value={deviceName}
                      onChange={(event) => setDeviceName(event.target.value)}
                    />
                    <Button
                      className="shrink-0"
                      type="submit"
                      disabled={deviceSaving}
                    >
                      {deviceSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              ) : devices.length === 0 ? (
                <p className="border bg-muted p-3 text-xs leading-5 text-muted-foreground">
                  Localhost is trusted automatically. Open the LAN URL and pair
                  this browser if you want a named device.
                </p>
              ) : null}

              {!currentDeviceId && devices.length > 0 ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Localhost is auto-trusted. Rename from the paired LAN browser.
                </p>
              ) : null}

              <div className="grid gap-2">
                {devices.map((device) => (
                  <article
                    className="grid grid-cols-[1fr_auto] items-center gap-3 border bg-background/70 p-3"
                    key={device.id}
                  >
                    <div className="min-w-0">
                      <div
                        className="truncate text-sm font-medium"
                        title={device.name}
                      >
                        {device.name}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        Paired {new Date(device.created_at).toLocaleString()}
                      </div>
                    </div>
                    {device.id === currentDeviceId ? (
                      <Badge variant="default">This device</Badge>
                    ) : (
                      <Badge variant="outline">Trusted</Badge>
                    )}
                  </article>
                ))}

                {devices.length === 0 ? (
                  <div className="border bg-muted p-3 text-xs text-muted-foreground">
                    No token-backed devices yet.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/90 shadow-xl shadow-primary/5">
            <CardHeader>
              <div>
                <Badge variant="secondary" className="tracking-[0.2em]">
                  Inbox
                </Badge>
                <CardTitle className="mt-3 text-2xl font-semibold tracking-[-0.05em]">
                  {status}
                </CardTitle>
              </div>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  render={<a href="/api/items">JSON</a>}
                />
              </CardAction>
            </CardHeader>

            <CardContent>
              <ScrollArea className="h-[24rem]">
                <div className="grid gap-2 pr-3">
                  {items.slice(0, 16).map((item, index) => (
                    <article
                      className="grid grid-cols-[auto_1fr] gap-3 border bg-background/70 p-3"
                      key={item.id}
                    >
                      <Badge
                        className="flex size-10 items-center justify-center px-0 uppercase"
                        variant={item.kind === "paste" ? "default" : "outline"}
                      >
                        {item.kind === "paste" ? "txt" : "file"}
                      </Badge>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {item.name}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{numberFormat.format(item.size)} bytes</span>
                              <span>
                                {new Date(item.created_at).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="xs"
                              type="button"
                              onClick={() => openPreview(item)}
                            >
                              Open
                            </Button>
                            <Button
                              variant="outline"
                              size="xs"
                              render={
                                <a href={`/api/items/${item.id}/download`}>
                                  Save
                                </a>
                              }
                            />
                          </div>
                        </div>
                        {index < Math.min(items.length, 16) - 1 ? (
                          <Separator className="mt-3" />
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog
        open={preview.status !== "idle"}
        onOpenChange={(open) => {
          if (!open) {
            setPreview((current) => {
              if (current.status === "ready" && current.url) {
                URL.revokeObjectURL(current.url)
              }

              return { status: "idle" }
            })
          }
        }}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {preview.status === "idle" ? "Preview" : preview.item.name}
            </DialogTitle>
            <DialogDescription>
              {preview.status === "idle"
                ? null
                : `${numberFormat.format(preview.item.size)} bytes`}
            </DialogDescription>
          </DialogHeader>

          <PreviewBody preview={preview} />

          {preview.status !== "idle" ? (
            <DialogFooter showCloseButton>
              {preview.status === "ready" &&
              typeof preview.text === "string" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={copyPreviewText}
                >
                  {copyStatus}
                </Button>
              ) : null}
              <Button
                variant="outline"
                render={
                  <a href={`/api/items/${preview.item.id}/download`}>Save</a>
                }
              />
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}

function PreviewBody({ preview }: { preview: Preview }) {
  if (preview.status === "idle") {
    return null
  }

  if (preview.status === "loading") {
    return (
      <div className="grid min-h-64 place-items-center border bg-muted text-xs text-muted-foreground">
        Loading preview...
      </div>
    )
  }

  if (preview.status === "error") {
    return (
      <div className="border bg-muted p-4 text-xs text-muted-foreground">
        {preview.message}
      </div>
    )
  }

  if (preview.url && isImagePreview(preview.item)) {
    return (
      <div className="max-h-[min(70svh,48rem)] max-w-full overflow-auto border bg-muted p-2">
        <img
          alt={preview.item.name}
          className="mx-auto max-h-[64svh] max-w-full object-contain"
          src={preview.url}
        />
      </div>
    )
  }

  if (typeof preview.text === "string" && isTextPreview(preview.item)) {
    return (
      <div className="max-h-[min(64svh,44rem)] max-w-full overflow-auto border bg-muted">
        <pre className="min-w-max p-4 font-mono text-xs leading-5">
          {preview.text}
        </pre>
      </div>
    )
  }

  return (
    <div className="border bg-muted p-4 text-xs text-muted-foreground">
      No inline preview for this file type. Use Save to download it.
    </div>
  )
}

function isImagePreview(item: Item) {
  return item.mime_type?.startsWith("image/") ?? false
}

function isTextPreview(item: Item) {
  return (
    item.kind === "paste" ||
    item.mime_type?.startsWith("text/") ||
    item.mime_type === "application/json" ||
    item.name.endsWith(".json") ||
    item.name.endsWith(".txt") ||
    item.name.endsWith(".md")
  )
}

function throwIfNotOk(response: Response) {
  if (response.ok) {
    return response
  }

  return response.text().then((message) => {
    throw new Error(message || `Request failed with ${response.status}`)
  })
}

function guessDeviceName() {
  const platform = navigator.platform || "Browser"
  const touch = navigator.maxTouchPoints > 1 ? "phone" : "browser"

  return `${platform} ${touch}`
}

export default App
