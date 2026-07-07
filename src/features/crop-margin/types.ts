export type CropMarginTemplateId = 'clean' | 'note' | 'grid'

export type CropMarginWidthLevel = 'small' | 'medium' | 'large'

export type CropMarginVariant = {
  id: string
  label: string
  fileName: string
  fileSize: number
  mimeType: string
  base64: string
  width: number
  height: number
  factor?: number
}

export type CropMarginSource = Omit<CropMarginVariant, 'label' | 'factor'> & {
  id: string
  sourceLabel?: string
  variants: CropMarginVariant[]
  selectedVariantId: string
}

export type CropMarginIncomingImage = Omit<CropMarginSource, 'id' | 'variants' | 'selectedVariantId'> & {
  id?: string
  variants?: CropMarginVariant[]
  selectedVariantId?: string
}

export type CropMarginOutput = {
  base64: string
  marginWidth: number
  outputWidth: number
  outputHeight: number
}
