---
name: ai-builder-ui
description: AI Builder 项目前端设计规范。用于创建页面、组件或界面时，确保与项目深色科技风格保持视觉一致性。包含色彩系统、组件样式、布局规范、交互动效和国际化模式。
---

## Core Design Principles

**Design System Checklist** (必读)
```tsx
✅ Background: bg-black or bg-zinc-950/50
✅ Primary Text: text-zinc-100
✅ Secondary Text: text-zinc-400 / text-zinc-500
✅ Border: border-zinc-800 / border-zinc-900
✅ Primary Button: bg-zinc-100 text-black (high contrast)
✅ Layout: max-w-7xl mx-auto, wrapped with MainLayout
✅ Icons: lucide-react only
✅ i18n: translations object with zh/en
```

## Quick Reference

| Element | Tailwind Class |
|---------|----------------|
| Page Background | `bg-black` |
| Card | `bg-zinc-950/50 border-zinc-900 backdrop-blur-sm` |
| Primary Button | `bg-zinc-100 text-black hover:bg-zinc-200` |
| Secondary Button | `border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900` |
| Input | `bg-zinc-900 border-zinc-700 text-zinc-100` |
| Title | `text-zinc-100` |
| Body Text | `text-zinc-400` / `text-zinc-500` |
| Hover Lift | `hover:-translate-y-1 transition-transform duration-300` |

## Color System

### Background Colors
```tsx
// Page background
bg-black

// Card background
bg-zinc-950/50 backdrop-blur-sm

// Component background
bg-zinc-900 / bg-zinc-900/50

// Input
bg-zinc-900 border-zinc-700
```

### Text Colors
```tsx
// Primary text
text-zinc-100

// Body text
text-zinc-300 / text-zinc-400

// Secondary text
text-zinc-500

// Placeholder
placeholder:text-zinc-600
```

### Border Colors
```tsx
// Standard border
border-zinc-800

// Secondary border
border-zinc-900

// Hover border
hover:border-zinc-600
```

### Status Colors
```tsx
// Success
bg-green-500/10 text-green-500 border-green-500/20

// Processing
bg-blue-500/10 text-blue-500 border-blue-500/20

// Error/Danger
bg-red-500/10 text-red-500 border-red-500/20

// Warning
bg-yellow-500/10 text-yellow-500 border-yellow-500/20
```

## Component Patterns

### Primary Button
```tsx
<button className="px-8 py-3 bg-zinc-100 text-black font-semibold rounded-md hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]">
  Button Text
</button>
```

### Secondary Button
```tsx
<Button variant="outline" className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100">
  Button Text
</Button>
```

### Danger Button
```tsx
<Button className="bg-red-900/30 text-red-500 border border-red-900 hover:bg-red-900/50">
  Delete
</Button>
```

### Card
```tsx
<Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm overflow-hidden relative group">
  <div className="absolute inset-0 bg-gradient-to-r from-zinc-900/20 to-transparent pointer-events-none" />
  <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
    <CardTitle className="text-zinc-100 flex items-center gap-2">
      <Icon className="w-5 h-5 text-zinc-400" />
      Card Title
    </CardTitle>
  </CardHeader>
  <CardContent className="p-8">
    {/* Content */}
  </CardContent>
</Card>
```

### Input
```tsx
<Input
  className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
  placeholder="Placeholder text"
/>
```

### Dialog
```tsx
<DialogContent className="sm:max-w-[425px] bg-black border border-zinc-800 text-zinc-100">
  <DialogHeader>
    <DialogTitle className="text-zinc-100">Title</DialogTitle>
    <DialogDescription className="text-zinc-400">Description</DialogDescription>
  </DialogHeader>
</DialogContent>
```

## Page Structure

### Basic Page Template
```tsx
import { MainLayout } from "@/layouts/MainLayout";

export default function MyPage() {
  return (
    <MainLayout>
      <div className="relative z-10">
        {/* Page Title */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Page Title
          </h1>
          <p className="text-sm text-zinc-500 mt-2">Page description</p>
        </div>

        {/* Main Content */}
        <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
          {/* ... */}
        </Card>

        {/* Background decoration (optional) */}
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10 pointer-events-none" />
      </div>
    </MainLayout>
  );
}
```

### Container Widths
```tsx
// Main container
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

// Narrow container (text content)
<div className="max-w-4xl mx-auto">

// Form container
<div className="max-w-2xl mx-auto">
```

## Animation Effects

```tsx
// Hover lift
className="hover:-translate-y-1 transition-transform duration-300"

// Glow effect
className="shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"

// Scale effect
className="group-hover:scale-110 transition-transform duration-300"

// Fade in/out
className="opacity-0 group-hover:opacity-100 transition-opacity"

// Pulse
className="animate-pulse"

// Spin
className="animate-spin"
```

## Internationalization Pattern

```tsx
import { useLanguage } from "@/hooks/use-language";

const translations = {
  zh: {
    pageTitle: "页面标题",
    description: "描述文字",
    buttonText: "按钮文字"
  },
  en: {
    pageTitle: "Page Title",
    description: "Description text",
    buttonText: "Button Text"
  }
};

export default function MyPage() {
  const { language: lang } = useLanguage();
  const t = translations[lang];

  return (
    <MainLayout>
      <h1>{t.pageTitle}</h1>
      <p>{t.description}</p>
      <Button>{t.buttonText}</Button>
    </MainLayout>
  );
}
```

## Icons

**Always use lucide-react:**
```tsx
import {
  Upload, Globe, Trash2, ExternalLink, Plus, User,
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw,
  Pencil, Tag, Check, X, Settings, LayoutDashboard
} from "lucide-react";

// Icon sizes
// Small: className="w-3 h-3" or size={14}
// Default: className="w-4 h-4" or size={16}
// Medium: className="w-5 h-5" or size={20}
// Large: className="w-8 h-8" or size={32}
```

## Anti-Patterns

### ❌ DO NOT USE
```tsx
// ❌ Light background
className="bg-white"
className="bg-gray-100"

// ❌ Purple gradient (generic AI style)
className="bg-gradient-to-r from-violet-600 to-purple-600"

// ❌ Emoji as icons
<span>🚀</span>
<button>⭐ Favorite</button>
```

### ✅ USE INSTEAD
```tsx
// ✅ Dark background
className="bg-black"
className="bg-zinc-950/50"

// ✅ High contrast button
className="bg-zinc-100 text-black"

// ✅ lucide-react icons
<Upload className="w-4 h-4" />
<Star className="w-4 h-4" />
```

## Self-Check Before Submit

- [ ] Page wrapped with `<MainLayout>`
- [ ] Dark background (black/zinc-950)
- [ ] No light background (white/gray-100)
- [ ] Primary button uses `bg-zinc-100 text-black`
- [ ] Icons from lucide-react
- [ ] Contains translations object (zh/en)
- [ ] Container uses `max-w-7xl mx-auto` pattern
