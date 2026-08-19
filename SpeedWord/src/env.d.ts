/// <reference types="vite/client" />

import type { SpeedWordApi } from "./shared/api";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare global {
  interface Window {
    api: SpeedWordApi;
  }
}

export {};
