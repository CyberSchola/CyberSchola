"use client";
import React from "react";
import Menu from "./Menu";

interface SidebarMenuProps {
  onShowLoader?: () => void;
}

export default function SidebarMenu({ onShowLoader }: SidebarMenuProps) {
  return <Menu onShowLoader={onShowLoader} />;
}
