export class UserFacingError extends Error {
  public readonly expose = true;

  public constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unknown error");
}
