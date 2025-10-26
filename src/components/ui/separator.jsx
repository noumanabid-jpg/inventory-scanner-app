import React from 'react';
export function Separator({ className = "", ...props }) {
  return <hr className={["border-t border-gray-200 my-2", className].join(" ")} {...props} />;
}