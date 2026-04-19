import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function ProviderLandingPage() {
  const user = await getCurrentUser();
  if (user?.role === "provider") {
    redirect("/provider/dashboard");
  }
  redirect("/sign-in?role=provider&next=/provider/dashboard");
}
