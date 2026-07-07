import type { CropMarginOutput } from './types'
import type { CropMarginTemplate } from './cropMarginTemplates'

type RenderCropMarginOptions = {
  sourceDataUrl: string
  sourceWidth: number
  sourceHeight: number
  marginRatio: number
  template: CropMarginTemplate
}

const MIN_MARGIN_WIDTH = 160
const MAX_MARGIN_WIDTH = 640
const WATERMARK_BADGE_URL = new URL('../../assets/watermark-crop-badge.png', import.meta.url).href

export function getCropMarginWidth(sourceWidth: number, ratio: number) {
  return Math.min(MAX_MARGIN_WIDTH, Math.max(MIN_MARGIN_WIDTH, Math.round(sourceWidth * ratio)))
}

export async function renderCropMarginImage(options: RenderCropMarginOptions): Promise<CropMarginOutput> {
  const [image, badgeImage] = await Promise.all([
    loadImage(options.sourceDataUrl),
    loadImage(WATERMARK_BADGE_URL).catch(() => null),
  ])
  const marginWidth = getCropMarginWidth(options.sourceWidth, options.marginRatio)
  const outputWidth = options.sourceWidth + marginWidth
  const outputHeight = options.sourceHeight
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight

  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('当前环境无法创建画布')

  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, outputWidth, outputHeight)
  context.drawImage(image, 0, 0, options.sourceWidth, options.sourceHeight)
  drawMarginArea(context, options.sourceWidth, marginWidth, outputHeight, options.template, badgeImage)

  const blob = await canvasToBlob(canvas)
  const base64 = await blobToBase64(blob)
  return { base64, marginWidth, outputWidth, outputHeight }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败'))
    image.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else
        reject(new Error('图片导出失败'))
    }, 'image/png')
  })
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })
}

function drawMarginArea(
  context: CanvasRenderingContext2D,
  startX: number,
  width: number,
  height: number,
  template: CropMarginTemplate,
  badgeImage: HTMLImageElement | null,
) {
  context.save()
  context.fillStyle = template.background
  context.fillRect(startX, 0, width, height)
  drawPattern(context, startX, width, height, template)
  drawDivider(context, startX, height, template)
  drawBadgeImage(context, startX, width, height, badgeImage)
  drawText(context, startX, width, height, template)
  context.restore()
}

function drawPattern(
  context: CanvasRenderingContext2D,
  startX: number,
  width: number,
  height: number,
  template: CropMarginTemplate,
) {
  if (template.pattern === 'plain')
    return

  if (template.pattern === 'dots') {
    context.fillStyle = 'rgba(255, 255, 255, 0.68)'
    const step = Math.max(18, Math.round(width / 7))
    for (let y = step; y < height; y += step) {
      for (let x = startX + step; x < startX + width; x += step) {
        context.beginPath()
        context.arc(x, y, 2.2, 0, Math.PI * 2)
        context.fill()
      }
    }
    return
  }

  const cell = Math.max(18, Math.round(width / 6))
  for (let y = 0; y < height; y += cell) {
    for (let x = startX; x < startX + width; x += cell) {
      context.fillStyle = ((x - startX) / cell + y / cell) % 2 === 0
        ? 'rgba(226, 232, 240, 0.52)'
        : 'rgba(255, 255, 255, 0.42)'
      context.fillRect(x, y, cell, cell)
    }
  }
}

function drawDivider(context: CanvasRenderingContext2D, startX: number, height: number, template: CropMarginTemplate) {
  context.strokeStyle = template.line
  context.lineWidth = Math.max(1, Math.round(height / 900))
  context.setLineDash(template.id === 'note' ? [10, 8] : [])
  context.beginPath()
  context.moveTo(startX + 0.5, 0)
  context.lineTo(startX + 0.5, height)
  context.stroke()
  context.setLineDash([])
}

function drawBadgeImage(
  context: CanvasRenderingContext2D,
  startX: number,
  width: number,
  height: number,
  badgeImage: HTMLImageElement | null,
) {
  if (!badgeImage)
    return

  const size = Math.max(42, Math.min(92, Math.round(width * 0.42), Math.round(height * 0.16)))
  const centerX = startX + width / 2
  const centerY = Math.max(size * 0.9, height * 0.34)
  context.drawImage(badgeImage, centerX - size / 2, centerY - size / 2, size, size)
}

function drawText(
  context: CanvasRenderingContext2D,
  startX: number,
  width: number,
  height: number,
  template: CropMarginTemplate,
) {
  const centerX = startX + width / 2
  const titleSize = Math.max(18, Math.min(34, Math.round(width * 0.15)))
  const subSize = Math.max(12, Math.min(18, Math.round(width * 0.075)))
  const titleY = Math.max(height * 0.54, Math.min(height - 72, height * 0.58))

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = template.text
  context.font = `700 ${titleSize}px "Microsoft YaHei", sans-serif`
  context.fillText('水印裁剪区', centerX, titleY)

  context.fillStyle = template.subtext
  context.font = `500 ${subSize}px "Microsoft YaHei", sans-serif`
  context.fillText(template.id === 'clean' ? '发布后裁掉这里' : template.id === 'note' ? '水印留在这里' : '保留原图完整', centerX, titleY + titleSize * 1.35)
}
