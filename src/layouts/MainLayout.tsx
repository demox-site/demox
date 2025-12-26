import React from "react";
import { MainHeader } from "./components/header";
import { MainFooter } from "./components/footer";

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col">
      <MainHeader />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 md:py-16">
          {children}
        </div>
      </main>
      <MainFooter />
    </div>
  );
};
