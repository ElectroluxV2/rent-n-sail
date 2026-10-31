import type { ImageLoaderConfig } from '@angular/common';

export function rentalImageLoader({ src, width }: ImageLoaderConfig): string {
  return `/img/${src}-${width ?? 1440}.webp`;
}
