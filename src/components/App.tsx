"use client";
import { useEffect } from "react";
import { TipProvider } from "@/components/ui/primitives";
import { useChat } from "@/lib/store/chat";
import { useLibrary } from "@/lib/store/library";
import { useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { useSettings } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import Home from "./home/Home";
import Reader from "./reader/Reader";

export default function App() {
  const currentId = useLibrary((s) => s.currentId);
  const loaded = useLibrary((s) => s.loaded);

  useEffect(() => {
    void useSettings.getState().load();
    void useLibrary.getState().load();
    // Stores are reachable from the console while developing.
    if (process.env.NODE_ENV !== "production") Object.assign(window, { readlit: { useReader, useNotes, useChat, useLibrary, useSettings, useUi } });
  }, []);

  return (
    <TipProvider delayDuration={450}>
      {!loaded ? <div className="h-dvh bg-canvas" /> : currentId ? <Reader key={currentId} paperId={currentId} /> : <Home />}
    </TipProvider>
  );
}
