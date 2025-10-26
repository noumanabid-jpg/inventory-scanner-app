import React from 'react';

export function Label({ className = "", ...props }) {
  return <label className={["text-sm font-medium text-gray-800", className].join(" ")} {...props} />;
}