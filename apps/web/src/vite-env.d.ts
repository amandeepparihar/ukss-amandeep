/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_FC_BOX_NUMBER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'cal-heatmap' {
  interface CalHeatmapOptions {
    itemSelector?: HTMLElement | string;
    data?: {
      source: Array<Record<string, unknown>>;
      x: string;
      y: string;
    };
    date?: {
      start?: Date;
      locale?: string;
    };
    range?: number;
    domain?: {
      type?: string;
      label?: { text?: string; position?: string };
    };
    subDomain?: {
      type?: string;
      width?: number;
      height?: number;
      radius?: number;
    };
    scale?: {
      color?: {
        range?: string[];
        interpolate?: string;
        type?: string;
        domain?: number[];
      };
    };
  }

  export default class CalHeatmap {
    paint(options: CalHeatmapOptions): void;
    destroy(): void;
  }
}

declare module 'cal-heatmap/cal-heatmap.css';
