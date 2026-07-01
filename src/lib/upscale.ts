import { type UpscaleConfig, normalizeBaseUrl } from './storage'
import { getErrorMessage } from './errors'

export type UpscaleResult = {
  imageBase64: string
  width: number
  height: number
  responseJson?: unknown
}

export async function upscaleImage(
  config: UpscaleConfig,
  imageBase64: string,
  targetWidth: number,
  targetHeight: number,
): Promise<UpscaleResult> {
  if (config.provider === 'aliyun')
    return invokeAliyunUpscale(config.accessKeyId, config.accessKeySecret, imageBase64, targetWidth, targetHeight)
  return invokeCustomUpscale(config.apiUrl, config.apiKey, imageBase64, targetWidth, targetHeight)
}

// 自建端点：纯 base64 + 目标宽高 -> /upscale -> 放大后纯 base64
async function invokeCustomUpscale(
  apiUrl: string,
  apiKey: string,
  imageBase64: string,
  targetWidth: number,
  targetHeight: number,
): Promise<UpscaleResult> {
  const url = normalizeBaseUrl(apiUrl)
  if (!url)
    throw new Error('未配置放大服务地址')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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

// 阿里云路径：调 Tauri 后端命令（Step 3 实现）
// targetWidth/targetHeight 透传给 Rust，由后端解码图片后推算 scale (2 or 4)
async function invokeAliyunUpscale(
  accessKeyId: string,
  accessKeySecret: string,
  imageBase64: string,
  targetWidth: number,
  targetHeight: number,
): Promise<UpscaleResult> {
  const { invoke } = await import('@tauri-apps/api/core')
  const result = await invoke<{ image_base64: string; width: number; height: number; response_json?: unknown }>('aliyun_upscale', {
    accessKeyId,
    accessKeySecret,
    imageBase64,
    targetWidth,
    targetHeight,
  }).catch((error: unknown) => {
    throw new Error(getErrorMessage(error))
  })
  return { imageBase64: result.image_base64, width: result.width, height: result.height, responseJson: result.response_json }
}
