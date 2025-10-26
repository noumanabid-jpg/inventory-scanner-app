import React from 'react';

const base = "inline-flex items-center justify-center rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none px-3 py-2";
const variants = {
  default: "bg-black text-white hover:bg-gray-800 focus:ring-black",
  secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-400",
  outline: "border border-gray-300 text-gray-900 bg-white hover:bg-gray-50 focus:ring-gray-400",
  ghost: "text-gray-900 hover:bg-gray-100"
};

export function Button({ variant = "default", className = "", ...props }) {
  return <button className={[base, variants[variant] || variants.default, className].join(" ")} {...props} />;
}