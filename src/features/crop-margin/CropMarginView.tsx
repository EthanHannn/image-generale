import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Icon } from '../../components/Icon'
import { saveImageFile } from '../../lib/files'
import { blobToBase64, formatSize, sanitizeFilename } from '../../lib/utils'
import { cropMarginTemplates, cropMarginWidthOptions, getCropMarginTemplate, getCropMarginWidthOption } from './cropMarginTemplates'
import { getCropMarginWidth, renderCropMarginImage } from './cropMarginRenderer'
import type { CropMarginIncomingImage, CropMarginOutput, CropMarginSource, CropMarginTemplateId, CropMarginWidthLevel } from './types'

type CropMarginViewProps = {
  onShowToast: (message: string, type: 'success' | 'error') => void
  incomingImages: CropMarginIncomingImage[]
  incomingVersion: number
}

type RenderState =
  | { status: 'idle'; output: null; message: string }
  | { status: 'loading'; output: null; message: string }
  | { status: 'ready'; output: CropMarginOutput; message: string }
  | { status: 'error'; output: null; message: string }

export function CropMarginView({ onShowToast, incomingImages, incomingVersion }: CropMarginViewProps) {
  const incomingVersionRef = useRef(0)
  const [sources, setSources] = useState<CropMarginSource[]>([])
  const [activeId, setActiveId] = useState('')
  const [templateId, setTemplateId] = useState<CropMarginTemplateId>('clean')
  const [widthLevel, setWidthLevel] = useState<CropMarginWidthLevel>('medium')
  const [renderState, setRenderState] = useState<RenderState>({ status: 'idle', output: null, message: '上传图片后生成预览' })
  const activeSource = sources.find(source => source.id === activeId) || sources[0] || null
  const template = getCropMarginTemplate(templateId)
  const widthOption = getCropMarginWidthOption(widthLevel)
  const expectedMarginWidth = activeSource ? getCropMarginWidth(activeSource.width, widthOption.ratio) : 0
  const outputUrl = renderState.output ? `data:image/png;base64,${renderState.output.base64}` : ''
  const sourceUrl = activeSource ? `data:${activeSource.mimeType || 'image/png'};base64,${activeSource.base64}` : ''
  const templateName = useMemo(() => template.name, [template.name])

  useEffect(() => {
    if (!activeSource) {
      setRenderState({ status: 'idle', output: null, message: '上传图片后生成预览' })
      return
    }

    let cancelled = false
    setRenderState({ status: 'loading', output: null, message: '正在生成水印裁剪区预览' })
    void renderCropMarginImage({
      sourceDataUrl: sourceUrl,
      sourceWidth: activeSource.width,
      sourceHeight: activeSource.height,
      marginRatio: widthOption.ratio,
      template,
    }).then((output) => {
      if (!cancelled)
        setRenderState({ status: 'ready', output, message: '预览已生成' })
    }).catch((error) => {
      if (!cancelled)
        setRenderState({ status: 'error', output: null, message: error instanceof Error ? error.message : '图片处理失败' })
    })

    return () => {
      cancelled = true
    }
  }, [activeSource, sourceUrl, template, widthOption.ratio])

  useEffect(() => {
    if (!incomingVersion || incomingVersionRef.current === incomingVersion || !incomingImages.length)
      return

    incomingVersionRef.current = incomingVersion
    const nextSources = incomingImages.map(image => ({
      ...image,
      id: image.id || makeSourceId(),
    }))
    setSources(current => [...nextSources, ...current])
    setActiveId(nextSources[0]?.id || '')
  }, [incomingImages, incomingVersion])

  useEffect(() => {
    function handleExternalFiles(event: Event) {
      const detail = (event as CustomEvent<{ files?: File[] }>).detail
      void acceptFiles(detail?.files || [])
    }

    window.addEventListener('crop-margin:files', handleExternalFiles)
    return () => window.removeEventListener('crop-margin:files', handleExternalFiles)
  }, [])

  async function acceptFiles(files: File[]) {
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    if (!imageFiles.length) {
      onShowToast('请上传图片文件', 'error')
      return
    }

    try {
      const nextSources = await Promise.all(imageFiles.map(readCropMarginSource))
      setSources(current => [...nextSources, ...current])
      setActiveId(nextSources[0]?.id || '')
      onShowToast(`已载入 ${nextSources.length} 张图片`, 'success')
    }
    catch (error) {
      onShowToast(`读取图片失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    void acceptFiles(files)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    void acceptFiles(Array.from(event.dataTransfer.files || []))
  }

  function removeSource(sourceId: string) {
    const sourceIndex = sources.findIndex(source => source.id === sourceId)
    if (sourceIndex < 0)
      return

    const nextSources = sources.filter(source => source.id !== sourceId)
    setSources(nextSources)

    if (activeSource?.id === sourceId) {
      const nextActive = nextSources[Math.min(sourceIndex, nextSources.length - 1)] || null
      setActiveId(nextActive?.id || '')
    }
  }

  async function handleDownload() {
    if (!activeSource || !renderState.output) {
      onShowToast('暂无可下载图片', 'error')
      return
    }

    const filename = `watermark_crop_margin_${sanitizeFilename(activeSource.fileName)}_${templateId}_${makeTimestamp()}.png`
    try {
      const result = await saveImageFile({ imageBase64: renderState.output.base64, filename, mimeType: 'image/png' })
      if (result.status === 'cancelled')
        return

      onShowToast(`图片已保存：${getSavedFileLabel(result.path, filename)}`, 'success')
    }
    catch (error) {
      onShowToast(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }
  }

  return (
    <div className="crop-margin-layout">
      <section className="panel crop-margin-control-panel">
        <div className="panel-heading compact">
          <div>
            <h2>图片上传</h2>
            <div className="panel-caption">右侧新增水印裁剪区，原图主体按原始像素保留。</div>
          </div>
        </div>

        <label
          className={`crop-margin-dropzone ${activeSource ? 'has-file' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDrop={handleDrop}
        >
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleFileInput} />
          <span className="crop-margin-dropzone-icon"><Icon name="upload" size={24} /></span>
          <strong>{activeSource ? activeSource.fileName : '点击或拖入图片'}</strong>
          <span>{activeSource ? `${formatSize(activeSource.fileSize)} · ${activeSource.width} × ${activeSource.height}px` : '支持 PNG、JPG、WEBP，可多选'}</span>
        </label>

        <div className="crop-margin-section">
          <div className="crop-margin-section-head">
            <span>模板</span>
            <small>{templateName}</small>
          </div>
          <div className="crop-template-grid">
            {cropMarginTemplates.map(item => (
              <button
                key={item.id}
                type="button"
                className={`crop-template-card ${templateId === item.id ? 'active' : ''}`}
                onClick={() => setTemplateId(item.id)}
              >
                <span className={`crop-template-swatch ${item.id}`} />
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="crop-margin-section">
          <div className="crop-margin-section-head">
            <span>水印裁剪区宽度</span>
            <small>{activeSource ? `${expectedMarginWidth}px` : '等待图片尺寸'}</small>
          </div>
          <div className="crop-width-row">
            {cropMarginWidthOptions.map(item => (
              <button
                key={item.id}
                type="button"
                className={`chip ${widthLevel === item.id ? 'active' : ''}`}
                onClick={() => setWidthLevel(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="crop-width-hint">{widthOption.summary}，按原图宽度比例计算并限制在 160-640px。</div>
        </div>

        {sources.length
          ? (
              <div className="crop-margin-section">
                <div className="crop-margin-section-head">
                  <span>当前队列</span>
                  <small>{sources.length} 张</small>
                </div>
                <div className="crop-source-list">
                  {sources.map(source => (
                    <div key={source.id} className={`crop-source-item ${activeSource?.id === source.id ? 'active' : ''}`}>
                      <button type="button" className="crop-source-select" onClick={() => setActiveId(source.id)}>
                        <span>{source.fileName}</span>
                        <small>{source.width} × {source.height}px</small>
                      </button>
                      <button
                        type="button"
                        className="crop-source-remove"
                        title="从队列移除"
                        aria-label={`从队列移除 ${source.fileName}`}
                        onClick={() => removeSource(source.id)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          : null}
      </section>

      <section className="panel crop-margin-preview-panel">
        <div className="panel-heading compact">
          <div>
            <h2>输出预览</h2>
            <div className="panel-caption">{activeSource ? renderState.message : '上传后在这里查看扩边结果。'}</div>
          </div>
          <button className="dl-btn" type="button" disabled={!renderState.output} onClick={() => void handleDownload()}>
            下载图片
          </button>
        </div>

        {activeSource
          ? (
              <div className="crop-quality-strip">
                <div>
                  <span>原图主体</span>
                  <strong>{activeSource.width} × {activeSource.height}px</strong>
                </div>
                <div>
                  <span>新增水印裁剪区</span>
                  <strong>{renderState.output?.marginWidth || expectedMarginWidth}px</strong>
                </div>
                <div>
                  <span>输出尺寸</span>
                  <strong>{renderState.output ? `${renderState.output.outputWidth} × ${renderState.output.outputHeight}px` : '-'}</strong>
                </div>
              </div>
            )
          : null}

        <div className="crop-preview-stage">
          {renderState.status === 'loading'
            ? (
                <div className="standalone-preview-empty">
                  <span className="spinner" />
                  <strong>正在生成预览</strong>
                  <span>原图不缩放，只在右侧新增水印裁剪区。</span>
                </div>
              )
            : null}

          {renderState.status === 'error'
            ? (
                <div className="standalone-preview-empty">
                  <strong>处理失败</strong>
                  <span>{renderState.message}</span>
                </div>
              )
            : null}

          {outputUrl
            ? (
                <div className="crop-preview-frame">
                  <img src={outputUrl} alt="水印裁剪区输出预览" />
                </div>
              )
            : null}

          {!activeSource && renderState.status === 'idle'
            ? (
                <div className="standalone-preview-empty">
                  <span className="crop-empty-icon"><Icon name="image" size={34} /></span>
                  <strong>等待图片</strong>
                  <span>图片只在本次裁剪台会话中处理，不写入历史记录。</span>
                </div>
              )
            : null}
        </div>
      </section>
    </div>
  )
}

async function readCropMarginSource(file: File): Promise<CropMarginSource> {
  const [base64, dimensions] = await Promise.all([blobToBase64(file), readImageDimensions(file)])
  return {
    id: makeSourceId(),
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'image/png',
    base64,
    width: dimensions.width,
    height: dimensions.height,
  }
}

function makeSourceId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function readImageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片尺寸读取失败'))
    }
    image.src = url
  })
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function getSavedFileLabel(path: string | undefined, fallback: string) {
  if (!path)
    return fallback
  return path.split(/[\\/]/).pop() || fallback
}
