import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * formatBytes
 * 将字节数格式化为可读字符串（B/KB/MB/GB/TB）
 */
export function formatBytes(bytes: number | null | undefined): string {
  const value = typeof bytes === "number" ? bytes : 0;
  if (value === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(value) / Math.log(k));
  const num = value / Math.pow(k, i);
  return `${num.toFixed(num >= 100 ? 0 : num >= 10 ? 1 : 2)} ${sizes[i]}`;
}