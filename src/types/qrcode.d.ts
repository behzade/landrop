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

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>
}
