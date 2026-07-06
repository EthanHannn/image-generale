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

export function getCropMarginWidth(sourceWidth: number, ratio: number) {
  return Math.min(MAX_MARGIN_WIDTH, Math.max(MIN_MARGIN_WIDTH, Math.round(sourceWidth * ratio)))
}

export async function renderCropMarginImage(options: RenderCropMarginOptions): Promise<CropMarginOutput> {
  const image = await loadImage(options.sourceDataUrl)
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
  drawMarginArea(context, options.sourceWidth, marginWidth, outputHeight, options.template)

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
) {
  context.save()
  context.fillStyle = template.background
  context.fillRect(startX, 0, width, height)
  drawPattern(context, startX, width, height, template)
  drawDivider(context, startX, height, template)
  drawCatBadge(context, startX, width, height, template)
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

function drawCatBadge(
  context: CanvasRenderingContext2D,
  startX: number,
  width: number,
  height: number,
  template: CropMarginTemplate,
) {
  const size = Math.max(42, Math.min(92, Math.round(width * 0.42), Math.round(height * 0.16)))
  const centerX = startX + width / 2
  const centerY = Math.max(size * 0.9, height * 0.34)
  const radius = size * 0.34

  context.save()
  if (template.id === 'grid') {
    context.fillStyle = 'rgba(255, 255, 255, 0.78)'
    roundRect(context, centerX - size * 0.54, centerY - size * 0.52, size * 1.08, size * 1.08, size * 0.18)
    context.fill()
  }

  context.strokeStyle = template.text
  context.fillStyle = template.accent
  context.lineWidth = Math.max(2, Math.round(size / 28))
  context.lineCap = 'round'
  context.lineJoin = 'round'

  context.beginPath()
  context.moveTo(centerX - radius * 0.7, centerY - radius * 0.62)
  context.lineTo(centerX - radius * 0.24, centerY - radius * 1.18)
  context.lineTo(centerX - radius * 0.02, centerY - radius * 0.7)
  context.lineTo(centerX + radius * 0.02, centerY - radius * 0.7)
  context.lineTo(centerX + radius * 0.24, centerY - radius * 1.18)
  context.lineTo(centerX + radius * 0.7, centerY - radius * 0.62)
  context.quadraticCurveTo(centerX + radius, centerY - radius * 0.18, centerX + radius, centerY + radius * 0.22)
  context.quadraticCurveTo(centerX + radius, centerY + radius, centerX, centerY + radius)
  context.quadraticCurveTo(centerX - radius, centerY + radius, centerX - radius, centerY + radius * 0.22)
  context.quadraticCurveTo(centerX - radius, centerY - radius * 0.18, centerX - radius * 0.7, centerY - radius * 0.62)
  context.stroke()

  context.beginPath()
  context.arc(centerX - radius * 0.32, centerY + radius * 0.05, radius * 0.06, 0, Math.PI * 2)
  context.arc(centerX + radius * 0.32, centerY + radius * 0.05, radius * 0.06, 0, Math.PI * 2)
  context.fill()

  context.beginPath()
  context.moveTo(centerX, centerY + radius * 0.18)
  context.lineTo(centerX, centerY + radius * 0.32)
  context.stroke()

  drawWhisker(context, centerX - radius * 0.2, centerY + radius * 0.26, -1, radius)
  drawWhisker(context, centerX + radius * 0.2, centerY + radius * 0.26, 1, radius)
  context.restore()
}

function drawWhisker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: -1 | 1,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(x + direction * radius * 0.52, y - radius * 0.12)
  context.moveTo(x, y + radius * 0.16)
  context.lineTo(x + direction * radius * 0.56, y + radius * 0.18)
  context.stroke()
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
  context.fillText('裁剪区', centerX, titleY)

  context.fillStyle = template.subtext
  context.font = `500 ${subSize}px "Microsoft YaHei", sans-serif`
  context.fillText(template.id === 'clean' ? '发布后裁掉这里' : template.id === 'note' ? '水印留在这里' : '保留原图完整', centerX, titleY + titleSize * 1.35)
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}
