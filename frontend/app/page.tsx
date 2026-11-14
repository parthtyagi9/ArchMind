"use client";
import { AppProvider, useApp } from "@/components/AppState";
import { Ide } from "@/components/ide/Ide";
import { Welcome } from "@/components/ide/Welcome";

function Root() {
  const { workspace } = useApp();
  return workspace ? <Ide /> : <Welcome />;
}

export default function Home() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
