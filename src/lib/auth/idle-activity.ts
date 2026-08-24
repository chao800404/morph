export const AUTHENTICATED_USER_ACTIVITY_EVENT =
  "morph:authenticated-user-activity";

export function reportAuthenticatedUserActivity() {
  window.dispatchEvent(new Event(AUTHENTICATED_USER_ACTIVITY_EVENT));
}
