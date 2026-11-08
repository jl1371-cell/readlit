"use client";
import dynamic from "next/dynamic";

// The whole app runs in the browser: pdf.js, IndexedDB and the canvas all need it.
const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => <div className="h-dvh bg-canvas" />,
});

export default function AppShell() {
  return <App />;
}
