declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
      };
      event?: {
        listen: <T>(
          event: string,
          handler: (payload: { payload: T }) => void
        ) => Promise<() => void>;
      };
      dialog?: {
        open: (options?: Record<string, unknown>) => Promise<string | null>;
      };
    };
  }
}

export {};
