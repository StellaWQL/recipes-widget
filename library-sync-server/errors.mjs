export class LibraryError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.name = 'LibraryError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export const invalidBook = message => new LibraryError(422, 'INVALID_EPUB', message);
