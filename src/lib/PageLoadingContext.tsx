"use client";
import React, { createContext, useContext, useState, useCallback } from "react";

interface PageLoadingContextType {
  isLoading: boolean;
  showLoader: () => void;
  hideLoader: () => void;
}

const PageLoadingContext = createContext<PageLoadingContextType | undefined>(
  undefined
);

export function PageLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const showLoader = useCallback(() => {
    setIsLoading(true);
  }, []);

  const hideLoader = useCallback(() => {
    setIsLoading(false);
  }, []);

  return (
    <PageLoadingContext.Provider value={{ isLoading, showLoader, hideLoader }}>
      {children}
    </PageLoadingContext.Provider>
  );
}

export function usePageLoading() {
  const context = useContext(PageLoadingContext);
  if (context === undefined) {
    throw new Error("usePageLoading must be used within PageLoadingProvider");
  }
  return context;
}
