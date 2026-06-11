import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useEffect,
  useMemo,
  useState,
} from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  ClipboardIcon,
  ClipboardCopyIcon,
  ComputerPhoneSyncIcon,
  Delete02Icon,
  Download04Icon,
  File02Icon,
  FileUploadIcon,
  Folder01Icon,
  FolderOpenIcon,
  FolderUploadIcon,
  GoBackward10SecIcon,
  GoForward10SecIcon,
  Image01Icon,
  InboxIcon,
  Key01Icon,
  Loading03Icon,
  MusicNote01Icon,
  PauseIcon,
  PlayIcon,
  QrCodeScanIcon,
  Search01Icon,
  SentIcon,
  Shield01Icon,
  Sorting01Icon,
  TextIcon,
  Upload04Icon,
  UserAccountIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { toDataURL } from "qrcode"
import { toast } from "sonner"
import WaveSurfer from "wavesurfer.js"

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
import { Textarea } from "@/components/ui/textarea"
import landropLogoUrl from "@/assets/landrop.svg"
import { cn } from "@/lib/utils"

type Item = {
  id: string
  kind: "paste" | "file" | "folder"
  name: string
  mime_type: string | null
  size: number
  path: string
  created_at: number
}

type FolderEntry = {
  name: string
  path: string
  kind: "file" | "folder"
  mime_type: string | null
  size: number
  modified_at: number | null
}

type FolderResponse = {
  path: string
  entries: FolderEntry[]
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
type InboxFilter = "all" | "text" | "files" | "images" | "audio"
type SortKey = "newest" | "oldest" | "name" | "size"
type UploadTab = "text" | "file" | "folder" | "clipboard"

const numberFormat = new Intl.NumberFormat()
const defaultDeviceName = guessDeviceName()
const initialUrlPairingCode = getPairingCodeFromUrl()
const pairingCodePattern = /^\d{5}-\d{5}-\d{5}$/
const inboxFilters: Array<{
  icon: IconSvgElement
  key: InboxFilter
  label: string
}> = [
  { key: "all", label: "All", icon: InboxIcon },
  { key: "text", label: "Text", icon: TextIcon },
  { key: "files", label: "Files", icon: File02Icon },
  { key: "images", label: "Images", icon: Image01Icon },
  { key: "audio", label: "Audio", icon: MusicNote01Icon },
]

const sortLabels: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name",
  size: "Largest",
}

export function App() {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState("Loading recent drops...")
  const [trusted, setTrusted] = useState<boolean | null>(null)
  const [pairingCode, setPairingCode] = useState(initialUrlPairingCode)
  const [pairingCodeSource, setPairingCodeSource] = useState<"manual" | "url">(
    initialUrlPairingCode ? "url" : "manual"
  )
  const [pairingCodeValidating, setPairingCodeValidating] = useState(
    Boolean(initialUrlPairingCode)
  )
  const [pairingCodeValidated, setPairingCodeValidated] = useState(false)
  const [pairingDeviceName, setPairingDeviceName] = useState(defaultDeviceName)
  const [pairingStatus, setPairingStatus] = useState("")
  const [connectUrl, setConnectUrl] = useState("")
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [deviceSaving, setDeviceSaving] = useState(false)
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null)
  const [removingItemId, setRemovingItemId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview>({ status: "idle" })
  const [copyStatus, setCopyStatus] = useState("Copy")
  const [pasteSubmitting, setPasteSubmitting] = useState(false)
  const [uploadSubmitting, setUploadSubmitting] = useState(false)
  const [folderSubmitting, setFolderSubmitting] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [uploadTab, setUploadTab] = useState<UploadTab>("text")
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all")
  const [sortKey, setSortKey] = useState<SortKey>("newest")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dropActive, setDropActive] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (initialUrlPairingCode) {
      fetch(
        `/api/pairing-code?code=${encodeURIComponent(initialUrlPairingCode)}`
      )
        .then(throwIfNotOk)
        .then((response) => response.json() as Promise<{ valid: boolean }>)
        .then(({ valid }) => {
          if (!cancelled) {
            setPairingCodeValidated(valid)
            setPairingStatus(
              valid
                ? "Pairing code accepted. Name this device to finish."
                : "The pairing link is invalid or expired."
            )
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPairingCodeValidated(false)
            setPairingStatus("Could not validate the pairing link.")
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPairingCodeValidating(false)
          }
        })
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
      fetch("/api/items", { cache: "no-store" })
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
              (device) => device.id === nextDevices.currentDeviceId
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

  const itemCounts = useMemo(
    () => ({
      all: items.length,
      text: items.filter(isTextPreview).length,
      files: items.filter((item) => item.kind === "file").length,
      images: items.filter(isImagePreview).length,
      audio: items.filter(isAudioPreview).length,
    }),
    [items]
  )

  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (inboxFilter === "text") {
        return isTextPreview(item)
      }

      if (inboxFilter === "files") {
        return item.kind === "file"
      }

      if (inboxFilter === "images") {
        return isImagePreview(item)
      }

      if (inboxFilter === "audio") {
        return isAudioPreview(item)
      }

      return true
    })

    return [...filtered].sort((left, right) => {
      if (sortKey === "oldest") {
        return left.created_at - right.created_at
      }

      if (sortKey === "name") {
        return left.name.localeCompare(right.name)
      }

      if (sortKey === "size") {
        return right.size - left.size
      }

      return right.created_at - left.created_at
    })
  }, [inboxFilter, items, sortKey])

  const openPreview = (item: Item) => {
    setCopyStatus("Copy")
    setPreview((current) => {
      if (current.status === "ready" && current.url) {
        URL.revokeObjectURL(current.url)
      }

      return { status: "loading", item }
    })

    if (isFolderItem(item)) {
      setPreview({ status: "ready", item })
      return
    }

    if (isAudioPreview(item)) {
      setPreview({
        status: "ready",
        item,
        url: `/api/items/${item.id}/open`,
      })
      return
    }

    fetch(`/api/items/${item.id}/open`, { cache: "no-store" })
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
        const message =
          error instanceof Error ? error.message : "Failed to load"

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

  const removeItem = (item: Item) => {
    if (removingItemId) {
      return
    }

    setRemovingItemId(item.id)

    fetch(`/api/items/${item.id}`, {
      method: "DELETE",
    })
      .then(throwIfNotOk)
      .then(() => {
        setItems((current) =>
          current.filter((currentItem) => currentItem.id !== item.id)
        )
        setPreview((current) => {
          if (current.status !== "idle" && current.item.id === item.id) {
            if (current.status === "ready" && current.url) {
              URL.revokeObjectURL(current.url)
            }

            return { status: "idle" }
          }

          return current
        })
        toast.success("Item unshared", {
          description: item.name,
        })
      })
      .catch((error: unknown) => {
        toast.error("Could not unshare item", {
          description:
            error instanceof Error ? error.message : "Remove request failed",
        })
      })
      .finally(() => {
        setRemovingItemId(null)
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
        setSendOpen(false)
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
    const file = selectedFile ?? formData.get("file")

    if (!(file instanceof File) || file.size === 0) {
      toast.warning("No file selected", {
        description: "Choose a file before pressing upload.",
      })
      return
    }

    uploadFile(file).then((uploaded) => {
      if (uploaded) {
        form.reset()
        setSelectedFile(null)
      }
    })
  }

  const uploadFile = (file: File) => {
    setUploadSubmitting(true)

    const formData = new FormData()
    formData.set("file", file)

    return fetch("/api/upload", {
      method: "POST",
      body: formData,
    })
      .then(throwIfNotOk)
      .then(() => {
        toast.success("File uploaded", {
          description: file.name,
        })
        setSendOpen(false)
        return true
      })
      .catch((error: unknown) => {
        toast.error("Upload failed", {
          description:
            error instanceof Error ? error.message : "Could not upload file",
        })
        return false
      })
      .finally(() => {
        setUploadSubmitting(false)
      })
  }

  const submitFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (folderSubmitting) {
      return
    }

    const form = event.currentTarget
    const formData = new FormData(form)
    const path = String(formData.get("path") ?? "").trim()

    if (!path) {
      toast.warning("Folder path is empty", {
        description: "Enter a folder path from the LAN Drop server device.",
      })
      return
    }

    setFolderSubmitting(true)

    fetch("/api/folders", {
      method: "POST",
      body: formData,
    })
      .then(throwIfNotOk)
      .then(() => {
        form.reset()
        setSendOpen(false)
        toast.success("Folder served", {
          description: path,
        })
      })
      .catch((error: unknown) => {
        toast.error("Folder failed", {
          description:
            error instanceof Error ? error.message : "Could not serve folder",
        })
      })
      .finally(() => {
        setFolderSubmitting(false)
      })
  }

  const selectUploadFile = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null)
  }

  const dropUploadFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDropActive(false)

    const file = event.dataTransfer.files[0]

    if (file) {
      setSelectedFile(file)
    }
  }

  const uploadClipboardImage = async () => {
    if (uploadSubmitting) {
      return
    }

    if (!navigator.clipboard?.read) {
      toast.error("Clipboard images are not available in this browser")
      return
    }

    try {
      const entries = await navigator.clipboard.read()

      for (const entry of entries) {
        const imageType = entry.types.find((type) => type.startsWith("image/"))

        if (!imageType) {
          continue
        }

        const blob = await entry.getType(imageType)
        const extension = imageType.split("/")[1] || "png"
        const file = new File([blob], `clipboard-image.${extension}`, {
          type: imageType,
        })

        await uploadFile(file)
        return
      }

      toast.warning("No image found on clipboard")
    } catch (error) {
      toast.error("Could not read clipboard image", {
        description:
          error instanceof Error ? error.message : "Clipboard access failed",
      })
    }
  }

  const submitPairing = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!pairingCodePattern.test(pairingCode.trim())) {
      setPairingStatus("Enter a code in the 00000-00000-00000 format.")
      return
    }

    if (!pairingDeviceName.trim()) {
      setPairingStatus("Device name is required.")
      return
    }

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
        setPairingCodeSource("manual")
        setPairingCodeValidated(false)
        setPairingStatus("")
        setCurrentDeviceId(currentDevice?.id ?? null)
        setDeviceName(currentDevice?.name ?? pairingDeviceName)
        toast.success("Device paired")
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Pairing failed"

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
            device.id === updatedDevice.id ? updatedDevice : device
          )
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

  const revokeDevice = (device: TrustedDevice) => {
    if (revokingDeviceId) {
      return
    }

    setRevokingDeviceId(device.id)

    fetch(`/api/devices/${device.id}`, {
      method: "DELETE",
    })
      .then(throwIfNotOk)
      .then(() => {
        setDevices((currentDevices) =>
          currentDevices.filter(
            (currentDevice) => currentDevice.id !== device.id
          )
        )

        if (device.id === currentDeviceId) {
          setCurrentDeviceId(null)
          setTrusted(false)
        }

        toast.success("Device revoked", {
          description: device.name,
        })
      })
      .catch((error: unknown) => {
        toast.error("Could not revoke device", {
          description:
            error instanceof Error
              ? error.message
              : "Device revoke request failed",
        })
      })
      .finally(() => {
        setRevokingDeviceId(null)
      })
  }

  if (trusted === null) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
        <Card className="w-full max-w-sm border-border/80 bg-card shadow-lg">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center border bg-muted">
              <AppIcon
                icon={Loading03Icon}
                className="animate-spin text-primary"
              />
            </div>
            <CardTitle>LAN Drop</CardTitle>
            <CardDescription>Checking trusted device status...</CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  if (!trusted) {
    const pairingLinkReady =
      pairingCodeSource === "url" &&
      pairingCodeValidated &&
      !pairingCodeValidating

    return (
      <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
        <Card className="w-full max-w-md border-border/80 bg-card shadow-xl">
          <CardHeader>
            <Badge
              variant={pairingLinkReady ? "default" : "outline"}
              className="w-fit"
            >
              <AppIcon
                icon={pairingLinkReady ? CheckmarkCircle02Icon : Key01Icon}
              />
              Pair device
            </Badge>
            <CardTitle className="text-3xl">
              {pairingLinkReady ? "Name this device" : "Trust this browser"}
            </CardTitle>
            <CardDescription>
              {pairingLinkReady
                ? "The pairing link is valid. Choose a recognizable name for this browser."
                : "Enter the pairing code printed in the desktop server console."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={submitPairing}>
              {pairingLinkReady ? null : (
                <>
                  <Label htmlFor="pairing-code">Pairing code</Label>
                  <div className="relative">
                    <AppIcon
                      icon={pairingCodeValidating ? Loading03Icon : Key01Icon}
                      className={cn(
                        "absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground",
                        pairingCodeValidating && "animate-spin"
                      )}
                    />
                    <Input
                      autoComplete="one-time-code"
                      className="pl-9"
                      disabled={pairingCodeValidating}
                      id="pairing-code"
                      inputMode="numeric"
                      placeholder="00000-00000-00000"
                      value={pairingCode}
                      onChange={(event) => {
                        setPairingCode(event.target.value)
                        setPairingCodeSource("manual")
                        setPairingCodeValidated(false)
                      }}
                    />
                  </div>
                </>
              )}
              <Label htmlFor="pairing-device-name">Device name</Label>
              <div className="relative">
                <AppIcon
                  icon={UserAccountIcon}
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  autoFocus={pairingLinkReady}
                  className="pl-9"
                  id="pairing-device-name"
                  placeholder="Behzad's phone"
                  value={pairingDeviceName}
                  onChange={(event) => setPairingDeviceName(event.target.value)}
                />
              </div>
              <Button
                className="h-10"
                type="submit"
                disabled={pairingCodeValidating}
              >
                <AppIcon icon={Shield01Icon} />
                {pairingLinkReady ? "Finish pairing" : "Pair device"}
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
    <main className="min-h-svh bg-background px-3 py-3 text-foreground sm:px-5">
      <div className="mx-auto mb-3 flex max-w-7xl items-center justify-between gap-3 border-b pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <img alt="" className="size-8 shrink-0" src={landropLogoUrl} />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">LAN Drop</h1>
            <p className="truncate text-xs text-muted-foreground">
              {numberFormat.format(visibleItems.length)} shown of{" "}
              {numberFormat.format(items.length)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Dialog open={sendOpen} onOpenChange={setSendOpen}>
            <DialogTrigger
              render={
                <Button
                  className="h-9 px-3 text-xs"
                  type="button"
                  variant="default"
                />
              }
            >
              <AppIcon icon={Add01Icon} />
              New drop
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-hidden sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add to inbox</DialogTitle>
                <DialogDescription>
                  Send text, upload a file, or pull an image from the clipboard.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 overflow-hidden">
                <div className="grid grid-cols-4 border">
                  {[
                    { key: "text", label: "Text", icon: TextIcon },
                    { key: "file", label: "File", icon: FolderUploadIcon },
                    { key: "folder", label: "Folder", icon: FolderOpenIcon },
                    {
                      key: "clipboard",
                      label: "Clipboard",
                      icon: ClipboardIcon,
                    },
                  ].map((tab) => (
                    <button
                      className={cn(
                        "flex h-10 items-center justify-center gap-2 border-r text-xs last:border-r-0 hover:bg-muted",
                        uploadTab === tab.key && "bg-muted text-foreground"
                      )}
                      key={tab.key}
                      type="button"
                      onClick={() => setUploadTab(tab.key as UploadTab)}
                    >
                      <AppIcon icon={tab.icon} />
                      {tab.label}
                    </button>
                  ))}
                </div>

                {uploadTab === "text" ? (
                  <form className="grid gap-3" onSubmit={submitPaste}>
                    <Label
                      className="flex items-center gap-2 text-muted-foreground uppercase"
                      htmlFor="drop-text"
                    >
                      <AppIcon icon={TextIcon} />
                      Paste text / JSON
                    </Label>
                    <Textarea
                      id="drop-text"
                      name="text"
                      className="max-h-80 min-h-64 resize-y overflow-hidden bg-background/80 p-4 font-mono text-sm leading-6"
                      placeholder='{"from": "phone", "to": "desktop"}'
                    />
                    <Button
                      className="h-11 w-full text-sm"
                      type="submit"
                      disabled={pasteSubmitting}
                    >
                      <AppIcon icon={SentIcon} />
                      {pasteSubmitting ? "Sending..." : "Send paste"}
                    </Button>
                  </form>
                ) : null}

                {uploadTab === "file" ? (
                  <form className="grid gap-3" onSubmit={submitUpload}>
                    <div
                      className={cn(
                        "grid min-h-44 place-items-center border border-dashed bg-muted/40 p-6 text-center transition-colors",
                        dropActive && "border-primary bg-primary/10"
                      )}
                      onDragLeave={() => setDropActive(false)}
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDropActive(true)
                      }}
                      onDrop={dropUploadFile}
                    >
                      <div className="grid gap-3">
                        <div className="mx-auto flex size-12 items-center justify-center border bg-background">
                          <AppIcon
                            icon={Upload04Icon}
                            className="size-5 text-primary"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {selectedFile
                              ? selectedFile.name
                              : "Drop a file here"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedFile
                              ? `${numberFormat.format(selectedFile.size)} bytes`
                              : "or choose a file from this device"}
                          </p>
                        </div>
                        <Input
                          className="h-10 bg-background"
                          type="file"
                          name="file"
                          onChange={selectUploadFile}
                        />
                      </div>
                    </div>
                    <Button
                      className="h-11 w-full text-sm"
                      type="submit"
                      disabled={uploadSubmitting}
                    >
                      <AppIcon icon={FileUploadIcon} />
                      {uploadSubmitting ? "Uploading..." : "Upload file"}
                    </Button>
                  </form>
                ) : null}

                {uploadTab === "folder" ? (
                  <form className="grid gap-3" onSubmit={submitFolder}>
                    <div className="grid min-h-44 place-items-center border border-dashed bg-muted/40 p-6 text-center">
                      <div className="grid w-full max-w-lg gap-3">
                        <div className="mx-auto flex size-12 items-center justify-center border bg-background">
                          <AppIcon
                            icon={FolderOpenIcon}
                            className="size-5 text-primary"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            Serve a folder in place
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Use a path on the device running LAN Drop.
                          </p>
                        </div>
                        <Input
                          className="h-10 bg-background font-mono text-xs"
                          name="path"
                          placeholder="~/Music"
                        />
                      </div>
                    </div>
                    <Button
                      className="h-11 w-full text-sm"
                      type="submit"
                      disabled={folderSubmitting}
                    >
                      <AppIcon icon={FolderOpenIcon} />
                      {folderSubmitting ? "Serving..." : "Serve folder"}
                    </Button>
                  </form>
                ) : null}

                {uploadTab === "clipboard" ? (
                  <div className="grid gap-3">
                    <div className="grid min-h-56 place-items-center border bg-muted/40 p-6 text-center">
                      <div className="grid gap-3">
                        <div className="mx-auto flex size-12 items-center justify-center border bg-background">
                          <AppIcon
                            icon={Image01Icon}
                            className="size-5 text-primary"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            Upload clipboard image
                          </p>
                          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                            Copy an image or screenshot, then let LAN Drop read
                            it from the browser clipboard.
                          </p>
                        </div>
                      </div>
                    </div>
                    <Button
                      className="h-11 w-full text-sm"
                      type="button"
                      disabled={uploadSubmitting}
                      onClick={uploadClipboardImage}
                    >
                      <AppIcon icon={ClipboardCopyIcon} />
                      {uploadSubmitting
                        ? "Uploading..."
                        : "Upload image from clipboard"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger
              render={
                <Button
                  className="h-9 px-3 text-xs"
                  type="button"
                  variant="outline"
                />
              }
            >
              <AppIcon icon={ComputerPhoneSyncIcon} />
              Devices
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-hidden sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Trusted browsers</DialogTitle>
                <DialogDescription>
                  Rename this browser or revoke paired devices.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 overflow-hidden">
                {currentDeviceId ? (
                  <form className="grid gap-2" onSubmit={submitDeviceName}>
                    <Label
                      className="tracking-[0.2em] text-muted-foreground uppercase"
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
                    Localhost is trusted automatically. Open the LAN URL and
                    pair this browser if you want a named device.
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Localhost is auto-trusted. Rename from the paired LAN
                    browser.
                  </p>
                )}

                <ScrollArea className="max-h-[50svh]">
                  <div className="grid gap-2 pr-3">
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
                            Paired{" "}
                            {new Date(device.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {device.id === currentDeviceId ? (
                            <Badge variant="default">
                              <AppIcon icon={CheckmarkCircle02Icon} />
                              This
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              <AppIcon icon={Shield01Icon} />
                              Trusted
                            </Badge>
                          )}
                          <Button
                            size="xs"
                            type="button"
                            variant="destructive"
                            disabled={revokingDeviceId === device.id}
                            onClick={() => revokeDevice(device)}
                          >
                            {revokingDeviceId === device.id ? "..." : "Revoke"}
                          </Button>
                        </div>
                      </article>
                    ))}

                    {devices.length === 0 ? (
                      <div className="border bg-muted p-3 text-xs text-muted-foreground">
                        No token-backed devices yet.
                      </div>
                    ) : null}
                  </div>
                </ScrollArea>
              </div>

              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger
              render={
                <Button
                  aria-label="Connect phone"
                  className="h-9 px-3 text-xs"
                  type="button"
                  variant="default"
                />
              }
            >
              <AppIcon icon={QrCodeScanIcon} />
              Connect
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
                  className="border bg-muted px-3 py-2 text-xs break-all text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  href={connectUrl}
                >
                  {connectUrl || "Loading LAN address..."}
                </a>
              </div>

              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="mx-auto max-w-7xl border-border/80 bg-card shadow-sm">
        <CardHeader className="gap-3 p-3 sm:p-4">
          <div className="min-w-0">
            <CardTitle className="truncate text-xl font-semibold">
              {status}
            </CardTitle>
          </div>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              render={
                <a href="/api/items">
                  <AppIcon icon={File02Icon} />
                  JSON
                </a>
              }
            />
          </CardAction>
        </CardHeader>

        <CardContent className="grid gap-3 p-3 pt-0 sm:p-4 sm:pt-0">
          <div className="flex flex-col gap-2 border bg-muted/30 p-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {inboxFilters.map((filter) => (
                <Button
                  key={filter.key}
                  size="sm"
                  type="button"
                  variant={inboxFilter === filter.key ? "default" : "outline"}
                  className="h-7"
                  onClick={() => setInboxFilter(filter.key)}
                >
                  <AppIcon icon={filter.icon} />
                  {filter.label}
                  <span className="text-muted-foreground">
                    {numberFormat.format(itemCounts[filter.key])}
                  </span>
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <AppIcon icon={Sorting01Icon} />
              Sort
              <select
                className="h-8 border bg-background px-2 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
                {Object.entries(sortLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ScrollArea className="h-[calc(100svh-11.5rem)] min-h-[34rem]">
            <div className="grid gap-1.5 pr-3">
              {visibleItems.map((item) => (
                <article
                  className="grid grid-cols-[auto_1fr] gap-3 border bg-background/70 p-2.5 lg:grid-cols-[auto_1fr_auto] lg:items-center"
                  key={item.id}
                >
                  <div className="flex size-9 items-center justify-center border bg-muted">
                    <AppIcon icon={iconForItem(item)} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">
                        {item.name}
                      </h2>
                      <Badge
                        variant={item.kind === "paste" ? "default" : "outline"}
                      >
                        {labelForItem(item)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {isFolderItem(item)
                          ? "Served folder"
                          : `${numberFormat.format(item.size)} bytes`}
                      </span>
                      <span>{item.mime_type ?? "text/plain"}</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="col-span-2 flex gap-1.5 lg:col-span-1 lg:justify-end">
                    <Button
                      variant="ghost"
                      size="xs"
                      type="button"
                      onClick={() => openPreview(item)}
                    >
                      <AppIcon icon={Search01Icon} />
                      Open
                    </Button>
                    {!isFolderItem(item) ? (
                      <Button
                        variant="outline"
                        size="xs"
                        render={
                          <a href={`/api/items/${item.id}/download`}>
                            <AppIcon icon={Download04Icon} />
                            Save
                          </a>
                        }
                      />
                    ) : null}
                    <Button
                      variant="outline"
                      size="xs"
                      type="button"
                      disabled={removingItemId === item.id}
                      onClick={() => removeItem(item)}
                    >
                      <AppIcon
                        icon={
                          removingItemId === item.id
                            ? Loading03Icon
                            : Delete02Icon
                        }
                        className={
                          removingItemId === item.id ? "animate-spin" : ""
                        }
                      />
                      Unshare
                    </Button>
                  </div>
                </article>
              ))}

              {visibleItems.length === 0 ? (
                <div className="grid min-h-64 place-items-center border bg-muted/40 text-center">
                  <div>
                    <AppIcon
                      icon={InboxIcon}
                      className="mx-auto mb-3 size-8 text-muted-foreground"
                    />
                    <p className="text-sm font-medium">No matching drops</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Change the category filter or add a new drop.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
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
                : isFolderItem(preview.item)
                  ? "Served folder"
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
                  <AppIcon icon={ClipboardCopyIcon} />
                  {copyStatus}
                </Button>
              ) : null}
              {!isFolderItem(preview.item) ? (
                <Button
                  variant="outline"
                  render={
                    <a href={`/api/items/${preview.item.id}/download`}>
                      <AppIcon icon={Download04Icon} />
                      Save
                    </a>
                  }
                />
              ) : null}
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
        <div className="flex items-center gap-2">
          <AppIcon icon={Loading03Icon} className="animate-spin" />
          Loading preview...
        </div>
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

  if (isFolderItem(preview.item)) {
    return <FolderPreview item={preview.item} />
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

  if (preview.url && isAudioPreview(preview.item)) {
    return <AudioPlayer name={preview.item.name} src={preview.url} />
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

function FolderPreview({ item }: { item: Item }) {
  const [folderPath, setFolderPath] = useState("")
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [message, setMessage] = useState("")
  const [selected, setSelected] = useState<FolderEntry | null>(null)
  const [textPreview, setTextPreview] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(folderListUrl(item.id, item.created_at, folderPath), {
      cache: "no-store",
    })
      .then(throwIfNotOk)
      .then((response) => response.json() as Promise<FolderResponse>)
      .then((payload) => {
        if (!cancelled) {
          setEntries(payload.entries)
          setStatus("ready")
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus("error")
          setMessage(
            error instanceof Error ? error.message : "Could not load folder"
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [folderPath, item.created_at, item.id])

  const changeFolder = (path: string) => {
    setStatus("loading")
    setSelected(null)
    setTextPreview(null)
    setFolderPath(path)
  }

  const openEntry = (entry: FolderEntry) => {
    if (entry.kind === "folder") {
      changeFolder(entry.path)
      return
    }

    setSelected(entry)
    setTextPreview(null)

    if (isTextLike(entry)) {
      fetch(folderFileUrl(item.id, item.created_at, entry.path, "open"), {
        cache: "no-store",
      })
        .then(throwIfNotOk)
        .then((response) => response.text())
        .then(setTextPreview)
        .catch((error: unknown) => {
          toast.error("Could not preview file", {
            description:
              error instanceof Error ? error.message : "Preview failed",
          })
        })
    }
  }

  const parentPath = folderPath.split("/").slice(0, -1).join("/")

  if (status === "loading") {
    return (
      <div className="grid min-h-64 place-items-center border bg-muted text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <AppIcon icon={Loading03Icon} className="animate-spin" />
          Loading folder...
        </div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="border bg-muted p-4 text-xs text-muted-foreground">
        {message}
      </div>
    )
  }

  return (
    <div className="grid max-h-[min(70svh,48rem)] grid-rows-[auto_1fr] overflow-hidden border bg-background">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <AppIcon icon={Folder01Icon} />
          <span className="truncate font-mono">{folderPath || "/"}</span>
        </div>
        {folderPath ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => changeFolder(parentPath)}
          >
            Up
          </Button>
        ) : null}
      </div>
      <div className="grid min-h-0 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <div className="min-h-56 overflow-auto border-r">
          {entries.map((entry) => (
            <button
              className={cn(
                "grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted",
                selected?.path === entry.path && "bg-muted"
              )}
              key={entry.path}
              type="button"
              onClick={() => openEntry(entry)}
            >
              <AppIcon
                icon={
                  entry.kind === "folder" ? Folder01Icon : iconForFile(entry)
                }
              />
              <span className="min-w-0 truncate">{entry.name}</span>
              <span className="text-xs text-muted-foreground">
                {entry.kind === "folder"
                  ? "Folder"
                  : numberFormat.format(entry.size)}
              </span>
            </button>
          ))}
          {entries.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              This folder is empty.
            </div>
          ) : null}
        </div>
        <FolderFilePreview
          entry={selected}
          item={item}
          textPreview={textPreview}
        />
      </div>
    </div>
  )
}

function FolderFilePreview({
  entry,
  item,
  textPreview,
}: {
  entry: FolderEntry | null
  item: Item
  textPreview: string | null
}) {
  if (!entry) {
    return (
      <div className="grid min-h-64 place-items-center bg-muted/30 p-4 text-xs text-muted-foreground">
        Select a file to preview or download.
      </div>
    )
  }

  const openUrl = folderFileUrl(item.id, item.created_at, entry.path, "open")
  const downloadUrl = folderFileUrl(
    item.id,
    item.created_at,
    entry.path,
    "download"
  )

  return (
    <div className="min-h-0 overflow-auto bg-muted/30 p-3">
      <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="text-xs text-muted-foreground">
            {entry.mime_type ?? "application/octet-stream"}
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          render={
            <a href={downloadUrl}>
              <AppIcon icon={Download04Icon} />
              Save
            </a>
          }
        />
      </div>
      {isAudioLike(entry) ? (
        <AudioPlayer name={entry.name} src={openUrl} />
      ) : isImageLike(entry) ? (
        <div className="max-h-[52svh] overflow-auto border bg-muted p-2">
          <img
            alt={entry.name}
            className="mx-auto max-h-[48svh] max-w-full object-contain"
            src={openUrl}
          />
        </div>
      ) : isTextLike(entry) ? (
        <div className="max-h-[52svh] overflow-auto border bg-muted">
          <pre className="min-w-max p-4 font-mono text-xs leading-5">
            {textPreview ?? "Loading preview..."}
          </pre>
        </div>
      ) : (
        <div className="border bg-muted p-4 text-xs text-muted-foreground">
          No inline preview for this file type. Use Save to download it.
        </div>
      )}
    </div>
  )
}

function AudioPlayer({ name, src }: { name: string; src: string }) {
  const waveformRef = useRef<HTMLDivElement | null>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const volumeRef = useRef(1)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    const container = waveformRef.current

    if (!container) {
      return
    }

    const style = getComputedStyle(document.documentElement)
    const waveColor = style.getPropertyValue("--muted-foreground").trim()
    const progressColor = style.getPropertyValue("--primary").trim()
    const cursorColor = style.getPropertyValue("--foreground").trim()
    const wavesurfer = WaveSurfer.create({
      barGap: 2,
      barRadius: 2,
      barWidth: 2,
      cursorColor,
      cursorWidth: 2,
      dragToSeek: true,
      height: 56,
      normalize: true,
      progressColor,
      url: src,
      waveColor,
      container,
    })

    wavesurferRef.current = wavesurfer
    setCurrentTime(0)
    setDuration(0)
    setLoadingProgress(0)
    setPlaying(false)
    setReady(false)
    wavesurfer.setVolume(volumeRef.current)

    wavesurfer.on("loading", (progress) => setLoadingProgress(progress))
    wavesurfer.on("ready", (nextDuration) => {
      setDuration(nextDuration)
      setReady(true)
      setLoadingProgress(100)
    })
    wavesurfer.on("timeupdate", (nextTime) => setCurrentTime(nextTime))
    wavesurfer.on("seeking", (nextTime) => setCurrentTime(nextTime))
    wavesurfer.on("play", () => setPlaying(true))
    wavesurfer.on("pause", () => setPlaying(false))
    wavesurfer.on("finish", () => setPlaying(false))
    wavesurfer.on("error", () => {
      setPlaying(false)
      setReady(false)
      toast.error("Audio playback failed")
    })

    return () => {
      wavesurfer.destroy()
      if (wavesurferRef.current === wavesurfer) {
        wavesurferRef.current = null
      }
    }
  }, [src])

  const togglePlayback = () => {
    const wavesurfer = wavesurferRef.current

    if (!wavesurfer) {
      return
    }

    wavesurfer.playPause().catch(() => {
      toast.error("Audio playback failed")
    })
  }

  const skip = (seconds: number) => {
    const wavesurfer = wavesurferRef.current

    if (wavesurfer) {
      wavesurfer.skip(seconds)
    }
  }

  const changeVolume = (value: string) => {
    const nextVolume = Number(value)
    const wavesurfer = wavesurferRef.current

    volumeRef.current = nextVolume

    if (wavesurfer) {
      wavesurfer.setVolume(nextVolume)
    }

    setVolume(nextVolume)
  }

  return (
    <div className="border bg-muted p-4">
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <Button
            aria-label="Skip backward 10 seconds"
            type="button"
            variant="outline"
            size="icon"
            disabled={!ready}
            onClick={() => skip(-10)}
          >
            <AppIcon icon={GoBackward10SecIcon} />
          </Button>
          <Button
            aria-label={playing ? "Pause" : "Play"}
            type="button"
            variant="outline"
            size="icon"
            disabled={!ready}
            onClick={togglePlayback}
          >
            <AppIcon icon={playing ? PauseIcon : PlayIcon} />
          </Button>
          <Button
            aria-label="Skip forward 10 seconds"
            type="button"
            variant="outline"
            size="icon"
            disabled={!ready}
            onClick={() => skip(10)}
          >
            <AppIcon icon={GoForward10SecIcon} />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {ready
                ? `${formatDuration(currentTime)} / ${formatDuration(duration)}`
                : `Loading waveform ${Math.round(loadingProgress)}%`}
            </p>
          </div>
        </div>
        <div
          ref={waveformRef}
          aria-label="Audio waveform"
          className="min-h-14 cursor-pointer overflow-hidden border bg-background px-2 py-1"
        />
        <div className="flex items-center gap-2 text-muted-foreground">
          <AppIcon icon={VolumeHighIcon} />
          <input
            aria-label="Volume"
            className="h-2 w-28 accent-primary"
            max="1"
            min="0"
            step="0.01"
            type="range"
            value={volume}
            onChange={(event) => changeVolume(event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

function AppIcon({
  className,
  icon,
}: {
  className?: string
  icon: IconSvgElement
}) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={cn("size-4", className)}
      icon={icon}
      size={16}
      strokeWidth={1.8}
    />
  )
}

function isImagePreview(item: Item) {
  return item.mime_type?.startsWith("image/") ?? false
}

function isAudioPreview(item: Item) {
  return item.mime_type?.startsWith("audio/") ?? false
}

function isFolderItem(item: Item) {
  return item.kind === "folder"
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

function iconForItem(item: Item) {
  if (isFolderItem(item)) {
    return Folder01Icon
  }

  if (isImagePreview(item)) {
    return Image01Icon
  }

  if (isAudioPreview(item)) {
    return MusicNote01Icon
  }

  if (isTextPreview(item)) {
    return TextIcon
  }

  return File02Icon
}

function labelForItem(item: Item) {
  if (isFolderItem(item)) {
    return "Folder"
  }

  if (isImagePreview(item)) {
    return "Image"
  }

  if (isAudioPreview(item)) {
    return "Audio"
  }

  if (item.kind === "paste") {
    return "Text"
  }

  return "File"
}

function iconForFile(entry: FolderEntry) {
  if (isImageLike(entry)) {
    return Image01Icon
  }

  if (isAudioLike(entry)) {
    return MusicNote01Icon
  }

  if (isTextLike(entry)) {
    return TextIcon
  }

  return File02Icon
}

function isImageLike(entry: Pick<FolderEntry, "mime_type">) {
  return entry.mime_type?.startsWith("image/") ?? false
}

function isAudioLike(entry: Pick<FolderEntry, "mime_type">) {
  return entry.mime_type?.startsWith("audio/") ?? false
}

function isTextLike(entry: Pick<FolderEntry, "mime_type" | "name">) {
  return (
    entry.mime_type?.startsWith("text/") ||
    entry.mime_type === "application/json" ||
    entry.name.endsWith(".json") ||
    entry.name.endsWith(".txt") ||
    entry.name.endsWith(".md")
  )
}

function folderListUrl(itemId: string, itemCreatedAt: number, path: string) {
  const params = new URLSearchParams({
    path,
    revision: String(itemCreatedAt),
  })

  return `/api/items/${itemId}/folder?${params.toString()}`
}

function folderFileUrl(
  itemId: string,
  itemCreatedAt: number,
  path: string,
  action: "open" | "download"
) {
  const params = new URLSearchParams({
    path,
    revision: String(itemCreatedAt),
  })

  return `/api/items/${itemId}/folder/${action}?${params.toString()}`
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00"
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")

  return `${minutes}:${seconds}`
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

function getPairingCodeFromUrl() {
  return new URLSearchParams(window.location.search).get("pairingCode") ?? ""
}

export default App
