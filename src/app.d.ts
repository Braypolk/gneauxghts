import type { ClientErrorCode } from './lib/app/clientErrorPresentation';

declare global {
  namespace App {
    interface Error {
      presentationCode?: ClientErrorCode;
      diagnosticId?: string;
    }
  }
}

export {};
