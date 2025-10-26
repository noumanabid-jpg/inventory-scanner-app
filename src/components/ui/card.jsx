import React from 'react';

export function Card({ className = "", ...props }) {
  return <div className={["rounded-2xl border bg-white shadow-sm", className].join(" ")} {...props} />;
}
export function CardHeader({ className = "", ...props }) {
  return <div className={["p-4", className].join(" ")} {...props} />;
}
export function CardTitle({ className = "", ...props }) {
  return <h3 className={["text-lg font-semibold", className].join(" ")} {...props} />;
}
export function CardContent({ className = "", ...props }) {
  return <div className={["p-4", className].join(" ")} {...props} />;
}