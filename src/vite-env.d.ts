/// <reference types="vite/client" />

declare module "*?url" {
  const url: string;
  export default url;
}

declare module "fresh-air-pdf/dist/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}
