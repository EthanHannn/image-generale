import type { CropMarginIncomingImage, CropMarginSource, CropMarginVariant } from './types'

export function normalizeCropMarginIncomingSource(image: CropMarginIncomingImage): CropMarginSource {
  const fallbackVariant = makeOriginalVariant(image)
  const variants = normalizeVariants(image.variants, fallbackVariant)
  const selectedVariantId = variants.some(variant => variant.id === image.selectedVariantId)
    ? image.selectedVariantId as string
    : variants[0].id

  return {
    ...image,
    id: image.id || makeSourceId(),
    variants,
    selectedVariantId,
  }
}

export function mergeCropMarginSources(incomingSources: CropMarginSource[], currentSources: CropMarginSource[]) {
  const uniqueIncomingSources: CropMarginSource[] = []
  const incomingKeys = new Set<string>()
  incomingSources.forEach((source) => {
    const key = getCropMarginSourceKey(source)
    if (incomingKeys.has(key))
      return

    incomingKeys.add(key)
    uniqueIncomingSources.push(source)
  })

  return [
    ...uniqueIncomingSources,
    ...currentSources.filter(source => !incomingKeys.has(getCropMarginSourceKey(source))),
  ]
}

export function makeOriginalVariant(image: Omit<CropMarginIncomingImage, 'id' | 'variants' | 'selectedVariantId'>): CropMarginVariant {
  return {
    id: 'original',
    label: '原图',
    fileName: image.fileName,
    fileSize: image.fileSize,
    mimeType: image.mimeType,
    base64: image.base64,
    width: image.width,
    height: image.height,
  }
}

export function makeSourceId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function normalizeVariants(variants: CropMarginVariant[] | undefined, fallbackVariant: CropMarginVariant) {
  const nextVariants = variants?.length ? variants : [fallbackVariant]
  const uniqueVariants: CropMarginVariant[] = []
  const ids = new Set<string>()
  nextVariants.forEach((variant, index) => {
    const id = variant.id || (index === 0 ? 'original' : `variant_${index}`)
    if (ids.has(id))
      return

    ids.add(id)
    uniqueVariants.push({ ...variant, id })
  })
  return uniqueVariants.length ? uniqueVariants : [fallbackVariant]
}

function getCropMarginSourceKey(source: CropMarginSource) {
  const baseVariant = source.variants.find(variant => variant.id === 'original') || source.variants[0] || source
  return [
    baseVariant.mimeType || source.mimeType,
    baseVariant.width,
    baseVariant.height,
    baseVariant.fileSize,
    hashText(baseVariant.base64),
  ].join('|')
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
