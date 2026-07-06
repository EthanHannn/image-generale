import type { CropMarginTemplateId, CropMarginWidthLevel } from './types'

export type CropMarginTemplate = {
  id: CropMarginTemplateId
  name: string
  summary: string
  background: string
  line: string
  text: string
  subtext: string
  accent: string
  pattern: 'plain' | 'dots' | 'grid'
}

export type CropMarginWidthOption = {
  id: CropMarginWidthLevel
  name: string
  ratio: number
  summary: string
}

export const cropMarginTemplates: CropMarginTemplate[] = [
  {
    id: 'clean',
    name: '清爽白边',
    summary: '白底、细分割线、简约小猫标记',
    background: '#ffffff',
    line: '#d4d8e1',
    text: '#3f4656',
    subtext: '#8b93a5',
    accent: '#f59e0b',
    pattern: 'plain',
  },
  {
    id: 'note',
    name: '便签软糖',
    summary: '暖色底、虚线分割线、轻提示文案',
    background: '#fff4f4',
    line: '#f3a6b6',
    text: '#7c3f4f',
    subtext: '#b66a7d',
    accent: '#f97316',
    pattern: 'dots',
  },
  {
    id: 'grid',
    name: '方格贴纸',
    summary: '灰白方格、徽标感猫头、实线边界',
    background: '#f8fafc',
    line: '#cbd5e1',
    text: '#334155',
    subtext: '#64748b',
    accent: '#22c55e',
    pattern: 'grid',
  },
]

export const cropMarginWidthOptions: CropMarginWidthOption[] = [
  { id: 'small', name: '窄边', ratio: 0.08, summary: '适合轻量留白' },
  { id: 'medium', name: '标准', ratio: 0.12, summary: '常用水印避让' },
  { id: 'large', name: '宽边', ratio: 0.16, summary: '适合平台水印偏内侧' },
]

export function getCropMarginTemplate(id: CropMarginTemplateId) {
  return cropMarginTemplates.find(template => template.id === id) || cropMarginTemplates[0]
}

export function getCropMarginWidthOption(id: CropMarginWidthLevel) {
  return cropMarginWidthOptions.find(option => option.id === id) || cropMarginWidthOptions[1]
}
