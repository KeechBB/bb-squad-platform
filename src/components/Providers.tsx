"use client";

import { SessionProvider } from "next-auth/react";
import { PresenceHeartbeat } from "@/components/PresenceHeartbeat";
import { SupportChatWidget } from "@/components/SupportChatWidget";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PresenceHeartbeat />
      {children}
      <SupportChatWidget />
    </SessionProvider>
  );
}
