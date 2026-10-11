import { redirect } from "next/navigation";
import { ADMIN_HOME_PATH } from "@/lib/admin-web";

/** `/admin` is not a page of its own — it is the dashboard under its real name. */
export default async function AdminIndexPage() {
  redirect(ADMIN_HOME_PATH);
}
