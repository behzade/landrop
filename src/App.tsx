import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
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
  GoBackward15SecIcon,
  GoForward30SecIcon,
  Image01Icon,
  InboxIcon,
  Key01Icon,
  Loading03Icon,
  MusicNote01Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QrCodeScanIcon,
  Search01Icon,
  SentIcon,
  Shield01Icon,
  Sorting01Icon,
  TextIcon,
  Upload04Icon,
  UserAccountIcon,
} from "@hugeicons/core-free-icons"
import { toDataURL } from "qrcode"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
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

type FolderAudioResponse = {
  entries: FolderEntry[]
}

type AudioSource = {
  id: string
  name: string
  src: string
  downloadUrl?: string
}

type PlayerState = {
  contextId: string
  queue: AudioSource[]
  currentIndex: number
}

type ActiveView =
  | { kind: "home" }
  | { kind: "folder"; item: Item; path: string }
  | { kind: "item"; item: Item }
  | { kind: "folder-entry"; folder: Item; entry: FolderEntry }

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

const appChrome = {
  content:
    "min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-[var(--landrop-shell-pad)] py-3 sm:px-[var(--landrop-shell-pad-wide)] sm:py-4",
  header:
    "shrink-0 border-b bg-background/95 px-[var(--landrop-shell-pad)] py-2 backdrop-blur sm:px-[var(--landrop-shell-pad-wide)]",
  shell:
    "mx-auto flex w-full max-w-[var(--landrop-shell-max)] min-w-0 items-center justify-between gap-3",
  viewport:
    "mx-auto grid h-svh w-full max-w-[var(--landrop-shell-max)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background text-foreground",
}

const playerChrome = {
  bar: "shrink-0 overflow-hidden border-t bg-background/95 shadow-lg backdrop-blur",
  body: "w-full max-w-full min-w-0 overflow-hidden border bg-muted p-3",
  control: "h-[var(--landrop-player-control)] w-full min-w-0",
  controls: "grid w-full min-w-0 grid-cols-5 gap-1.5 sm:gap-2",
  inner:
    "relative w-full max-w-full min-w-0 px-[var(--landrop-shell-pad)] py-2 sm:px-[var(--landrop-shell-pad-wide)]",
}

export function App() {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState("Loading library...")
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
  const [activeView, setActiveView] = useState<ActiveView>({ kind: "home" })
  const [player, setPlayer] = useState<PlayerState | null>(null)
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
            setStatus(nextItems.length ? "Library" : "No collections yet")
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

  const navigate = useCallback((nextView: ActiveView) => {
    setActiveView(nextView)
    writeActiveViewToUrl(nextView, "push")
  }, [])

  useEffect(() => {
    const applyUrlView = () => {
      const nextView = readActiveViewFromUrl(items)

      if (nextView) {
        setActiveView(nextView)
      }
    }

    applyUrlView()
    window.addEventListener("popstate", applyUrlView)

    return () => {
      window.removeEventListener("popstate", applyUrlView)
    }
  }, [items])

  const openItem = (item: Item) => {
    setCopyStatus("Copy")

    if (isFolderItem(item)) {
      navigate({ kind: "folder", item, path: "" })
      return
    }

    if (isAudioPreview(item)) {
      setPlayer({
        contextId: item.id,
        queue: [
          {
            id: item.id,
            name: item.name,
            src: `/api/items/${item.id}/open`,
            downloadUrl: `/api/items/${item.id}/download`,
          },
        ],
        currentIndex: 0,
      })
      return
    }

    navigate({ kind: "item", item })
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
        setActiveView((current) => {
          if (
            (current.kind === "folder" || current.kind === "item") &&
            current.item.id === item.id
          ) {
            return { kind: "home" }
          }

          if (
            current.kind === "folder-entry" &&
            current.folder.id === item.id
          ) {
            return { kind: "home" }
          }

          return current
        })
        setPlayer((current) => {
          if (current?.contextId === item.id) {
            return null
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
      toast.warning("Collection path is empty", {
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
        toast.success("Collection added", {
          description: path,
        })
      })
      .catch((error: unknown) => {
        toast.error("Collection failed", {
          description:
            error instanceof Error ? error.message : "Could not add collection",
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
    <main className="h-svh w-full overflow-hidden bg-background text-foreground">
      <div className={appChrome.viewport}>
        <div className={appChrome.header}>
          <div className={appChrome.shell}>
            <div className="flex min-w-0 items-center gap-3">
              <img alt="" className="size-8 shrink-0" src={landropLogoUrl} />
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">Shelf</h1>
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
                      aria-label="Add"
                      className="size-9"
                      title="Add"
                      type="button"
                      variant="default"
                    />
                  }
                >
                  <AppIcon icon={Add01Icon} />
                  <span className="sr-only">Add</span>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Add to library</DialogTitle>
                    <DialogDescription>
                      Send text, upload a file, or pull an image from the
                      clipboard.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4">
                    <div className="grid grid-cols-4 border">
                      {[
                        { key: "text", label: "Text", icon: TextIcon },
                        { key: "file", label: "File", icon: FolderUploadIcon },
                        {
                          key: "folder",
                          label: "Collection",
                          icon: FolderOpenIcon,
                        },
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
                          className="min-h-64 resize-y bg-background/80 p-4 font-mono text-sm leading-6"
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
                                Add a collection
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Use a folder path on the device running LAN
                                Drop.
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
                          {folderSubmitting ? "Adding..." : "Add collection"}
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
                                Copy an image or screenshot, then let LAN Drop
                                read it from the browser clipboard.
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
                      aria-label="Devices"
                      className="size-9"
                      title="Devices"
                      type="button"
                      variant="outline"
                    />
                  }
                >
                  <AppIcon icon={ComputerPhoneSyncIcon} />
                  <span className="sr-only">Devices</span>
                </DialogTrigger>
                <DialogContent className="sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Trusted browsers</DialogTitle>
                    <DialogDescription>
                      Rename this browser or revoke paired devices.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4">
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
                            onChange={(event) =>
                              setDeviceName(event.target.value)
                            }
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

                    <div className="grid gap-2">
                      {devices.map((device) => (
                        <article
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border bg-background/70 p-3"
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
                              {new Date(device.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {device.id === currentDeviceId ? (
                              <Badge variant="default">
                                <AppIcon icon={CheckmarkCircle02Icon} />
                                <span className="sr-only">This device</span>
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <AppIcon icon={Shield01Icon} />
                                <span className="sr-only">Trusted</span>
                              </Badge>
                            )}
                            <Button
                              aria-label={`Revoke ${device.name}`}
                              size="icon-xs"
                              type="button"
                              variant="destructive"
                              disabled={revokingDeviceId === device.id}
                              onClick={() => revokeDevice(device)}
                            >
                              <AppIcon icon={Delete02Icon} />
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
                  </div>

                  <DialogFooter showCloseButton />
                </DialogContent>
              </Dialog>

              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      aria-label="Connect phone"
                      className="size-9"
                      title="Connect phone"
                      type="button"
                      variant="default"
                    />
                  }
                >
                  <AppIcon icon={QrCodeScanIcon} />
                  <span className="sr-only">Connect phone</span>
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
        </div>

        <div className={appChrome.content}>
          <div className="mx-auto w-full max-w-[var(--landrop-shell-max)] min-w-0">
            {activeView.kind === "home" ? (
              <HomeView
                itemCounts={itemCounts}
                items={visibleItems}
                inboxFilter={inboxFilter}
                removingItemId={removingItemId}
                sortKey={sortKey}
                status={status}
                onChangeFilter={setInboxFilter}
                onChangeSort={setSortKey}
                onOpenItem={openItem}
                onRemoveItem={removeItem}
              />
            ) : null}

            {activeView.kind === "folder" ? (
              <FolderView
                item={activeView.item}
                path={activeView.path}
                player={player}
                onBack={() => navigate({ kind: "home" })}
                onOpenEntry={(entry) =>
                  navigate({
                    kind: "folder-entry",
                    folder: activeView.item,
                    entry,
                  })
                }
                onPathChange={(path) =>
                  navigate({ kind: "folder", item: activeView.item, path })
                }
                onSetPlayer={(nextPlayer) => setPlayer(nextPlayer)}
              />
            ) : null}

            {activeView.kind === "item" ? (
              <ItemView
                item={activeView.item}
                copyStatus={copyStatus}
                onBack={() => navigate({ kind: "home" })}
                onCopyStatusChange={setCopyStatus}
              />
            ) : null}

            {activeView.kind === "folder-entry" ? (
              <FolderEntryView
                entry={activeView.entry}
                folder={activeView.folder}
                onBack={() =>
                  navigate({
                    kind: "folder",
                    item: activeView.folder,
                    path: parentFolderPath(activeView.entry.path),
                  })
                }
              />
            ) : null}
          </div>
        </div>

        {player ? (
          <StickyPlayer
            player={player}
            onClose={() => setPlayer(null)}
            onSelectIndex={(currentIndex) =>
              setPlayer((current) =>
                current ? { ...current, currentIndex } : current
              )
            }
          />
        ) : null}
      </div>
    </main>
  )
}

function HomeView({
  inboxFilter,
  itemCounts,
  items,
  removingItemId,
  sortKey,
  status,
  onChangeFilter,
  onChangeSort,
  onOpenItem,
  onRemoveItem,
}: {
  inboxFilter: InboxFilter
  itemCounts: Record<InboxFilter, number>
  items: Item[]
  removingItemId: string | null
  sortKey: SortKey
  status: string
  onChangeFilter: (filter: InboxFilter) => void
  onChangeSort: (sort: SortKey) => void
  onOpenItem: (item: Item) => void
  onRemoveItem: (item: Item) => void
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">Library</h2>
          <p className="truncate text-xs text-muted-foreground">{status}</p>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Open JSON"
          title="Open JSON"
          render={
            <a href="/api/items">
              <AppIcon icon={File02Icon} />
              <span className="sr-only">JSON</span>
            </a>
          }
        />
      </div>

      <div className="flex flex-col gap-2 border bg-muted/30 p-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {inboxFilters.map((filter) => (
            <Button
              key={filter.key}
              aria-label={`${filter.label}: ${numberFormat.format(itemCounts[filter.key])}`}
              title={`${filter.label}: ${numberFormat.format(itemCounts[filter.key])}`}
              size="icon-sm"
              type="button"
              variant={inboxFilter === filter.key ? "default" : "outline"}
              onClick={() => onChangeFilter(filter.key)}
            >
              <AppIcon icon={filter.icon} />
              <span className="sr-only">{filter.label}</span>
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <AppIcon icon={Sorting01Icon} />
          Sort
          <select
            className="h-8 border bg-background px-2 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={sortKey}
            onChange={(event) => onChangeSort(event.target.value as SortKey)}
          >
            {Object.entries(sortLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-2">
        {items.map((item) => (
          <article
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border bg-card/80 p-3"
            key={item.id}
          >
            <div className="flex size-9 items-center justify-center border bg-muted">
              <AppIcon icon={iconForItem(item)} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{item.name}</h2>
                <Badge variant={item.kind === "folder" ? "default" : "outline"}>
                  {isFolderItem(item) ? "Collection" : labelForItem(item)}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {isFolderItem(item)
                    ? "Collection"
                    : `${numberFormat.format(item.size)} bytes`}
                </span>
                <span>{item.mime_type ?? "text/plain"}</span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex gap-1.5 justify-self-end">
              <Button
                aria-label={`Open ${item.name}`}
                variant="ghost"
                size="icon-xs"
                type="button"
                title="Open"
                onClick={() => onOpenItem(item)}
              >
                <AppIcon icon={Search01Icon} />
              </Button>
              {!isFolderItem(item) ? (
                <Button
                  aria-label={`Save ${item.name}`}
                  variant="outline"
                  size="icon-xs"
                  title="Save"
                  render={
                    <a href={`/api/items/${item.id}/download`}>
                      <AppIcon icon={Download04Icon} />
                    </a>
                  }
                />
              ) : null}
              <Button
                aria-label={`Unshare ${item.name}`}
                variant="outline"
                size="icon-xs"
                type="button"
                title="Unshare"
                disabled={removingItemId === item.id}
                onClick={() => onRemoveItem(item)}
              >
                <AppIcon
                  icon={
                    removingItemId === item.id ? Loading03Icon : Delete02Icon
                  }
                  className={removingItemId === item.id ? "animate-spin" : ""}
                />
              </Button>
            </div>
          </article>
        ))}

        {items.length === 0 ? (
          <div className="grid min-h-64 place-items-center border bg-muted/40 text-center">
            <AppIcon
              icon={InboxIcon}
              className="size-8 text-muted-foreground"
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function FolderView({
  item,
  path,
  player,
  onBack,
  onOpenEntry,
  onPathChange,
  onSetPlayer,
}: {
  item: Item
  path: string
  player: PlayerState | null
  onBack: () => void
  onOpenEntry: (entry: FolderEntry) => void
  onPathChange: (path: string) => void
  onSetPlayer: (player: PlayerState) => void
}) {
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [audioEntries, setAudioEntries] = useState<FolderEntry[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false

    fetch(folderListUrl(item.id, item.created_at, path), {
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
            error instanceof Error ? error.message : "Could not load collection"
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [item.created_at, item.id, path])

  useEffect(() => {
    let cancelled = false

    fetch(folderAudioUrl(item.id, item.created_at), {
      cache: "no-store",
    })
      .then(throwIfNotOk)
      .then((response) => response.json() as Promise<FolderAudioResponse>)
      .then((payload) => {
        if (!cancelled) {
          setAudioEntries(payload.entries)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAudioEntries([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [item.created_at, item.id])

  const audioSources = useMemo(
    () =>
      audioEntries.map((entry) => ({
        id: entry.path,
        name: entry.path,
        src: folderFileUrl(item.id, item.created_at, entry.path, "open"),
        downloadUrl: folderFileUrl(
          item.id,
          item.created_at,
          entry.path,
          "download"
        ),
      })),
    [audioEntries, item.created_at, item.id]
  )

  useEffect(() => {
    if (audioSources.length === 0 || player?.contextId === item.id) {
      return
    }

    onSetPlayer({
      contextId: item.id,
      queue: audioSources,
      currentIndex: bestResumeIndex(audioSources),
    })
  }, [audioSources, item.id, onSetPlayer, player?.contextId])

  const openEntry = (entry: FolderEntry) => {
    if (entry.kind === "folder") {
      onPathChange(entry.path)
      return
    }

    if (isAudioLike(entry)) {
      onSetPlayer({
        contextId: item.id,
        queue: audioSources,
        currentIndex: Math.max(
          0,
          audioSources.findIndex((source) => source.id === entry.path)
        ),
      })
      return
    }

    onOpenEntry(entry)
  }

  if (status === "loading") {
    return <LoadingPanel label="Loading collection..." />
  }

  if (status === "error") {
    return <ErrorPanel message={message} />
  }

  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          aria-label="Back to library"
          title="Back"
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onBack}
        >
          <AppIcon icon={PreviousIcon} />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{item.name}</h2>
          <p className="truncate text-xs text-muted-foreground">Collection</p>
        </div>
      </div>

      {audioSources.length > 0 ? (
        <div className="border bg-muted/30 p-3 text-xs text-muted-foreground">
          {player?.contextId === item.id
            ? "Continue listening"
            : "Ready to play"}
        </div>
      ) : null}

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border bg-muted/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <AppIcon icon={Folder01Icon} />
          <span className="truncate font-mono">{path || "/"}</span>
        </div>
        {path ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onPathChange(parentFolderPath(path))}
          >
            Up
          </Button>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-2">
        {entries.map((entry) => (
          <button
            className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border bg-card/80 px-3 py-3 text-left text-sm hover:bg-muted"
            key={entry.path}
            type="button"
            onClick={() => openEntry(entry)}
          >
            <AppIcon
              icon={entry.kind === "folder" ? Folder01Icon : iconForFile(entry)}
            />
            <span className="min-w-0 truncate">{entry.name}</span>
            <span className="hidden max-w-20 truncate text-right text-xs text-muted-foreground sm:block">
              {entry.kind === "folder"
                ? "Collection"
                : numberFormat.format(entry.size)}
            </span>
          </button>
        ))}
        {entries.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            This collection is empty.
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ItemView({
  item,
  copyStatus,
  onBack,
  onCopyStatusChange,
}: {
  item: Item
  copyStatus: string
  onBack: () => void
  onCopyStatusChange: (status: string) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    isTextPreview(item) ? "loading" : "ready"
  )
  const [message, setMessage] = useState("")
  const openUrl = `/api/items/${item.id}/open`
  const downloadUrl = `/api/items/${item.id}/download`

  useEffect(() => {
    if (!isTextPreview(item)) {
      return
    }

    let cancelled = false

    fetch(openUrl, { cache: "no-store" })
      .then(throwIfNotOk)
      .then((response) => response.text())
      .then((nextText) => {
        if (!cancelled) {
          setText(nextText)
          setStatus("ready")
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus("error")
          setMessage(error instanceof Error ? error.message : "Could not load")
        }
      })

    return () => {
      cancelled = true
    }
  }, [item, openUrl])

  const copyText = () => {
    if (text === null) {
      return
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        onCopyStatusChange("Copied")
        window.setTimeout(() => onCopyStatusChange("Copy"), 1200)
      })
      .catch(() => {
        onCopyStatusChange("Copy failed")
        window.setTimeout(() => onCopyStatusChange("Copy"), 1200)
      })
  }

  return (
    <DocumentShell
      title={item.name}
      detail={`${numberFormat.format(item.size)} bytes`}
      downloadUrl={downloadUrl}
      onBack={onBack}
    >
      {status === "loading" ? <LoadingPanel label="Loading..." /> : null}
      {status === "error" ? <ErrorPanel message={message} /> : null}
      {status === "ready" && isImagePreview(item) ? (
        <img
          alt={item.name}
          className="mx-auto max-h-[calc(100svh-10rem)] max-w-full object-contain"
          src={openUrl}
        />
      ) : null}
      {status === "ready" && text !== null ? (
        <div className="grid gap-2">
          <Button
            className="w-fit"
            type="button"
            variant="outline"
            size="sm"
            onClick={copyText}
          >
            <AppIcon icon={ClipboardCopyIcon} />
            {copyStatus}
          </Button>
          <pre className="overflow-x-auto border bg-muted p-4 font-mono text-xs leading-5">
            {text}
          </pre>
        </div>
      ) : null}
      {status === "ready" && !isImagePreview(item) && text === null ? (
        <ErrorPanel message="No inline view for this file type." />
      ) : null}
    </DocumentShell>
  )
}

function FolderEntryView({
  entry,
  folder,
  onBack,
}: {
  entry: FolderEntry
  folder: Item
  onBack: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    isTextLike(entry) ? "loading" : "ready"
  )
  const [message, setMessage] = useState("")
  const openUrl = folderFileUrl(
    folder.id,
    folder.created_at,
    entry.path,
    "open"
  )
  const downloadUrl = folderFileUrl(
    folder.id,
    folder.created_at,
    entry.path,
    "download"
  )

  useEffect(() => {
    if (!isTextLike(entry)) {
      return
    }

    let cancelled = false

    fetch(openUrl, { cache: "no-store" })
      .then(throwIfNotOk)
      .then((response) => response.text())
      .then((nextText) => {
        if (!cancelled) {
          setText(nextText)
          setStatus("ready")
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus("error")
          setMessage(error instanceof Error ? error.message : "Could not load")
        }
      })

    return () => {
      cancelled = true
    }
  }, [entry, openUrl])

  return (
    <DocumentShell
      title={entry.name}
      detail={entry.mime_type ?? "application/octet-stream"}
      downloadUrl={downloadUrl}
      onBack={onBack}
    >
      {status === "loading" ? <LoadingPanel label="Loading..." /> : null}
      {status === "error" ? <ErrorPanel message={message} /> : null}
      {status === "ready" && isImageLike(entry) ? (
        <img
          alt={entry.name}
          className="mx-auto max-h-[calc(100svh-10rem)] max-w-full object-contain"
          src={openUrl}
        />
      ) : null}
      {status === "ready" && text !== null ? (
        <pre className="overflow-x-auto border bg-muted p-4 font-mono text-xs leading-5">
          {text}
        </pre>
      ) : null}
      {status === "ready" && !isImageLike(entry) && text === null ? (
        <ErrorPanel message="No inline view for this file type." />
      ) : null}
    </DocumentShell>
  )
}

function DocumentShell({
  children,
  detail,
  downloadUrl,
  onBack,
  title,
}: {
  children: React.ReactNode
  detail: string
  downloadUrl: string
  onBack: () => void
  title: string
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            aria-label="Back"
            title="Back"
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onBack}
          >
            <AppIcon icon={PreviousIcon} />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">{detail}</p>
          </div>
        </div>
        <Button
          aria-label="Save"
          title="Save"
          variant="outline"
          size="icon-sm"
          render={
            <a href={downloadUrl}>
              <AppIcon icon={Download04Icon} />
            </a>
          }
        />
      </div>
      {children}
    </section>
  )
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center border bg-muted text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <AppIcon icon={Loading03Icon} className="animate-spin" />
        {label}
      </div>
    </div>
  )
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="border bg-muted p-4 text-xs text-muted-foreground">
      {message}
    </div>
  )
}

function StickyPlayer({
  player,
  onClose,
  onSelectIndex,
}: {
  player: PlayerState
  onClose: () => void
  onSelectIndex: (index: number) => void
}) {
  return (
    <div className={playerChrome.bar}>
      <div className={playerChrome.inner}>
        <Button
          aria-label="Close player"
          className="absolute top-4 right-[var(--landrop-shell-pad)] z-10 sm:right-[var(--landrop-shell-pad-wide)]"
          title="Close player"
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
        >
          <AppIcon icon={Delete02Icon} />
        </Button>
        <AudioPlayer
          compact
          source={player.queue[player.currentIndex]}
          queue={player.queue}
          currentIndex={player.currentIndex}
          onSelectIndex={onSelectIndex}
        />
      </div>
    </div>
  )
}

function AudioPlayer({
  compact = false,
  source,
  queue,
  currentIndex = -1,
  onSelectIndex,
}: {
  compact?: boolean
  source?: AudioSource
  queue?: AudioSource[]
  currentIndex?: number
  onSelectIndex?: (index: number) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [cacheStatus, setCacheStatus] = useState<
    "unsupported" | "checking" | "idle" | "caching" | "cached" | "error"
  >("caches" in window ? "idle" : "unsupported")
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loadedSourceSrc, setLoadedSourceSrc] = useState("")
  const [playbackRate, setPlaybackRate] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)

  if (!source) {
    return (
      <div className="border bg-muted p-4 text-xs text-muted-foreground">
        No audio selected.
      </div>
    )
  }

  const canGoPrevious = Boolean(queue && currentIndex > 0)
  const canGoNext = Boolean(
    queue && currentIndex >= 0 && currentIndex < queue.length - 1
  )
  const sourceReady = ready && loadedSourceSrc === source.src
  const displayedDuration = sourceReady ? duration : 0
  const displayedCurrentTime = sourceReady
    ? clamp(currentTime, 0, displayedDuration || currentTime)
    : 0
  const displayedPlaying = sourceReady && playing
  const progressKey = progressStorageKey(source.src)

  const saveProgress = (audio: HTMLAudioElement) => {
    if (!Number.isFinite(audio.currentTime) || audio.currentTime <= 0) {
      return
    }

    localStorage.setItem(
      progressKey,
      JSON.stringify({
        currentTime: audio.currentTime,
        duration: audio.duration,
        updatedAt: Date.now(),
      })
    )
  }

  const restoreProgress = (audio: HTMLAudioElement) => {
    const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0
    const savedTime = readSavedProgress(progressKey, nextDuration)

    audio.playbackRate = playbackRate
    setLoadedSourceSrc(source.src)
    setDuration(nextDuration)
    setReady(true)

    if (savedTime > 0 && Math.abs(audio.currentTime - savedTime) > 1) {
      audio.currentTime = savedTime
      setCurrentTime(savedTime)
    } else {
      setCurrentTime(audio.currentTime)
    }

    updateMediaSession(
      source.name,
      togglePlayback,
      (seconds) => skip(seconds),
      goPrevious,
      goNext
    )
  }

  const togglePlayback = () => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (audio.paused) {
      audio.play().catch(() => toast.error("Audio playback failed"))
    } else {
      audio.pause()
    }
  }

  const skip = (seconds: number) => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const activeDuration = Number.isFinite(audio.duration)
      ? audio.duration
      : displayedDuration
    const nextTime = clamp(
      audio.currentTime + seconds,
      0,
      activeDuration > 0 ? activeDuration : audio.currentTime
    )

    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    saveProgress(audio)
  }

  const seekToRatio = (clientX: number, element: HTMLElement) => {
    const audio = audioRef.current

    if (!audio || !sourceReady || displayedDuration <= 0) {
      return
    }

    const bounds = element.getBoundingClientRect()
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
    const nextTime = ratio * displayedDuration
    const wasPlaying = !audio.paused

    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    saveProgress(audio)

    if (wasPlaying) {
      audio.play().catch(() => setPlaying(false))
    }
  }

  const seekByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current

    if (!audio || !sourceReady || displayedDuration <= 0) {
      return
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault()
      skip(-15)
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      skip(15)
    }

    if (event.key === "Home") {
      event.preventDefault()
      audio.currentTime = 0
      setCurrentTime(0)
      saveProgress(audio)
    }

    if (event.key === "End") {
      event.preventDefault()
      audio.currentTime = displayedDuration
      setCurrentTime(displayedDuration)
      saveProgress(audio)
    }
  }

  const goPrevious = () => {
    if (canGoPrevious && onSelectIndex) {
      onSelectIndex(currentIndex - 1)
    }
  }

  const goNext = () => {
    if (canGoNext && onSelectIndex) {
      onSelectIndex(currentIndex + 1)
    }
  }

  const changePlaybackRate = (value: string) => {
    const nextRate = Number(value)
    const audio = audioRef.current

    if (!Number.isFinite(nextRate)) {
      return
    }

    if (audio) {
      audio.playbackRate = nextRate
    }

    setPlaybackRate(nextRate)
  }

  const keepOffline = () => {
    if (!("caches" in window)) {
      setCacheStatus("unsupported")
      return
    }

    setCacheStatus("caching")

    fetch(source.src, { credentials: "include" })
      .then(throwIfNotOk)
      .then((response) =>
        caches
          .open("landrop-media-v1")
          .then((cache) => cache.put(source.src, response))
      )
      .then(() => {
        setCacheStatus("cached")
        toast.success("Saved for offline listening", {
          description: source.name,
        })
      })
      .catch((error: unknown) => {
        setCacheStatus("error")
        toast.error("Could not cache audio", {
          description:
            error instanceof Error ? error.message : "Offline save failed",
        })
      })
  }

  const removeOffline = () => {
    if (!("caches" in window)) {
      return
    }

    caches
      .open("landrop-media-v1")
      .then((cache) => cache.delete(source.src))
      .then(() => {
        setCacheStatus("idle")
        toast.success("Removed offline copy", {
          description: source.name,
        })
      })
      .catch(() => {
        setCacheStatus("error")
      })
  }

  const progress =
    displayedDuration > 0
      ? clamp((displayedCurrentTime / displayedDuration) * 100, 0, 100)
      : 0

  return (
    <div className={cn(playerChrome.body, !compact && "sm:p-4")}>
      <audio
        key={source.src}
        ref={audioRef}
        preload="metadata"
        src={source.src}
        onDurationChange={(event) => {
          const audio = event.currentTarget
          const nextDuration = Number.isFinite(audio.duration)
            ? audio.duration
            : 0

          setDuration(nextDuration)
        }}
        onEnded={() => {
          setPlaying(false)

          if (canGoNext && onSelectIndex) {
            onSelectIndex(currentIndex + 1)
          }
        }}
        onError={() => {
          setPlaying(false)
          toast.error("Audio playback failed", {
            description: "If the server is off, keep this file offline first.",
          })
        }}
        onLoadedMetadata={(event) => restoreProgress(event.currentTarget)}
        onPause={() => setPlaying(false)}
        onPlay={(event) => {
          event.currentTarget.playbackRate = playbackRate
          setPlaying(true)
        }}
        onSeeked={(event) => saveProgress(event.currentTarget)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget

          setLoadedSourceSrc(source.src)
          setCurrentTime(audio.currentTime)
          saveProgress(audio)
        }}
      />

      <div className="grid gap-3">
        <div
          className={cn(
            "flex min-w-0 items-start justify-between gap-3",
            compact && "pr-8"
          )}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{source.name}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {formatDuration(displayedCurrentTime)} /{" "}
              {formatDuration(displayedDuration)}
            </p>
          </div>
          <Badge
            className={cn("shrink-0", compact && "hidden sm:inline-flex")}
            variant={cacheStatus === "cached" ? "default" : "outline"}
          >
            {cacheStatus === "cached" ? "Offline" : "Stream"}
          </Badge>
        </div>

        <div
          aria-label="Playback position"
          aria-valuemax={Math.max(displayedDuration, 0)}
          aria-valuemin={0}
          aria-valuenow={Math.min(
            displayedCurrentTime,
            displayedDuration || displayedCurrentTime
          )}
          className={cn(
            "group relative cursor-pointer touch-none",
            compact ? "h-6" : "h-8",
            (!sourceReady || displayedDuration <= 0) &&
              "pointer-events-none opacity-50"
          )}
          role="slider"
          tabIndex={sourceReady && displayedDuration > 0 ? 0 : -1}
          onKeyDown={seekByKeyboard}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            seekToRatio(event.clientX, event.currentTarget)
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) {
              seekToRatio(event.clientX, event.currentTarget)
            }
          }}
        >
          <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 bg-border" />
          <div
            className="absolute top-1/2 left-0 h-1 -translate-y-1/2 bg-primary"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 border bg-primary shadow-sm transition-transform group-hover:scale-110"
            style={{ left: `${progress}%` }}
          />
        </div>

        <div className={playerChrome.controls}>
          <Button
            aria-label="Previous track"
            className={playerChrome.control}
            title="Previous track"
            type="button"
            variant="outline"
            size="icon"
            disabled={!canGoPrevious}
            onClick={goPrevious}
          >
            <AppIcon icon={PreviousIcon} />
          </Button>
          <Button
            aria-label="Skip backward 15 seconds"
            className={playerChrome.control}
            title="Skip backward 15 seconds"
            type="button"
            variant="outline"
            size="icon"
            disabled={!sourceReady}
            onClick={() => skip(-15)}
          >
            <AppIcon icon={GoBackward15SecIcon} />
          </Button>
          <Button
            aria-label={displayedPlaying ? "Pause" : "Play"}
            className={playerChrome.control}
            title={displayedPlaying ? "Pause" : "Play"}
            type="button"
            variant="default"
            size="icon"
            disabled={!sourceReady}
            onClick={togglePlayback}
          >
            <AppIcon icon={displayedPlaying ? PauseIcon : PlayIcon} />
          </Button>
          <Button
            aria-label="Skip forward 30 seconds"
            className={playerChrome.control}
            title="Skip forward 30 seconds"
            type="button"
            variant="outline"
            size="icon"
            disabled={!sourceReady}
            onClick={() => skip(30)}
          >
            <AppIcon icon={GoForward30SecIcon} />
          </Button>
          <Button
            aria-label="Next track"
            className={playerChrome.control}
            title="Next track"
            type="button"
            variant="outline"
            size="icon"
            disabled={!canGoNext}
            onClick={goNext}
          >
            <AppIcon icon={NextIcon} />
          </Button>
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center gap-3 text-xs text-muted-foreground",
            compact && "hidden sm:flex"
          )}
        >
          <label className="flex items-center gap-2">
            Speed
            <select
              className="h-8 border bg-background px-2 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={playbackRate}
              onChange={(event) => changePlaybackRate(event.target.value)}
            >
              {[0.8, 1, 1.15, 1.25, 1.5, 1.75, 2].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          </label>
          {cacheStatus === "cached" ? (
            <Button
              aria-label="Remove offline copy"
              title="Remove offline copy"
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={removeOffline}
            >
              <AppIcon icon={Delete02Icon} />
            </Button>
          ) : (
            <Button
              aria-label="Keep offline"
              title="Keep offline"
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={
                cacheStatus === "caching" || cacheStatus === "unsupported"
              }
              onClick={keepOffline}
            >
              <AppIcon
                icon={
                  cacheStatus === "caching" ? Loading03Icon : Download04Icon
                }
                className={cacheStatus === "caching" ? "animate-spin" : ""}
              />
            </Button>
          )}
          {source.downloadUrl ? (
            <Button
              aria-label="Save audio file"
              title="Save audio file"
              variant="outline"
              size="icon-xs"
              render={
                <a href={source.downloadUrl}>
                  <AppIcon icon={Download04Icon} />
                </a>
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function progressStorageKey(src: string) {
  return `landrop:progress:${src}`
}

function readSavedProgress(key: string, duration: number) {
  try {
    const raw = localStorage.getItem(key)

    if (!raw) {
      return 0
    }

    const saved = JSON.parse(raw) as { currentTime?: unknown }
    const currentTime =
      typeof saved.currentTime === "number" ? saved.currentTime : 0

    if (!Number.isFinite(currentTime) || currentTime < 5) {
      return 0
    }

    if (
      Number.isFinite(duration) &&
      duration > 0 &&
      currentTime > duration - 10
    ) {
      return 0
    }

    return currentTime
  } catch {
    return 0
  }
}

function updateMediaSession(
  title: string,
  togglePlayback: () => void,
  skip: (seconds: number) => void,
  goPrevious: () => void,
  goNext: () => void
) {
  if (!("mediaSession" in navigator)) {
    return
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: "LAN Drop",
  })

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ["play", togglePlayback],
    ["pause", togglePlayback],
    ["previoustrack", goPrevious],
    ["nexttrack", goNext],
    ["seekbackward", () => skip(-15)],
    ["seekforward", () => skip(30)],
  ]

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Some browsers expose Media Session but not every action.
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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

function readActiveViewFromUrl(items: Item[]): ActiveView | null {
  const params = new URLSearchParams(window.location.search)
  const view = params.get("view")
  const itemId = params.get("id")

  if (!view) {
    return { kind: "home" }
  }

  if (!itemId) {
    return null
  }

  const item = items.find((candidate) => candidate.id === itemId)

  if (!item) {
    return null
  }

  if (view === "collection" && isFolderItem(item)) {
    return {
      kind: "folder",
      item,
      path: params.get("path") ?? "",
    }
  }

  if (view === "item" && !isFolderItem(item)) {
    return { kind: "item", item }
  }

  if (view === "file" && isFolderItem(item)) {
    const path = params.get("path")

    if (!path) {
      return null
    }

    return {
      kind: "folder-entry",
      folder: item,
      entry: {
        kind: "file",
        mime_type: mimeTypeForName(path),
        modified_at: null,
        name: basenameFromPath(path),
        path,
        size: 0,
      },
    }
  }

  return null
}

function writeActiveViewToUrl(view: ActiveView, mode: "push" | "replace") {
  const url = new URL(window.location.href)
  const params = url.searchParams

  params.delete("view")
  params.delete("id")
  params.delete("path")

  if (view.kind === "folder") {
    params.set("view", "collection")
    params.set("id", view.item.id)

    if (view.path) {
      params.set("path", view.path)
    }
  } else if (view.kind === "item") {
    params.set("view", "item")
    params.set("id", view.item.id)
  } else if (view.kind === "folder-entry") {
    params.set("view", "file")
    params.set("id", view.folder.id)
    params.set("path", view.entry.path)
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`

  if (
    nextUrl ===
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  ) {
    return
  }

  if (mode === "replace") {
    window.history.replaceState(null, "", nextUrl)
  } else {
    window.history.pushState(null, "", nextUrl)
  }
}

function parentFolderPath(path: string) {
  return path.split("/").slice(0, -1).join("/")
}

function bestResumeIndex(sources: AudioSource[]) {
  let bestIndex = 0
  let bestUpdatedAt = 0

  sources.forEach((source, index) => {
    try {
      const raw = localStorage.getItem(progressStorageKey(source.src))

      if (!raw) {
        return
      }

      const saved = JSON.parse(raw) as { updatedAt?: unknown }
      const updatedAt =
        typeof saved.updatedAt === "number" ? saved.updatedAt : 0

      if (updatedAt > bestUpdatedAt) {
        bestUpdatedAt = updatedAt
        bestIndex = index
      }
    } catch {
      // Ignore corrupt local progress entries.
    }
  })

  return bestIndex
}

function basenameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

function mimeTypeForName(name: string) {
  const lower = name.toLowerCase()

  if (lower.endsWith(".aac")) return "audio/aac"
  if (lower.endsWith(".flac")) return "audio/flac"
  if (lower.endsWith(".m4a")) return "audio/mp4"
  if (lower.endsWith(".mp3")) return "audio/mpeg"
  if (lower.endsWith(".oga") || lower.endsWith(".ogg")) return "audio/ogg"
  if (lower.endsWith(".opus")) return "audio/ogg"
  if (lower.endsWith(".wav")) return "audio/wav"
  if (lower.endsWith(".webm")) return "audio/webm"
  if (lower.endsWith(".avif")) return "image/avif"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8"
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8"

  return "application/octet-stream"
}

function folderListUrl(itemId: string, itemCreatedAt: number, path: string) {
  const params = new URLSearchParams({
    path,
    revision: String(itemCreatedAt),
  })

  return `/api/items/${itemId}/folder?${params.toString()}`
}

function folderAudioUrl(itemId: string, itemCreatedAt: number) {
  const params = new URLSearchParams({
    revision: String(itemCreatedAt),
  })

  return `/api/items/${itemId}/folder/audio?${params.toString()}`
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
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")

  if (hours > 0) {
    const hourMinutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
      2,
      "0"
    )

    return `${hours}:${hourMinutes}:${seconds}`
  }

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
