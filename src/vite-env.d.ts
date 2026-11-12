/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Optional absolute URL that receives feedback JSON. Unset = local only. */
  readonly VITE_FEEDBACK_ENDPOINT?: string
  /** Optional privacy-conscious analytics script/endpoint. Unset = no analytics. */
  readonly VITE_ANALYTICS_ENDPOINT?: string
  /**
   * Base URL of the CodePilot API. Leave unset for a same-origin deployment
   * (Vite proxies `/api` to 127.0.0.1:8787 during development).
   */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
