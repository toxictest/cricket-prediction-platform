/**
 * The two URLs every part of the panel needs — server component, client island
 * and test alike — kept in their own module on purpose.
 *
 * `admin-web.ts` re-exports these, but it also imports `admin-guard`, which reads
 * `next/headers`. Importing the paths from there works in a server component and
 * explodes the client bundle in a form (`next/headers` cannot be shipped to the
 * browser), which is exactly the mistake this file exists to prevent.
 */
export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_HOME_PATH = "/admin/dashboard";
