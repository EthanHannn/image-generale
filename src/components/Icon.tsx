export type IconName =
  | 'alert'
  | 'box'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'close'
  | 'editImage'
  | 'history'
  | 'image'
  | 'maximize'
  | 'minimize'
  | 'moon'
  | 'navHistory'
  | 'navCrop'
  | 'navSettings'
  | 'navUpscale'
  | 'navWorkspace'
  | 'palette'
  | 'plug'
  | 'prompt'
  | 'settings'
  | 'spark'
  | 'star'
  | 'starFilled'
  | 'sun'
  | 'themeDark'
  | 'themeLight'
  | 'upscale'
  | 'upload'
  | 'workspace'

type IconProps = {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ name, size = 18, className, strokeWidth = 2 }: IconProps) {
  const commonProps = {
    className,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }

  if (name === 'starFilled') {
    return (
      <svg {...commonProps} fill="currentColor" stroke="currentColor">
        <path d="m12 3.6 2.55 5.16 5.69.83-4.12 4.01.97 5.67L12 16.59l-5.09 2.68.97-5.67-4.12-4.01 5.69-.83L12 3.6Z" />
      </svg>
    )
  }

  return (
    <svg {...commonProps}>
      {renderIconPath(name)}
    </svg>
  )
}

function renderIconPath(name: IconName) {
  switch (name) {
    case 'alert':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6" />
          <path d="M12 17h.01" />
        </>
      )
    case 'box':
      return (
        <>
          <path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" />
          <path d="M4 8.5v7L12 20l8-4.5v-7" />
          <path d="M12 13v7" />
        </>
      )
    case 'check':
      return <path d="m5 12 4 4 10-10" />
    case 'chevronLeft':
      return <path d="m15 18-6-6 6-6" />
    case 'chevronRight':
      return <path d="m9 18 6-6-6-6" />
    case 'close':
      return (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </>
      )
    case 'editImage':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="m7 15 3-3 2 2 2-3 3 4" />
          <path d="M15 6.5 18.5 10" />
          <path d="M18 4.8 19.2 6a1.2 1.2 0 0 1 0 1.7L14.5 12.4 12 13l.6-2.5 4.7-4.7a1.2 1.2 0 0 1 1.7 0Z" />
        </>
      )
    case 'history':
      return (
        <>
          <path d="M4 12a8 8 0 1 0 2.34-5.66" />
          <path d="M4 5v5h5" />
          <path d="M12 8v5l3 2" />
        </>
      )
    case 'image':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m6.5 17 4-4 2.5 2.5 2-2.5 2.5 4" />
        </>
      )
    case 'maximize':
      return <rect x="6" y="6" width="12" height="12" rx="1" />
    case 'minimize':
      return <path d="M6 12h12" />
    case 'moon':
      return <path d="M20 14.2A7.2 7.2 0 0 1 9.8 4 8 8 0 1 0 20 14.2Z" />
    case 'navHistory':
      return (
        <>
          <circle cx="12" cy="12" r="7.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="17.2" cy="7.8" r=".85" fill="currentColor" stroke="none" />
        </>
      )
    case 'navCrop':
      return (
        <>
          <path d="M7 4v13a3 3 0 0 0 3 3h10" />
          <path d="M4 7h10a3 3 0 0 1 3 3v10" />
          <path d="M8.4 8.4 15.6 15.6" />
          <path d="M14.6 8.8 16.2 7l1.6 1.8" />
        </>
      )
    case 'navSettings':
      return (
        <>
          <circle cx="12" cy="12" r="7.2" />
          <path d="M12 5.6v3" />
          <path d="M12 15.4v3" />
          <path d="M5.6 12h3" />
          <path d="M15.4 12h3" />
          <circle cx="12" cy="12" r="1.8" />
        </>
      )
    case 'navUpscale':
      return (
        <>
          <path d="M12 3.9 20.1 12 12 20.1 3.9 12 12 3.9Z" />
          <path d="M12 8.1 15.9 12 12 15.9 8.1 12 12 8.1Z" />
        </>
      )
    case 'navWorkspace':
      return (
        <>
          <path d="M12 3.6 20.4 12 12 20.4 3.6 12 12 3.6Z" />
          <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
        </>
      )
    case 'palette':
      return (
        <>
          <path d="M12 4a8 8 0 0 0 0 16h1.2a2 2 0 0 0 1.4-3.4 1.8 1.8 0 0 1 1.3-3.1H17a3 3 0 0 0 3-3c0-3.6-3.6-6.5-8-6.5Z" />
          <circle cx="8.5" cy="10" r=".7" />
          <circle cx="11.5" cy="8" r=".7" />
          <circle cx="14.5" cy="10" r=".7" />
        </>
      )
    case 'plug':
      return (
        <>
          <path d="M9 7V4" />
          <path d="M15 7V4" />
          <path d="M7 7h10v4a5 5 0 0 1-10 0V7Z" />
          <path d="M12 16v4" />
        </>
      )
    case 'prompt':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="m8 10 3 2-3 2" />
          <path d="M13 15h3" />
        </>
      )
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05-2 3-.07-.02a1.7 1.7 0 0 0-1.87.34 1.7 1.7 0 0 0-.5 1.2V21h-3.5v-.08a1.7 1.7 0 0 0-1.12-1.6 1.7 1.7 0 0 0-1.25.02l-.07.03-2-3 .05-.05A1.7 1.7 0 0 0 7.8 15a1.7 1.7 0 0 0-1.1-.82H6.6v-3.5h.09a1.7 1.7 0 0 0 1.1-.82 1.7 1.7 0 0 0-.34-1.87l-.05-.05 2-3 .07.02a1.7 1.7 0 0 0 1.87-.34 1.7 1.7 0 0 0 .5-1.2V3h3.5v.08a1.7 1.7 0 0 0 1.12 1.6 1.7 1.7 0 0 0 1.25-.02l.07-.03 2 3-.05.05A1.7 1.7 0 0 0 16.2 9c.22.43.62.73 1.1.82h.1v3.5h-.09a1.7 1.7 0 0 0-1.1.82Z" />
        </>
      )
    case 'spark':
      return (
        <>
          <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3Z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
        </>
      )
    case 'star':
      return <path d="m12 3.6 2.55 5.16 5.69.83-4.12 4.01.97 5.67L12 16.59l-5.09 2.68.97-5.67-4.12-4.01 5.69-.83L12 3.6Z" />
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </>
      )
    case 'themeDark':
      return (
        <>
          <path d="M18.8 14.1A6.8 6.8 0 0 1 9.9 5.2 7.4 7.4 0 1 0 18.8 14.1Z" />
          <circle cx="16.8" cy="7.4" r=".85" fill="currentColor" stroke="none" />
        </>
      )
    case 'themeLight':
      return (
        <>
          <circle cx="12" cy="12" r="5.4" />
          <path d="M12 3.8v2" />
          <path d="M12 18.2v2" />
          <path d="M3.8 12h2" />
          <path d="M18.2 12h2" />
        </>
      )
    case 'upscale':
      return (
        <>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 15 15 9" />
          <path d="M10 9h5v5" />
        </>
      )
    case 'upload':
      return (
        <>
          <path d="M12 16V5" />
          <path d="m7 10 5-5 5 5" />
          <path d="M5 19h14" />
        </>
      )
    case 'workspace':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
          <path d="M15 13l2 2 3-4" />
        </>
      )
    default:
      return null
  }
}
