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
const MAX_CANVAS_SIDE = 32767
const MAX_CANVAS_AREA = 268_000_000
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
  validateCanvasSize(outputWidth, outputHeight)
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight

  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('当前环境无法创建画布')

  context.imageSmoothingEnabled = true
  context.clearRect(0, 0, outputWidth, outputHeight)
  context.drawImage(image, 0, 0, options.sourceWidth, options.sourceHeight)
  drawMarginArea(context, options.sourceWidth, marginWidth, outputHeight, options.template, badgeImage)

  const blob = await canvasToBlob(canvas)
  const base64 = await blobToBase64(blob)
  return { base64, marginWidth, outputWidth, outputHeight }
}

function validateCanvasSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('图片尺寸无效，无法生成水印裁剪区')

  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE)
    throw new Error(`图片尺寸过大，当前输出 ${width} × ${height}px 超出画布边长限制，请先缩小图片后再处理`)

  if (width * height > MAX_CANVAS_AREA)
    throw new Error(`图片尺寸过大，当前输出 ${width} × ${height}px 超出画布面积限制，请先缩小图片后再处理`)
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
        reject(new Error('图片导出失败，可能是输出尺寸过大或当前环境不支持该画布尺寸'))
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

  const size = getBadgeSize(width, height)
  const centerX = startX + width / 2
  const centerY = getBadgeCenterY(width, height)
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
  const titleY = getTitleY(width, height)
  const titleSize = getTitleSize(width)
  const subSize = getSubSize(width)

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = template.text
  context.font = `700 ${titleSize}px "Microsoft YaHei", sans-serif`
  context.fillText('水印裁剪区', centerX, titleY)

  context.fillStyle = template.subtext
  context.font = `500 ${subSize}px "Microsoft YaHei", sans-serif`
  context.fillText(template.id === 'clean' ? '发布后裁掉这里' : template.id === 'note' ? '水印留在这里' : '保留原图完整', centerX, titleY + titleSize * 1.2)
}

function getBadgeSize(width: number, height: number) {
  return Math.max(44, Math.min(96, Math.round(width * 0.44), Math.round(height * 0.17)))
}

function getTitleSize(width: number) {
  return Math.max(18, Math.min(34, Math.round(width * 0.15)))
}

function getSubSize(width: number) {
  return Math.max(12, Math.min(18, Math.round(width * 0.075)))
}

function getBadgeCenterY(width: number, height: number) {
  const size = getBadgeSize(width, height)
  const titleSize = getTitleSize(width)
  return getTitleY(width, height) - size / 2 - titleSize * 0.9
}

function getTitleY(width: number, height: number) {
  const size = getBadgeSize(width, height)
  const titleSize = getTitleSize(width)
  const subSize = getSubSize(width)
  const centeredTitleY = height / 2 + size / 2 - titleSize * 0.15 - subSize * 0.25
  const minTitleY = size + titleSize * 0.9
  const maxTitleY = height - titleSize * 1.2 - subSize / 2
  return Math.min(Math.max(centeredTitleY, minTitleY), maxTitleY)
}
