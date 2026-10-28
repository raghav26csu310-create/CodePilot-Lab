export type WebGLSupport = 'webgl2' | 'webgl' | 'none'

let cached: WebGLSupport | null = null

function detect(): WebGLSupport {
  if (cached) {
    return cached
  }

  try {
    const canvas = document.createElement('canvas')
    let context: WebGL2RenderingContext | WebGLRenderingContext | null = null

    try {
      context = canvas.getContext('webgl2')
    } catch {
      context = null
    }

    if (!context) {
      try {
        context = canvas.getContext('webgl')
      } catch {
        context = null
      }
    }

    if (!context) {
      cached = 'none'
      return cached
    }

    cached = context instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl'
    context.getExtension('WEBGL_lose_context')?.loseContext()
    return cached
  } catch {
    cached = 'none'
    return cached
  }
}

export function useWebGLSupport(): WebGLSupport {
  return detect()
}
