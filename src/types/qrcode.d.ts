declare module "qrcode" {
  export type ErrorCorrectionLevel =
    | "low"
    | "medium"
    | "quartile"
    | "high"
    | "L"
    | "M"
    | "Q"
    | "H"

  export type QRCodeToDataURLOptions = {
    errorCorrectionLevel?: ErrorCorrectionLevel
    margin?: number
    width?: number
    color?: {
      dark?: string
      light?: string
    }
  }

  export type QRCodeToStringOptions = {
    errorCorrectionLevel?: ErrorCorrectionLevel
    margin?: number
    small?: boolean
    type?: "terminal" | "utf8" | "svg"
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>

  export function toString(
    text: string,
    options?: QRCodeToStringOptions
  ): Promise<string>
}
