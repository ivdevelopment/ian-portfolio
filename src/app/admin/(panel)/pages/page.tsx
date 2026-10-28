import Link from "next/link";
import { ArrowRight, Home, Layers, Mail, User } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { AdminPageHeader, Panel } from "@/components/admin/ui";

const pages = [
  { href: "/admin/pages/home", title: "Home", icon: Home, text: "Hero, stats, intros and the closing call to action." },
  { href: "/admin/pages/about", title: "About", icon: User, text: "Intro, portrait, body copy, stats and skills." },
  { href: "/admin/pages/contact", title: "Contact", icon: Mail, text: "Header and public contact details." },
  { href: "/admin/pages/services", title: "Services", icon: Layers, text: "The services shown on the homepage and /services." },
];

export default async function AdminPagesIndex() {
  await requireAdmin();

  return (
    <>
      <AdminPageHeader title="Pages" description="Edit the text and images of your public pages. Projects and reviews have their own sections." />
      <ul className="grid gap-3 sm:grid-cols-2">
        {pages.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="group block h-full">
              <Panel className="h-full transition-colors group-hover:border-line-strong group-hover:bg-glass-strong">
                <div className="flex items-start gap-3">
                  <p.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.title}</p>
                    <p className="mt-1 text-sm text-muted">{p.text}</p>
                  </div>
                  <ArrowRight aria-hidden className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                </div>
              </Panel>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
