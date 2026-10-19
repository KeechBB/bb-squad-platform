"use client";

import { SessionProvider } from "next-auth/react";
import { PresenceHeartbeat } from "@/components/PresenceHeartbeat";
import { SupportChatWidget } from "@/components/SupportChatWidget";
import { BbDisplayScaleCleanup } from "@/components/BbDisplayScale";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BbDisplayScaleCleanup />
      <PresenceHeartbeat />
      {children}
      <SupportChatWidget />
    </SessionProvider>
  );
}
