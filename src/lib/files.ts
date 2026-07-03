import { base64ToBlob, downloadBlob } from './utils'

export type SaveImageOptions = {
  imageBase64: string
  filename: string
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
}

export type SaveImageResult = {
  status: 'saved' | 'cancelled'
  path?: string
}

function isDesktopApp() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function saveImageFile(options: SaveImageOptions): Promise<SaveImageResult> {
  const mimeType = options.mimeType || 'image/png'

  if (!isDesktopApp()) {
    downloadBlob(base64ToBlob(options.imageBase64), options.filename)
    return { status: 'saved' }
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<SaveImageResult>('save_image_file', {
    imageBase64: options.imageBase64,
    filename: options.filename,
    mimeType,
  })
}
