import { AiError, toAiError } from './errors'
import { adapterForSettings } from './providers'
import type { AiChatTurn, AiSettings } from './types'

/**
 * One-off assistant turn used by the non-workspace surfaces (Practice and the
 * Execution Lab tracer). It reuses the same provider adapters and settings as
 * the Copilot dock — there is no second AI stack and no canned answer. If the
 * provider fails, the classified error propagates unchanged.
 */
export async function streamAssistant(request: {
  settings: AiSettings
  system: string
  user: string
  signal: AbortSignal
  onDelta: (chunk: string) => void
}): Promise<string> {
  let text = ''
  const turns: AiChatTurn[] = [
    { role: 'system', content: request.system },
    { role: 'user', content: request.user },
  ]

  try {
    const adapter = adapterForSettings(request.settings)
    await adapter.stream({
      settings: request.settings,
      turns,
      signal: request.signal,
      onDelta: (chunk) => {
        text += chunk
        request.onDelta(chunk)
      },
    })
  } catch (cause) {
    if (cause instanceof AiError) {
      throw cause
    }
    throw toAiError(cause, request.settings.baseUrl)
  }

  return text
}
