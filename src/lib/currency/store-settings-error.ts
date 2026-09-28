export type StoreSettingsErrorCode =
  | "NOT_FOUND"
  | "INVALID_CURRENCY"
  | "CURRENCY_IN_USE"
  | "INVALID_SALES_CHANNEL"
  | "INVALID_REGION"
  | "INVALID_LOCATION"
  | "INVALID_LOCALE"
  | "INVALID_DEFAULT";

export class StoreSettingsError extends Error {
  constructor(
    readonly code: StoreSettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreSettingsError";
  }
}
