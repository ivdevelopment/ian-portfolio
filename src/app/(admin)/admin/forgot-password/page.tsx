import Link from "next/link";
import { siteConfig } from "@/config/site";
import { ADMIN_LOGIN } from "@/lib/auth-routes";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-center text-xl font-medium tracking-tight">{siteConfig.initials}</p>
        <h1 className="mt-6 text-center text-2xl font-medium tracking-tight">Reset your password</h1>
        <p className="mt-1 text-center text-sm text-muted">
          Enter your admin email and we&apos;ll send a recovery link.
        </p>
        <div className="glass mt-8 rounded-panel p-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-5 text-center text-sm">
          <Link href={ADMIN_LOGIN} className="text-muted underline-offset-4 hover:text-ink hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
