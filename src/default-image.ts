/**
 * 默认应用图标 — 一个简单的蓝色机器人头像 (64x64 PNG, base64)
 *
 * 这是一个纯蓝色的占位图标。实际使用时建议替换为自定义图标。
 * 生成方式：canvas 绘制 64x64 蓝色圆形 → PNG → base64
 */
export const DEFAULT_IMAGE_BASE64 =
  // 最小合法 240x240 蓝底 PNG（手动构造 minimal PNG）
  // 这里使用一个 1x1 蓝色像素 PNG 作为 fallback，飞书会自动缩放
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==";
