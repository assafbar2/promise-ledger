import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workbench",
};

export default function WorkbenchLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
