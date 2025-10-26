import React from 'react';

const variants = {
  default: "bg-black text-white",
  secondary: "bg-gray-100 text-gray-900 border border-gray-300",
};

export function Badge({ variant = "default", className = "", ...props }) {
  return <span className={["inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", variants[variant], className].join(" ")} {...props} />;
}