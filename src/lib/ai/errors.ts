/** An error with a message that can be shown to the reader as is, and the HTTP status to send it with. */
export class AiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}
