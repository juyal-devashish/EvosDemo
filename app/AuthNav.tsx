"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";

// Navigation and sign-in. Links are shown by role for convenience only;
// every Convex function enforces the role itself.
export function AuthNav() {
  const me = useQuery(api.me.whoami, {});
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link href={href} aria-current={path === href ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <>
      <nav className="nav-links" aria-label="Main">
        {link("/", "Results")}
        {link("/architecture", "Architecture")}
        {me?.role && link("/review", "Review")}
        {me?.role === "qa" && link("/qa", "QA")}
      </nav>
      <div className="nav-meta">
        <span className="badge badge-neutral">Independent manufacturing demo</span>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="button-secondary">Sign in</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          {me && (
            <span className="badge badge-neutral mono" data-testid="role">
              {me.role ?? "no role"}
            </span>
          )}
          <UserButton />
        </Show>
      </div>
    </>
  );
}
