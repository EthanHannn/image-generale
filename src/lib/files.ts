import { base64ToBlob, downloadBlob } from './utils'

export type SaveImageOptions = {
  imageBase64: string
  filename: string
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
}

export type SaveImageBatchItem = SaveImageOptions

export type SaveImageResult = {
  status: 'saved' | 'cancelled'
  path?: string
}

export type SaveImageBatchResult = {
  status: 'saved' | 'cancelled'
  directory?: string
  savedCount: number
  failedCount: number
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

export async function saveImageFilesToDirectory(images: SaveImageBatchItem[]): Promise<SaveImageBatchResult> {
  if (!images.length)
    return { status: 'saved', savedCount: 0, failedCount: 0 }

  if (!isDesktopApp()) {
    for (const image of images)
      downloadBlob(base64ToBlob(image.imageBase64), image.filename)

    return { status: 'saved', savedCount: images.length, failedCount: 0 }
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<SaveImageBatchResult>('save_image_files_to_directory', {
    images: images.map(image => ({
      imageBase64: image.imageBase64,
      filename: image.filename,
      mimeType: image.mimeType || 'image/png',
    })),
  })
}
