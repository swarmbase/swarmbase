/// <reference types="react-scripts" />
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
    CLIENT_CONFIG: string | undefined;
    SIGNALING_SERVER: string | undefined;
  }
}
