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
  | 'themeSystem'
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
          <path d="M18.7 8.2A7.6 7.6 0 1 0 19 14" />
          <path d="M5.5 7.9 4.2 11l3.2.5" />
          <path d="M12 8.1v4.2l3 1.8" />
          <circle cx="17.8" cy="7" r=".9" fill="currentColor" stroke="none" />
        </>
      )
    case 'navCrop':
      return (
        <>
          <path d="M7 3.8v12.4a2.8 2.8 0 0 0 2.8 2.8h10.4" />
          <path d="M3.8 7h12.4A2.8 2.8 0 0 1 19 9.8v10.4" />
          <path d="M9.4 9.4h5.2v5.2H9.4z" />
          <path d="M4.8 4.8h2.2M17 19.2h2.2" />
        </>
      )
    case 'navSettings':
      return (
        <>
          <path d="m12 3.8 6.5 3.8v8.8L12 20.2l-6.5-3.8V7.6L12 3.8Z" />
          <path d="m12 8.3 3.3 3.7-3.3 3.7-3.3-3.7L12 8.3Z" />
          <path d="M12 3.8v2.5M18.5 7.6l-2.2 1.3M18.5 16.4l-2.2-1.3M12 20.2v-2.5M5.5 16.4l2.2-1.3M5.5 7.6l2.2 1.3" />
        </>
      )
    case 'navUpscale':
      return (
        <>
          <path d="m12 3.5 7.8 4.5v8L12 20.5 4.2 16V8L12 3.5Z" />
          <path d="m12 7.2 4.5 2.6v4.4L12 16.8l-4.5-2.6V9.8L12 7.2Z" />
          <path d="m12 10.2 1.8 1.8-1.8 1.8-1.8-1.8 1.8-1.8Z" />
          <path d="M4.2 8 2.8 9.4M19.8 8l1.4 1.4M4.2 16l-1.4-1.4M19.8 16l1.4-1.4" />
        </>
      )
    case 'navWorkspace':
      return (
        <>
          <path d="M6.2 4.4h11.6l1.8 1.8v11.6l-1.8 1.8H6.2l-1.8-1.8V6.2l1.8-1.8Z" />
          <path d="M8.1 8.1h2.3M13.6 8.1h2.3M8.1 15.9h2.3M13.6 15.9h2.3" />
          <path d="m12 9.2.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9.9-1.9Z" />
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
          <path d="M18.9 15.1A7.3 7.3 0 0 1 9.2 5.3 7.7 7.7 0 1 0 18.9 15.1Z" />
          <path d="m15.8 4.5.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z" />
        </>
      )
    case 'themeLight':
      return (
        <>
          <path d="m12 6.7 5.3 5.3-5.3 5.3L6.7 12 12 6.7Z" />
          <path d="M12 3.5v2.1M12 18.4v2.1M3.5 12h2.1M18.4 12h2.1" />
          <path d="m6 6 1.5 1.5m9 9L18 18m0-12-1.5 1.5M7.5 16.5 6 18" />
        </>
      )
    case 'themeSystem':
      return (
        <>
          <circle cx="12" cy="12" r="7.7" />
          <path d="M12 4.3v15.4" />
          <path d="m8.7 8.7 3.3 3.3-3.3 3.3" />
          <path d="m15.3 8.7-3.3 3.3 3.3 3.3" />
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
