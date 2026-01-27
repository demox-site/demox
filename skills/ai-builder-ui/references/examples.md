# AI Builder UI Component Examples

## Table of Contents
1. [Common Patterns](#common-patterns)
2. [Form Components](#form-components)
3. [Data Display](#data-display)
4. [Status Indicators](#status-indicators)

---

## Common Patterns

### Header with Actions
```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h2 className="text-2xl font-bold text-zinc-100">Page Title</h2>
    <p className="text-zinc-500 text-sm mt-1">Description</p>
  </div>
  <div className="flex gap-2">
    <Button
      className="bg-zinc-100 text-black hover:bg-zinc-200"
    >
      <Plus className="w-4 h-4 mr-2" />
      Action
    </Button>
  </div>
</div>
```

### Empty State
```tsx
<div className="flex flex-col items-center justify-center py-16">
  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-4">
    <Inbox className="w-8 h-8 text-zinc-500" />
  </div>
  <h3 className="text-lg font-semibold text-zinc-100 mb-2">Empty Title</h3>
  <p className="text-zinc-400 text-sm mb-6">Empty description</p>
  <Button className="bg-zinc-100 text-black">
    Action
  </Button>
</div>
```

---

## Form Components

### Form Card
```tsx
<Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm">
  <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
    <CardTitle className="text-zinc-100">Form Title</CardTitle>
  </CardHeader>
  <CardContent className="p-8">
    <form className="space-y-6 max-w-2xl mx-auto">
      {/* Form fields */}
    </form>
  </CardContent>
</Card>
```

### Input Group
```tsx
<div className="space-y-2">
  <label className="text-sm font-medium text-zinc-300">
    Label
  </label>
  <Input
    className="bg-zinc-900 border-zinc-700 text-zinc-100 focus:border-zinc-500 placeholder:text-zinc-600"
    placeholder="Placeholder"
  />
  <p className="text-xs text-zinc-500">Helper text</p>
</div>
```

### Select
```tsx
<Select>
  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100">
    <SelectValue placeholder="Select option" />
  </SelectTrigger>
  <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

### Checkbox Group
```tsx
<div className="space-y-3">
  <label className="flex items-center space-x-3 cursor-pointer group">
    <Checkbox className="border-zinc-700 data-[state=checked]:bg-zinc-100 data-[state=checked]:border-zinc-100 data-[state=checked]:text-black" />
    <span className="text-zinc-300 group-hover:text-zinc-100 transition-colors">
      Option label
    </span>
  </label>
</div>
```

---

## Data Display

### Table with Status
```tsx
<div className="rounded-md border border-zinc-900 bg-zinc-950/50">
  <table className="w-full">
    <thead>
      <tr className="border-b border-zinc-900 bg-zinc-900/30">
        <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">
          Column
        </th>
        <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">
          Status
        </th>
      </tr>
    </thead>
    <tbody>
      <tr className="border-b border-zinc-900/50 hover:bg-zinc-900/20">
        <td className="px-4 py-3 text-zinc-300">Data</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
            Success
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### Card Grid
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {items.map((item) => (
    <Card
      key={item.id}
      className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm hover:-translate-y-1 transition-transform duration-300 cursor-pointer group"
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <Icon className="w-8 h-8 text-zinc-400 group-hover:text-zinc-300 transition-colors" />
          <Badge className="bg-zinc-800 text-zinc-400 border-zinc-700">
            Badge
          </Badge>
        </div>
        <h3 className="text-lg font-semibold text-zinc-100 mb-2">
          Title
        </h3>
        <p className="text-sm text-zinc-400">Description</p>
      </CardContent>
    </Card>
  ))}
</div>
```

### List Item
```tsx
<div className="flex items-center justify-between p-4 bg-zinc-950/30 border border-zinc-900 rounded-md hover:border-zinc-700 transition-colors">
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center">
      <Icon className="w-5 h-5 text-zinc-400" />
    </div>
    <div>
      <p className="text-sm font-medium text-zinc-100">Title</p>
      <p className="text-xs text-zinc-500">Subtitle</p>
    </div>
  </div>
  <Button
    variant="ghost"
    size="sm"
    className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
  >
    Action
  </Button>
</div>
```

---

## Status Indicators

### Status Badge (Success)
```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
  <CheckCircle className="w-3 h-3" />
  Success
</span>
```

### Status Badge (Processing)
```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">
  <RefreshCw className="w-3 h-3 animate-spin" />
  Processing
</span>
```

### Status Badge (Error)
```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">
  <XCircle className="w-3 h-3" />
  Error
</span>
```

### Status Badge (Warning)
```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
  <AlertCircle className="w-3 h-3" />
  Warning
</span>
```

### Alert Message
```tsx
<div className="p-4 rounded-md bg-blue-500/10 border border-blue-500/20">
  <div className="flex gap-3">
    <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
    <div>
      <h4 className="text-sm font-medium text-zinc-100">Alert Title</h4>
      <p className="text-sm text-zinc-400 mt-1">Alert message content</p>
    </div>
  </div>
</div>
```

### Success Message
```tsx
<div className="p-4 rounded-md bg-green-500/10 border border-green-500/20">
  <div className="flex gap-3">
    <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
    <div>
      <h4 className="text-sm font-medium text-zinc-100">Success</h4>
      <p className="text-sm text-zinc-400 mt-1">Operation completed successfully</p>
    </div>
  </div>
</div>
```

### Error Message
```tsx
<div className="p-4 rounded-md bg-red-500/10 border border-red-500/20">
  <div className="flex gap-3">
    <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
    <div>
      <h4 className="text-sm font-medium text-zinc-100">Error</h4>
      <p className="text-sm text-zinc-400 mt-1">Something went wrong</p>
    </div>
  </div>
</div>
```
