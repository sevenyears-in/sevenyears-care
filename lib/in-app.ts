// Inside the Seven Years Care mobile app (Android / iPhone), customers and staff share one login page.
export const APP_TAG = "SevenYearsCareApp";

export function inMobileApp() {
  return typeof navigator !== "undefined" && navigator.userAgent.includes(APP_TAG);
}

/** Where to go after logging out: the app's single login page, or the website's usual page. */
export function afterLogout(webPage: string) {
  return inMobileApp() ? "/login" : webPage;
}
