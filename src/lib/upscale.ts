import { normalizeBaseUrl } from './storage'

export type UpscaleResult = {
  imageBase64: string
  width: number
  height: number
}

// 统一放大契约：纯 base64 + 目标宽高 -> 自建 /upscale 端点 -> 放大后纯 base64
export async function upscaleImage(
  config: { apiUrl: string; apiKey: string },
  imageBase64: string,
  targetWidth: number,
  targetHeight: number,
): Promise<UpscaleResult> {
  const url = normalizeBaseUrl(config.apiUrl)
  if (!url)
    throw new Error('未配置放大服务地址')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ imageBase64, targetWidth, targetHeight }),
  })

  // 防 CORS / 非 JSON body 在解析阶段二次抛错
  const payload = await response.json().catch(() => ({})) as Partial<UpscaleResult> & { message?: string }
  if (!response.ok || !payload.imageBase64)
    throw new Error(payload.message || `放大失败 (HTTP ${response.status})`)

  return {
    imageBase64: payload.imageBase64,
    width: payload.width || targetWidth,
    height: payload.height || targetHeight,
  }
}
