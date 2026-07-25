import { Account } from "./account";
import { Contents } from "./contents";
import { General } from "./general";
import { Marketing } from "./marketing";

export * from "./account";
export * from "./contents";
export * from "./general";
export * from "./marketing";

export const dashboardCollections = {
  global: [Marketing, Contents],
  settings: [General, Account],
};
