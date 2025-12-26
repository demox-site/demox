# 网站设计风格指南 (Style Guide)

本文档基于首页 Landing 页面（`index.tsx`）总结，旨在为整个网站提供统一的视觉风格指导。

## 1. 核心设计理念 (Core Design Philosophy)

- **极简暗黑风 (Minimalist Dark Mode)**: 采用深色背景搭配高对比度文字，营造专业、沉浸式的开发者氛围。
- **技术感 (Technical Aesthetic)**: 大量使用等宽字体 (Monospace)、终端模拟窗口、网格背景和发光效果。
- **微交互 (Micro-interactions)**: 细腻的悬停效果、平滑过渡和微妙的动画，提升用户体验。

## 2. 颜色系统 (Color System)

主要基于 Tailwind CSS 的 `zinc` 色系。

### 背景色 (Backgrounds)

- **主背景**: `bg-black` (#000000) - 页面主体。
- **次级背景**: `bg-zinc-950` -用于区分不同板块或卡片背景。
- **组件背景**: `bg-zinc-900` - 用于输入框、次级按钮或装饰元素。
- **半透明背景**: `bg-black/50` + `backdrop-blur-md` - 用于导航栏，产生毛玻璃效果。

### 文字颜色 (Typography Colors)

- **主要文字**: `text-zinc-100` 或 `text-white` - 标题、高亮内容。
- **次要文字**: `text-zinc-400` - 正文、副标题、说明文字。
- **辅助/微弱文字**: `text-zinc-500` - 页脚链接、元数据。
- **代码/终端文字**: `text-green-400` (成功), `text-blue-400` (链接/命令), `text-zinc-300` (普通输出).

### 边框与分割线 (Borders & Dividers)

- **默认边框**: `border-zinc-800` - 较明显的边框（如按钮、卡片）。
- **弱边框**: `border-zinc-900` - 较隐晦的分割线。

## 3. 排版 (Typography)

- **字体家族**:
  - 默认: `font-sans` (系统无衬线字体) - 用于绝大多数界面文本。
  - 代码/技术: `font-mono` - 用于版本号、终端命令、代码片段。
- **标题 (Headings)**:
  - Hero 标题: `text-5xl md:text-7xl font-bold tracking-tight`。
  - 板块标题: `text-3xl md:text-4xl font-bold`。
- **正文 (Body)**:
  - 默认大小: `text-base` 或 `text-sm`。
  - Hero 副标题: `text-lg md:text-xl leading-relaxed`。

## 4. UI 组件样式 (Component Styles)

### 按钮 (Buttons)

1.  **主按钮 (Primary Action)**:

    - 背景: `bg-zinc-100` (白底).
    - 文字: `text-black` (黑字).
    - 形状: `rounded-md`.
    - 交互: `hover:-translate-y-1` (上浮), `shadow-[0_0_15px_rgba(255,255,255,0.1)]` (发光阴影).

    ```tsx
    <button className="bg-zinc-100 text-black font-semibold rounded-md hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]">
      Button Text
    </button>
    ```

2.  **次级按钮 (Secondary Action)**:

    - 背景: 透明或 `bg-zinc-900` (在某些 CTA 中).
    - 边框: `border border-zinc-800`.
    - 文字: `text-zinc-300`.
    - 交互: `hover:border-zinc-600 hover:text-zinc-100`.

    ```tsx
    <button className="border border-zinc-800 text-zinc-300 rounded-md hover:border-zinc-600 hover:text-zinc-100 transition-colors">
      Button Text
    </button>
    ```

### 卡片 (Cards)

- **容器**: `border border-zinc-900 bg-zinc-950/50 rounded-lg`.
- **交互**: `hover:border-zinc-700 transition-colors`.
- **图标**: 通常包含在一个 `bg-zinc-900` 的容器中，悬停时有 `group-hover:scale-110` 缩放效果。

### 导航栏 (Navbar)

- 固定顶部: `fixed top-0 left-0 right-0 z-50`.
- 样式: `border-b border-zinc-800 bg-black/50 backdrop-blur-md`.

## 5. 视觉特效 (Visual Effects)

- **渐变文字**: `bg-clip-text text-transparent bg-gradient-to-b from-zinc-100 to-zinc-500` - 用于超大标题。
- **网格背景**: 使用 CSS 线性渐变创建方格背景图案，增加空间感。
- **光晕 (Glow)**: 使用 `shadow` 或绝对定位的 `bg-gradient` div 来模拟光晕效果。
- **动画**:
  - `animate-pulse`: 用于光标、状态指示点。
  - `transition-all duration-300`: 通用的过渡效果。

## 6. 图标 (Iconography)

- 使用 **Lucide React** 图标库。
- 大小通常为 `size={16}` (小), `size={24}` (中), `size={32}` (大)。
- 颜色通常跟随文本颜色或使用 `text-zinc-100`。
