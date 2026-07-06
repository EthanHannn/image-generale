export type CropMarginTemplateId = 'clean' | 'note' | 'grid'

export type CropMarginWidthLevel = 'small' | 'medium' | 'large'

export type CropMarginSource = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  base64: string
  width: number
  height: number
}

export type CropMarginOutput = {
  base64: string
  marginWidth: number
  outputWidth: number
  outputHeight: number
}
