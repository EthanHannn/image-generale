export type ModelPreset = {
  id: string
  owned_by?: string
  displayName?: string
  description?: string
  sizeFormat?: string
  maxGenerations: number
  maxInputImages: number
  creditPerImage?: number
  defaultSize?: string
  defaultResolution?: string
  supportedSizes?: string[]
  supportedResolutions?: string[]
  hasResolution?: boolean
}

export const MODEL_PRESETS: Record<string, ModelPreset> = {
  'nano-banana-2': {
    id: 'nano-banana-2',
    owned_by: 'doraverse',
    displayName: 'Nano Banana 2',
    description: 'Pro quality at flash speed, with web Search, 4K.',
    sizeFormat: 'ratio',
    maxGenerations: 4,
    maxInputImages: 4,
    creditPerImage: 60,
    defaultSize: '21:9',
    defaultResolution: '1K',
    supportedSizes: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
    supportedResolutions: ['1K', '2K', '4K'],
    hasResolution: true,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    owned_by: 'doraverse',
    displayName: 'Nano Banana Pro',
    description: "Google's state-of-the-art with thinking.",
    sizeFormat: 'ratio',
    maxGenerations: 4,
    maxInputImages: 2,
    creditPerImage: 75,
    defaultSize: '21:9',
    defaultResolution: '1K',
    supportedSizes: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
    supportedResolutions: ['1K', '2K'],
    hasResolution: true,
  },
  'gemini-2.5-flash-image': {
    id: 'gemini-2.5-flash-image',
    owned_by: 'doraverse',
    displayName: 'Nano Banana',
    description: 'Studio-grade edits, highly creative, pro quality.',
    sizeFormat: 'ratio',
    maxGenerations: 4,
    maxInputImages: 2,
    creditPerImage: 25,
    defaultSize: '21:9',
    defaultResolution: '720p',
    supportedSizes: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
    supportedResolutions: ['720p'],
    hasResolution: false,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    owned_by: 'doraverse',
    displayName: 'ChatGPT-Image 2',
    description: 'Conversational editing, strong prompt adherence.',
    sizeFormat: 'absolute',
    maxGenerations: 4,
    maxInputImages: 4,
    creditPerImage: 0,
    defaultSize: '1024x1024',
    defaultResolution: '720p',
    supportedSizes: ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792', '2048x1152', '1152x2048', '2048x2048', '2560x1440', '1440x2560', '3840x2160', '2160x3840'],
    supportedResolutions: ['720p'],
    hasResolution: false,
  },
  'grok-imagine-image': {
    id: 'grok-imagine-image',
    owned_by: 'doraverse',
    displayName: 'Grok Imagine',
    description: 'High-realism visuals, precise text & logos.',
    sizeFormat: 'ratio',
    maxGenerations: 4,
    maxInputImages: 1,
    creditPerImage: 11,
    defaultSize: '2:1',
    defaultResolution: '720p',
    supportedSizes: ['2:1', '20:9', '19.5:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:19.5', '9:20', '1:2'],
    supportedResolutions: ['720p'],
    hasResolution: false,
  },
  'seedream-4.5': {
    id: 'seedream-4.5',
    owned_by: 'doraverse',
    displayName: 'Seedream 4.5',
    description: 'Best text rendering, photorealistic output, 4K.',
    sizeFormat: 'named',
    maxGenerations: 6,
    maxInputImages: 6,
    creditPerImage: 20,
    defaultSize: 'square_hd',
    defaultResolution: '720p',
    supportedSizes: ['auto', 'square', 'square_hd', '3:4', '4:3', '9:16', '16:9', 'auto_2K', 'auto_4K'],
    supportedResolutions: ['720p'],
    hasResolution: false,
  },
  'flux-2': {
    id: 'flux-2',
    owned_by: 'doraverse',
    displayName: 'Flux 2',
    description: 'Multi-reference control, unmatched photorealism, 4K.',
    sizeFormat: 'named',
    maxGenerations: 1,
    maxInputImages: 2,
    creditPerImage: 6,
    defaultSize: 'square_hd',
    defaultResolution: '720p',
    supportedSizes: ['square_hd', 'square', 'portrait_4:3', 'portrait_16:9', 'landscape_4:3', 'landscape_16:9'],
    supportedResolutions: ['720p'],
    hasResolution: false,
  },
}

export type RemoteModel = Partial<ModelPreset> & { id: string }

export function hydrateModels(models: RemoteModel[]) {
  return models.map((model) => {
    const preset = MODEL_PRESETS[model.id]
    if (!preset)
      return {
        maxGenerations: 1,
        maxInputImages: 1,
        supportedSizes: [],
        supportedResolutions: [],
        hasResolution: false,
        ...model,
      }

    const merged = { ...preset, ...model }
    for (const [key, value] of Object.entries(preset)) {
      const current = merged[key as keyof typeof merged]
      if (current === undefined || current === null || current === '')
        (merged as Record<string, unknown>)[key] = value
    }
    return merged
  })
}
